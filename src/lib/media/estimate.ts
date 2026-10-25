import { getModel } from "./catalog";
import type { GenerateRequest, MediaModel, UsageMeter } from "./types";

function promptTokens(prompt: unknown) {
  return Math.max(32, Math.ceil(String(prompt ?? "").length / 4));
}

export function estimateUsage(
  model: MediaModel,
  req: Pick<GenerateRequest, "prompt" | "durationSec">,
  latencyMs = 0,
): UsageMeter {
  const inputTokens = promptTokens(req.prompt);
  const duration = req.durationSec ?? 8;

  if (model.billing.mode === "tokens") {
    const outputTokens = model.billing.estOutTokens;
    const costUsd =
      (inputTokens / 1_000_000) * model.billing.textInPerM +
      (outputTokens / 1_000_000) * model.billing.imageOutPerM;
    return meter(inputTokens, outputTokens, 1, "ad", costUsd, `${model.name} · 1024² · token-billed`, latencyMs);
  }

  if (model.billing.mode === "per_image") {
    return meter(
      inputTokens,
      model.billing.estOutTokens,
      1,
      "ad",
      model.billing.usd,
      `${model.name} · 1 image`,
      latencyMs,
    );
  }

  if (model.billing.mode === "per_mp") {
    const costUsd = model.billing.usdPerMp * model.billing.megapixels;
    return meter(
      inputTokens,
      model.billing.estOutTokens,
      model.billing.megapixels,
      "MP",
      costUsd,
      `${model.name} · ${model.billing.megapixels} MP`,
      latencyMs,
    );
  }

  const costUsd = model.billing.usdPerSec * duration;
  const outputTokens = model.billing.estTokensPerSec * duration;
  return meter(
    inputTokens,
    outputTokens,
    duration,
    "sec",
    costUsd,
    `${model.name} · ${duration}s`,
    latencyMs,
  );
}

function meter(
  inputTokens: number,
  outputTokens: number,
  units: number,
  unitLabel: string,
  costUsd: number,
  billedAs: string,
  latencyMs: number,
): UsageMeter {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    units,
    unitLabel,
    costUsd: Math.round(costUsd * 10000) / 10000,
    billedAs,
    latencyMs,
    estimate: true,
  };
}

export function quoteModel(modelId: string, opts: { prompt?: string; durationSec?: number } = {}) {
  const model = getModel(modelId);
  return estimateUsage(model, {
    prompt: opts.prompt ?? "retail ad brief",
    durationSec: opts.durationSec,
  });
}

/* ---------------------------------------------------------------- holds -- */

/** Output tokens GPT Image bills for one 1024² image at each quality (the catalog's low, medium and high models). */
const OPENAI_TOKENS_BY_QUALITY = { low: 900, medium: 1650, high: 6800 } as const;
/** Pixels the OpenAI adapter renders for each aspect (its SIZES table). */
const OPENAI_PIXELS: Record<string, number> = {
  "4:5": 1024 * 1280,
  "3:4": 1152 * 1536,
  "1:1": 1024 * 1024,
  "9:16": 1152 * 2048,
  "16:9": 2048 * 1152,
};
/** Upper bound on the input tokens one reference image costs, at the adapters' input rates. */
const REFERENCE_TOKENS = { openai: 10_000, google: 2_000 } as const;

/**
 * What to hold in credits before a render on the owner's key. It covers the
 * quality, size and reference image the request asks for, which the plain
 * estimate does not. The render is then settled at what the provider billed.
 */
export function mediaHoldUsd(
  model: MediaModel,
  req: Pick<GenerateRequest, "prompt" | "durationSec" | "quality" | "aspectRatio" | "contextImages">,
): number {
  const listed = estimateUsage(model, req).costUsd;
  const text = promptTokens(req.prompt);
  const reference = req.contextImages?.length ? 1 : 0;
  if (model.kind === "image" && model.providerId === "openai") {
    const rates = model.billing.mode === "tokens" ? model.billing : { textInPerM: 5, imageOutPerM: 30, estOutTokens: 0 };
    const asked = req.quality ?? (model.id.endsWith("-high") ? "high" : "medium");
    // Anything unexpected is quoted as the most expensive quality.
    const quality = asked === "low" || asked === "medium" ? asked : "high";
    const pixels = OPENAI_PIXELS[req.aspectRatio ?? "4:5"] ?? OPENAI_PIXELS["16:9"];
    const out = Math.max(rates.estOutTokens, OPENAI_TOKENS_BY_QUALITY[quality]) * Math.max(1, pixels / (1024 * 1024));
    const worst = (text * rates.textInPerM + reference * REFERENCE_TOKENS.openai * 8 + out * rates.imageOutPerM) / 1e6;
    return Math.max(listed, worst);
  }
  if (model.kind === "image" && model.providerId === "google") {
    // The adapter bills Gemini image tokens at $60 per 1M; a 1K image is about 1,120 to 1,290 of them.
    const worst = (text * 0.5 + reference * REFERENCE_TOKENS.google * 0.5 + 1_800 * 60) / 1e6;
    return Math.max(listed, worst);
  }
  return listed;
}
