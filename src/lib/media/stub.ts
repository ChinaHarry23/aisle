import { estimateUsage } from "./estimate";
import { getModel } from "./catalog";
import type { GenerateRequest, GenerateResult, MediaModel, UsageMeter } from "./types";

function lookup(id: string): MediaModel | null {
  try {
    return getModel(id);
  } catch {
    return null;
  }
}

function emptyUsage(kind: GenerateRequest["kind"]): UsageMeter {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    units: 0,
    unitLabel: kind,
    costUsd: 0,
    billedAs: "none",
    latencyMs: 0,
    estimate: true,
  };
}

export function stubGenerate(req: GenerateRequest, note: string): GenerateResult {
  const started = Date.now();
  const model = lookup(req.modelId);
  const usage = model ? estimateUsage(model, req, 240 + Math.round(Math.random() * 180)) : emptyUsage(req.kind);
  if (model) usage.latencyMs = Date.now() - started + usage.latencyMs;
  return {
    kind: req.kind,
    modelId: model?.id ?? req.modelId,
    provider: model?.provider ?? "Unknown",
    modelName: model?.name ?? req.modelId,
    status: "stubbed",
    usage,
    url: null,
    note: model ? note : `${note} ${req.modelId} is not in the current catalogue, so nothing was sent to a provider.`,
    at: new Date().toISOString(),
  };
}
