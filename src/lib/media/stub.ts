import { estimateUsage } from "./estimate";
import { getModel } from "./catalog";
import type { GenerateRequest, GenerateResult } from "./types";

export function stubGenerate(req: GenerateRequest, note: string): GenerateResult {
  const started = Date.now();
  const model = getModel(req.modelId);
  const usage = estimateUsage(model, req, 240 + Math.round(Math.random() * 180));
  usage.latencyMs = Date.now() - started + usage.latencyMs;
  return {
    kind: req.kind,
    modelId: model.id,
    provider: model.provider,
    modelName: model.name,
    status: "stubbed",
    usage,
    url: null,
    note,
    at: new Date().toISOString(),
  };
}
