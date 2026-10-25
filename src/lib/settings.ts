import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, getModelOrDefault } from "./media/catalog";
import { DEFAULT_LLM } from "./llm/catalog";
import type { AgentSlot, LlmAssignment } from "./llm/types";

/** Ollama's OpenAI-compatible endpoint, the shipped Local default. */
export const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:11434/v1";

export type TrendSourceKind = "url" | "feed" | "document" | "keyword";

/** Something the Trend Analyser is allowed to retrieve from. The founder owns this list. */
export type TrendSource = {
  id: string;
  kind: TrendSourceKind;
  /** URL, feed address, file name, or the keyword/hashtag itself. */
  value: string;
  label: string;
  enabled: boolean;
  addedAt: string;
  /** Set by the retrieval step once it exists; null until the source has been read. */
  lastFetchedAt: string | null;
  /** Uploaded documents only: the text read from the file, when it could be read. */
  content?: string;
  /** Uploaded documents only: original size in bytes. */
  size?: number;
  /** Uploaded documents only: true when the content was cut to the size limit. */
  truncated?: boolean;
};

export type WorkspaceSettings = {
  agents: Record<AgentSlot, LlmAssignment>;
  trendSources: TrendSource[];
  imageModelId: string;
  videoModelId: string;
  videoDurationSec: number;
  localBaseUrl: string;
  localModel: string;
};

const openaiDefault: LlmAssignment = { provider: "openai", modelId: DEFAULT_LLM };

export function defaultSettings(): WorkspaceSettings {
  return {
    agents: {
      trend: { ...openaiDefault },
      creative: { ...openaiDefault },
      compliance: { ...openaiDefault },
      media: { ...openaiDefault },
    },
    trendSources: [],
    imageModelId: DEFAULT_IMAGE_MODEL,
    videoModelId: DEFAULT_VIDEO_MODEL,
    videoDurationSec: 8,
    localBaseUrl: DEFAULT_LOCAL_BASE_URL,
    localModel: "llama3.1",
  };
}

export function withSettingsDefaults(partial?: Partial<WorkspaceSettings> | null): WorkspaceSettings {
  const base = defaultSettings();
  if (!partial) return base;
  return {
    ...base,
    ...partial,
    agents: {
      ...base.agents,
      ...partial.agents,
    },
    trendSources: partial.trendSources ?? base.trendSources,
    imageModelId: getModelOrDefault(partial.imageModelId, "image").id,
    videoModelId: getModelOrDefault(partial.videoModelId, "video").id,
  };
}
