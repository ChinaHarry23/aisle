/**
 * Compatibility aliases so PR #2 modules compile against Cindy's catalogs.
 * Do not import this from her UI.
 */
import { PROVIDER_DEFAULT_MODEL } from "@/lib/llm/catalog";
import { getModel as catalogGetModel } from "@/lib/media/catalog";
import { runGeneration as cindyRunGeneration } from "@/lib/media/generate";
import type {
  GenerateRequest,
  MediaModel as Pr2MediaModel,
  MediaGeneration as Pr2MediaGeneration,
} from "@/lib/media/pr2-types";

export const LOCAL_DEFAULT_LLM = PROVIDER_DEFAULT_MODEL.local;

export function parseToolArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { __unparsed: raw };
  } catch {
    return { __unparsed: raw };
  }
}

export function getModel(id: string): Pr2MediaModel {
  try {
    return catalogGetModel(id);
  } catch {
    // PR #2 ComfyUI / TokenHub ids are not in Cindy's catalog.
    if (id.startsWith("comfy:") || id.startsWith("tencent:")) {
      const video = !id.includes("image") && id !== "comfy:local";
      return {
        id,
        providerId: id.startsWith("tencent:") ? "tencent" : "comfy",
        provider: id.startsWith("tencent:") ? "Tencent" : "ComfyUI",
        name: id,
        apiModel: id,
        kind: video ? "video" : "image",
        blurb: "",
        bestFor: "",
        envKeys: [],
        endpoint: "",
        estimateLabel: "",
        billing: video
          ? { mode: "per_second", usdPerSec: 0, estTokensPerSec: 0 }
          : { mode: "per_image", usd: 0, estOutTokens: 0 },
        videoInput: id.includes("ltx") ? "text" : "image",
      };
    }
    throw new Error(`Unknown media model: ${id}`);
  }
}

/** Cindy's generate is `(req, userKey?)`; PR #2 callers pass onQueued/billing/options after that. */
export async function runGeneration(
  req: GenerateRequest,
  ...rest: unknown[]
): Promise<Pr2MediaGeneration> {
  const userKey = typeof rest[0] === "string" ? rest[0] : undefined;
  return cindyRunGeneration(req, userKey);
}
