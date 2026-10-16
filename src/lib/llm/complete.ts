import { callLlm, isLlmConfigured, LlmAdapterNotWiredError } from "./adapters";
import { getLlmOrDefault } from "./catalog";
import { estimateLlmUsage, usageFromProvider } from "./estimate";
import { stubComplete } from "./stub";
import type { CompleteRequest, CompleteResult } from "./types";

export async function runComplete(req: CompleteRequest): Promise<CompleteResult> {
  const model = getLlmOrDefault(req.modelId);
  const configured = isLlmConfigured(model, req.localBaseUrl);
  const started = Date.now();

  if (!configured) {
    return stubComplete(
      req,
      model.providerId === "local"
        ? "Set a local base URL on Settings (Ollama default is http://127.0.0.1:11434/v1)."
        : `Set ${model.envKeys.join(", ")} in .env.local, then wire src/lib/llm/adapters.ts.`,
      "unconfigured",
    );
  }

  try {
    const live = await callLlm(model, req);
    const latencyMs = Date.now() - started;
    const usage =
      live.inputTokens != null && live.outputTokens != null
        ? usageFromProvider(model, live.inputTokens, live.outputTokens, latencyMs, req.agent)
        : estimateLlmUsage(model, req, latencyMs);
    return {
      provider: model.provider,
      providerId: model.providerId,
      modelId: model.id,
      modelName: model.name,
      status: "ok",
      usage: { ...usage, estimate: live.inputTokens == null },
      text: live.text || null,
      note: `Live ${model.name}`,
      at: new Date().toISOString(),
    };
  } catch (err) {
    const reason =
      err instanceof LlmAdapterNotWiredError
        ? `Key present for ${model.provider}. Wire the fetch in src/lib/llm/adapters.ts.`
        : err instanceof Error
          ? err.message
          : "Provider error";
    return stubComplete(req, reason, err instanceof LlmAdapterNotWiredError ? "stubbed" : "error");
  }
}
