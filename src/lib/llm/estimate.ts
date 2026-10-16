import { getLlmModel } from "./catalog";
import type { CompleteRequest, LlmModel, LlmUsage } from "./types";
import { POSTER_ARTIST_SYSTEM } from "../media/art-director-system";

export function promptTokens(prompt: string) {
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
  if (model.maxOutputTokens) return model.maxOutputTokens;
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

export function estimateLlmUsage(
  model: LlmModel,
  req: Pick<CompleteRequest, "prompt" | "agent" | "system">,
  latencyMs = 0,
): LlmUsage {
  const inputTokens = promptTokens(req.system ? `${req.system}\n${req.prompt}` : req.prompt);
  const outputTokens = typicalOut(model, req.agent);
  const costUsd = llmCostUsd(model, inputTokens, outputTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: Math.round(costUsd * 100000) / 100000,
    billedAs: `${model.name} · ${req.agent} call`,
    estimate: true,
    latencyMs,
  };
}

/**
 * The most one call can cost: the prompt counted as a token per UTF-16 unit
 * (CJK and emoji can cost that much; English costs about a quarter), plus the
 * system prompt, and the full output ceiling. This is what a credit hold
 * reserves before the call goes out.
 */
export function worstCaseUsd(model: LlmModel, req: Pick<CompleteRequest, "prompt" | "system" | "maxOutputTokens"> & Partial<Pick<CompleteRequest, "agent">>): number {
  const inputTokens = req.prompt.length + (req.system?.length ?? (req.agent === "creative" ? POSTER_ARTIST_SYSTEM.length : 160));
  return llmCostUsd(model, inputTokens, outputCap(model, req));
}

/** Typical cost of one decision on this model, for pickers and seat cards. */
export function quoteLlm(modelId: string, agent: CompleteRequest["agent"] = "trend") {
  const model = getLlmModel(modelId);
  const outputTokens = typicalOut(model, agent);
  const costUsd = llmCostUsd(model, TYPICAL_PROMPT_TOKENS, outputTokens);
  return {
    inputTokens: TYPICAL_PROMPT_TOKENS,
    outputTokens,
    totalTokens: TYPICAL_PROMPT_TOKENS + outputTokens,
    costUsd: Math.round(costUsd * 100000) / 100000,
    billedAs: `${model.name} · ${agent} call`,
    estimate: true,
    latencyMs: 0,
  } satisfies LlmUsage;
}

export function usageFromProvider(
  model: LlmModel,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  agent: CompleteRequest["agent"],
): LlmUsage {
  const costUsd = llmCostUsd(model, inputTokens, outputTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: Math.round(costUsd * 100000) / 100000,
    billedAs: `${model.name} · ${agent} call`,
    estimate: false,
    latencyMs,
  };
}
