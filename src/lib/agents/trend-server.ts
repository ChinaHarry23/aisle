import { createTrendQuality } from './trend-quality';
/** The campaign engine's trend backend. Model selection stays in stored workspace settings. */
import { createTrendResearch, researchEnabled } from "./trend-research";
import { createTrendAgentRuntime } from "./trend-runtime";
import { getLlmModel, getLlmOrDefault } from "@/lib/llm/catalog";
import { runComplete } from "@/lib/llm/metered-complete";
import { stubComplete } from "@/lib/llm/stub";
import { readMedia } from "@/lib/media/store";
import type { BillingContext } from "@/lib/billing/meter";
import type { CompleteRequest } from "@/lib/llm/types";
import type { LlmRuntime } from "@/lib/runtime/decide";

/** Turn saved posters into data URLs the vision model can see. */
async function posterDataUrls(req: CompleteRequest): Promise<string[]> {
  const urls = req.imageUrls ?? [];
  const ownerId = req.ownerId;
  const out: string[] = [];
  for (const url of urls.slice(0, 2)) {
    try {
      if (url.startsWith("data:image/")) {
        out.push(url);
        continue;
      }
      if (!ownerId) continue;
      const media = await readMedia(url, "image", ownerId);
      out.push(`data:${media.mime};base64,${Buffer.from(media.bytes).toString("base64")}`);
    } catch {
      // A missing poster does not block the text review.
    }
  }
  return out;
}

export function createServerTrendRuntime(billing?: BillingContext): LlmRuntime {
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
        if (model.providerId === "openai") {
          return runComplete(
            {
              ...req,
              direct: true,
              webSearch: model.toolApi === "responses",
              purpose: "trend",
              maxOutputTokens: req.maxOutputTokens ?? 8000,
            },
            billing,
          );
        }
      }
      if ((req.agent === "creative" || req.agent === "compliance" || req.agent === "media") && billing?.kind === "user") {
        const model = getLlmOrDefault(req.modelId);
        if (model.providerId === "openai") {
          const images = req.agent === "compliance" ? await posterDataUrls(req) : undefined;
          return runComplete(
            {
              ...req,
              modelId: model.id,
              direct: true,
              images,
              purpose: req.purpose ?? (req.agent === "compliance" ? "compliance" : "copy"),
            },
            billing,
          );
        }
      }
      return runtime.request(req);
    },
  };
}

/** TA-03 research augments the shared server runtime; other agent paths stay shared. */
export function createServerResearchRuntime(billing?: BillingContext): LlmRuntime {
  const baseline = createServerTrendRuntime(billing);
  return { ...baseline, quality:createTrendQuality(billing), research: researchEnabled() ? createTrendResearch(billing) : async () => null };
}
