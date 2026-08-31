import { estimateLlmUsage } from "./estimate";
import { getLlmOrDefault } from "./catalog";
import type { CompleteRequest, CompleteResult } from "./types";

export function stubComplete(req: CompleteRequest, note: string, status: CompleteResult["status"] = "stubbed"): CompleteResult {
  const model = getLlmOrDefault(req.modelId);
  const started = Date.now();
  const usage = estimateLlmUsage(model, req, Date.now() - started);
  return {
    provider: model.provider,
    providerId: model.providerId,
    modelId: model.id,
    modelName: model.name,
    status,
    usage,
    text: null,
    note,
    at: new Date().toISOString(),
  };
}
