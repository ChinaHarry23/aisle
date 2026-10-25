import { getLlmModel } from "./catalog";
import type { CompleteRequest, LlmModel, LlmUsage } from "./types";
import { POSTER_ARTIST_SYSTEM } from "../media/art-director-system";

function promptTokens(prompt: string) {
  return Math.max(48, Math.ceil(prompt.length / 4));
}

const TYPICAL_OUT: Record<string, number> = {
  trend: 700,
  creative: 520,
  compliance: 640,
  media: 480,
  intake: 420,
};

/** Thinking tokens bill as output, so a model that reasons writes more than it shows. */
const THINKING_ALLOWANCE = 800;

/** A real decision prompt carries the brief and the evidence, not one line. */
const TYPICAL_PROMPT_TOKENS = 1200;

/** Output ceiling for a call to this model; local models are free, so they have none. */
export function outputCap(model: LlmModel, req?: Pick<CompleteRequest, "maxOutputTokens">): number {
  if (req?.maxOutputTokens !== undefined) {
    if (!Number.isInteger(req.maxOutputTokens) || req.maxOutputTokens < 1 || req.maxOutputTokens > 8000) throw new Error("Invalid server output allowance.");
    return req.maxOutputTokens;
  }
  return model.providerId === "anthropic" ? 3000 : 2000;
}

/** Provider cost in USD, unrounded: credits are billed from this. */
export function llmCostUsd(model: LlmModel, inputTokens: number, outputTokens: number) {
  return (
    (inputTokens / 1_000_000) * model.billing.inputPerM + (outputTokens / 1_000_000) * model.billing.outputPerM
  );
}

function typicalOut(model: LlmModel, agent: string) {
  const thinks = Boolean(model.reasoning || model.effort);
  return (TYPICAL_OUT[agent] ?? 500) + (thinks ? THINKING_ALLOWANCE : 0);
}

function usageRecord(
  model: LlmModel,
  agent: string,
  inputTokens: number,
  outputTokens: number,
  estimate: boolean,
  latencyMs: number,
): LlmUsage {
  const costUsd = llmCostUsd(model, inputTokens, outputTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: Math.round(costUsd * 100000) / 100000,
    billedAs: `${model.name} · ${agent} call`,
    estimate,
    latencyMs,
  };
}

export function estimateLlmUsage(
  model: LlmModel,
  req: Pick<CompleteRequest, "prompt" | "agent" | "system">,
  latencyMs = 0,
): LlmUsage {
  const inputTokens = promptTokens(req.system ? `${req.system}\n${req.prompt}` : req.prompt);
  return usageRecord(model, req.agent, inputTokens, typicalOut(model, req.agent), true, latencyMs);
}

/**
 * One attached poster, reserved before the provider reports the real count.
 * High-detail tiles land around this; the base64 string is not billed as text.
 */
const VISION_TOKENS_PER_IMAGE = 1_600;

/**
 * The most one call can cost: the prompt counted as a token per UTF-16 unit
 * (CJK and emoji can cost that much; English costs about a quarter), plus the
 * system prompt, and the full output ceiling. This is what a credit hold
 * reserves before the call goes out.
 */
export function worstCaseUsd(model: LlmModel, req: Pick<CompleteRequest, "prompt" | "system" | "maxOutputTokens"> & Partial<Pick<CompleteRequest, "agent" | "images">>): number {
  const inputTokens =
    req.prompt.length +
    (req.system?.length ?? (req.agent === "creative" ? POSTER_ARTIST_SYSTEM.length : 160)) +
    (req.images?.length ?? 0) * VISION_TOKENS_PER_IMAGE;
  return llmCostUsd(model, inputTokens, outputCap(model, req));
}

/** Typical cost of one decision on this model, for pickers and seat cards. */
export function quoteLlm(modelId: string, agent: CompleteRequest["agent"] = "trend") {
  const model = getLlmModel(modelId);
  return usageRecord(model, agent, TYPICAL_PROMPT_TOKENS, typicalOut(model, agent), true, 0);
}

/**
 * Token and dollar fields LangSmith adds up.
 *
 * A run output named `inputTokens` is stored and shown, and it is not a usage
 * record. The project totals read `usage_metadata.input_tokens` and `total_cost`.
 */
export function langsmithUsage(
  model: LlmModel,
  usage: Pick<LlmUsage, "inputTokens" | "outputTokens" | "totalTokens" | "costUsd">,
) {
  const inputCost = (usage.inputTokens / 1_000_000) * model.billing.inputPerM;
  const outputCost = usage.costUsd - inputCost;
  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
    input_cost: inputCost,
    output_cost: outputCost,
    total_cost: usage.costUsd,
  };
}

export function usageFromProvider(
  model: LlmModel,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  agent: CompleteRequest["agent"],
): LlmUsage {
  return usageRecord(model, agent, inputTokens, outputTokens, false, latencyMs);
}
