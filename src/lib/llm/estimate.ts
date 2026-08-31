import { getLlmModel } from "./catalog";
import type { CompleteRequest, LlmModel, LlmUsage } from "./types";

export function promptTokens(prompt: string) {
  return Math.max(48, Math.ceil(prompt.length / 4));
}

const TYPICAL_OUT: Record<string, number> = {
  trend: 700,
  creative: 520,
  compliance: 640,
  media: 480,
};

export function estimateLlmUsage(
  model: LlmModel,
  req: Pick<CompleteRequest, "prompt" | "agent">,
  latencyMs = 0,
): LlmUsage {
  const inputTokens = promptTokens(req.prompt);
  const outputTokens = TYPICAL_OUT[req.agent] ?? 500;
  const costUsd =
    (inputTokens / 1_000_000) * model.billing.inputPerM +
    (outputTokens / 1_000_000) * model.billing.outputPerM;
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

export function quoteLlm(modelId: string, agent: CompleteRequest["agent"] = "trend") {
  return estimateLlmUsage(getLlmModel(modelId), {
    agent,
    prompt: "retail campaign brief for a neighbourhood shop promotion cycle",
  });
}

export function usageFromProvider(
  model: LlmModel,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  agent: CompleteRequest["agent"],
): LlmUsage {
  const costUsd =
    (inputTokens / 1_000_000) * model.billing.inputPerM +
    (outputTokens / 1_000_000) * model.billing.outputPerM;
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
