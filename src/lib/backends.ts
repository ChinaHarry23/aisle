import { AGENT_SLOTS, LLM_PROVIDERS, PROVIDER_DEFAULT_MODEL } from "./llm/catalog";
import type { LlmProviderId } from "./llm/types";
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from "./media/catalog";
import type { WorkspaceSettings } from "./settings";

/** Matches Cindy's Settings default (Ollama). */
export const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:11434/v1";

/**
 * "Apply one backend to all" moves every agent seat and both Studio models in
 * one step. Local keeps all of it on this Mac: Qwen3.8 on MTPLX thinks, ComfyUI
 * renders. The cloud backends (OpenAI, Claude) share one poster and one video
 * model, because Claude has no media models of its own. Cloud runs on the
 * owner's keys and is paid in credits.
 */
export type BackendId = LlmProviderId;

export type Backend = {
  id: BackendId;
  name: string;
  where: "local" | "cloud";
  llmModelId: string;
  imageModelId: string;
  videoModelId: string;
};

export const CLOUD_IMAGE_MODEL = "openai:gpt-image-2.5";
export const CLOUD_VIDEO_MODEL = "bytedance:seedance-2-fast";

export const BACKENDS: Backend[] = LLM_PROVIDERS.map((p) => {
  const local = p.id === "local";
  return {
    id: p.id,
    name: p.name,
    where: local ? "local" : "cloud",
    llmModelId: PROVIDER_DEFAULT_MODEL[p.id],
    imageModelId: local ? DEFAULT_IMAGE_MODEL : CLOUD_IMAGE_MODEL,
    videoModelId: local ? DEFAULT_VIDEO_MODEL : CLOUD_VIDEO_MODEL,
  };
});

export function getBackend(id: BackendId): Backend {
  const found = BACKENDS.find((b) => b.id === id);
  if (!found) throw new Error(`Unknown backend: ${id}`);
  return found;
}

/** Shipped defaults nobody chose: the pre-MTPLX build pointed Local at Ollama. */
const UNCHOSEN_LOCAL_URLS = new Set(["", "http://127.0.0.1:8000/v1"]);

/**
 * `serverLocalBase` is the URL the server itself uses for Local (its
 * LOCAL_LLM_BASE_URL, else MTPLX's port), as reported by /api/settings/status.
 */
export function applyBackend(
  settings: WorkspaceSettings,
  id: BackendId,
  serverLocalBase: string = DEFAULT_LOCAL_BASE_URL,
): Partial<WorkspaceSettings> {
  const backend = getBackend(id);
  const agents = Object.fromEntries(
    AGENT_SLOTS.map((slot) => [slot.id, { provider: backend.id, modelId: backend.llmModelId }]),
  ) as WorkspaceSettings["agents"];
  return {
    agents,
    imageModelId: backend.imageModelId,
    videoModelId: backend.videoModelId,
    videoDurationSec: settings.videoDurationSec,
    // Qwen3.8 is only on MTPLX, so a blank or old default URL moves to the
    // server's Local URL. A URL someone typed (MTPLX on another port) is kept.
    ...(backend.where === "local" && UNCHOSEN_LOCAL_URLS.has(settings.localBaseUrl.trim().replace(/\/$/, ""))
      ? { localBaseUrl: serverLocalBase }
      : {}),
  };
}

/**
 * The backend all four seats and both media models run on, or null when they
 * are split. By where things run, not exact model: four Custom-tag seats and
 * ComfyUI media are still Local.
 */
export function currentBackend(settings: WorkspaceSettings): BackendId | null {
  const providers = new Set(AGENT_SLOTS.map((slot) => settings.agents[slot.id].provider));
  if (providers.size !== 1) return null;
  const [id] = providers;
  return id;
}
