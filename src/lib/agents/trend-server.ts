/** Server opt-in only. Model selection remains in trusted workspace settings. */
import { createTrendResearch, researchEnabled } from "./trend-research";
import { makeLlmRuntime } from "@/lib/runtime/decide";
import { createTrendAgentRuntime } from "./trend-runtime";
import { getLlmModel } from "@/lib/llm/catalog";
import { stubComplete } from "@/lib/llm/stub";
import type { BillingContext } from "@/lib/billing/meter";
import type { LlmRuntime } from "@/lib/runtime/decide";

export function trendAgentEnabled(): boolean {
  return process.env.TA02_AGENT_ENABLED === "1";
}

export function createServerTrendRuntime(billing?: BillingContext): LlmRuntime | undefined {
  if (!trendAgentEnabled()) return undefined;
  const runtime = createTrendAgentRuntime({ billing });
  return {
    meta: runtime.meta,
    async request(req) {
      if (req.agent === "trend") {
        const model = getLlmModel(req.modelId);
        // Only providers supported by the existing shared agent transport are allowed.
        if (!["local", "openai"].includes(model.providerId)) {
          return stubComplete(req, "This Trend provider is not enabled for server workflows. Select a supported team model in stored settings.", "unconfigured");
        }
        if (model.providerId !== "local" && billing?.kind !== "user") {
          return stubComplete(req, "An authenticated billing identity is required for the Trend model.", "no_credits");
        }
      }
      return runtime.request(req);
    },
  };
}

/** Normal TA-03 server path; TA-02's opt-in smoke-test adapter is retained above. */
export function createServerResearchRuntime(billing?: BillingContext): LlmRuntime {
  const baseline = createServerTrendRuntime(billing) ?? makeLlmRuntime();
  return { ...baseline, research: researchEnabled() ? createTrendResearch(billing) : async () => null };
}
