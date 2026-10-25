import { traceable } from "langsmith/traceable";
import { langsmithUsage, llmCostUsd } from "./estimate";
import type { CompleteRequest, LlmModel } from "./types";

/** One name per seat, so a campaign trace is not only the compliance call. */
function llmSpanName(req: CompleteRequest, model: LlmModel) {
  if (req.purpose === "intake") return "intake.chat";
  if (req.webSearch) return "trend.web_search";
  if (req.images?.length) return "compliance.vision";
  return `${req.agent}.${model.apiModel}`;
}

/**
 * Record one provider completion. LangSmith totals only `usage_metadata` on an
 * `llm` run, so every seat — not only the direct OpenAI branch — returns that shape.
 */
export async function traceModelCall<T extends { text?: string; inputTokens?: number; outputTokens?: number }>(
  model: LlmModel,
  req: CompleteRequest,
  fn: () => Promise<T>,
): Promise<T> {
  return traceable(async () => {
    const answered = await fn();
    if (answered.inputTokens == null || answered.outputTokens == null) return answered;
    const costUsd = Math.round(llmCostUsd(model, answered.inputTokens, answered.outputTokens) * 100000) / 100000;
    return {
      ...answered,
      usage_metadata: langsmithUsage(model, {
        inputTokens: answered.inputTokens,
        outputTokens: answered.outputTokens,
        totalTokens: answered.inputTokens + answered.outputTokens,
        costUsd,
      }),
    };
  }, {
    name: llmSpanName(req, model),
    run_type: "llm",
    metadata: {
      model: model.apiModel,
      agent: req.agent,
      ls_provider: model.providerId,
      ls_model_name: model.apiModel,
      ls_model_type: "chat",
    },
  })();
}
