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
import { isHosted } from "@/lib/billing/hosted";

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

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function normaliseBase(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function localProbePorts(): string[] {
  const custom = process.env.LOCAL_LLM_PROBE_URLS;
  if (custom !== undefined) return custom.split(",").map((item) => item.trim()).filter(Boolean);
  return ["http://127.0.0.1:8000/v1", "http://127.0.0.1:1234/v1", "http://127.0.0.1:11434/v1"];
}

/** The local servers this server itself is configured to use. */
function configuredLocalBases(): string[] {
  return [process.env.LOCAL_LLM_BASE_URL, ...localProbePorts()]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normaliseBase);
}

/**
 * PR #2 SSRF helper (not used by Cindy's adapters). A user-supplied local
 * base URL is allowed only when it is already configured, or — on a private
 * install — http(s) to loopback with no credentials, query, or fragment.
 */
export function allowedLocalBase(url?: string | null) {
  if (!url?.trim()) return null;
  const wanted = normaliseBase(url);
  if (configuredLocalBases().includes(wanted)) return wanted;
  if (isHosted()) return null;
  let parsed: URL;
  try {
    parsed = new URL(wanted);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  return normaliseBase(`${parsed.origin}${parsed.pathname}`);
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
