import { getModel } from "./catalog";
import type { GenerateRequest, MediaModel, UsageMeter } from "./types";

function promptTokens(prompt: string) {
  return Math.max(32, Math.ceil(prompt.length / 4));
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
    return meter(inputTokens, outputTokens, 1, "poster", costUsd, `${model.name} · 1024² · token-billed`, latencyMs);
  }

  if (model.billing.mode === "per_image") {
    return meter(
      inputTokens,
      model.billing.estOutTokens,
      1,
      "poster",
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
    prompt: opts.prompt ?? "retail poster brief",
    durationSec: opts.durationSec,
  });
}
