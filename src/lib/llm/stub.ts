import { getLlmOrDefault } from "./catalog";
import type { CompleteRequest, CompleteResult, LlmUsage } from "./types";

/** A call that never reached a model: nothing was spent, so nothing is booked. */
export function unspentUsage(label: string): LlmUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    billedAs: `${label} · not called`,
    estimate: true,
    latencyMs: 0,
  };
}

export function stubComplete(req: CompleteRequest, note: string, status: CompleteResult["status"] = "stubbed"): CompleteResult {
  const model = getLlmOrDefault(req.modelId);
  return {
    provider: model.provider,
    providerId: model.providerId,
    modelId: model.id,
    modelName: model.name,
    status,
    usage: unspentUsage(model.name),
    text: null,
    note,
    at: new Date().toISOString(),
  };
}
