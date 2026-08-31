import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from "./media/catalog";
import { DEFAULT_LLM, getLlmOrDefault } from "./llm/catalog";
import type { AgentSlot, LlmAssignment } from "./llm/types";
import type { UiTheme } from "./theme";

export type WorkspaceSettings = {
  theme: UiTheme;
  agents: Record<AgentSlot, LlmAssignment>;
  imageModelId: string;
  videoModelId: string;
  videoDurationSec: number;
  localBaseUrl: string;
  localModel: string;
};

const openaiDefault: LlmAssignment = { provider: "openai", modelId: DEFAULT_LLM };

export function defaultSettings(): WorkspaceSettings {
  return {
    theme: "simple",
    agents: {
      trend: { ...openaiDefault },
      creative: { ...openaiDefault },
      compliance: { ...openaiDefault },
      media: { ...openaiDefault },
    },
    imageModelId: DEFAULT_IMAGE_MODEL,
    videoModelId: DEFAULT_VIDEO_MODEL,
    videoDurationSec: 8,
    localBaseUrl: "http://127.0.0.1:11434/v1",
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
  };
}

export function describeAssignment(assignment: LlmAssignment) {
  const model = getLlmOrDefault(assignment.modelId);
  return `${model.provider} · ${model.name}`;
}
