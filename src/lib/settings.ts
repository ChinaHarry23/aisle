import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from "./media/catalog";
import { AGENT_SLOTS, getLlmOrDefault, LOCAL_DEFAULT_LLM } from "./llm/catalog";
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

/** MTPLX's port. Ollama is :11434 and LM Studio :1234 if you run those instead. */
export const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:8000/v1";

const localDefault: LlmAssignment = { provider: "local", modelId: LOCAL_DEFAULT_LLM };

export function defaultSettings(): WorkspaceSettings {
  return {
    theme: "simple",
    agents: {
      trend: { ...localDefault },
      creative: { ...localDefault },
      compliance: { ...localDefault },
      media: { ...localDefault },
    },
    imageModelId: DEFAULT_IMAGE_MODEL,
    videoModelId: DEFAULT_VIDEO_MODEL,
    videoDurationSec: 30,
    localBaseUrl: DEFAULT_LOCAL_BASE_URL,
    localModel: "mtplx-flash-next-optimized-speed",
  };
}

/**
 * A stored seat, moved onto the catalog as it is today: retired Claude ids and
 * Cursor seats become the direct model that replaces them, with its provider.
 */
function migrateSeat(seat: LlmAssignment | undefined, fallback: LlmAssignment): LlmAssignment {
  if (!seat?.modelId) return { ...fallback };
  const model = getLlmOrDefault(seat.modelId);
  if (model.id === seat.modelId && model.providerId === seat.provider) return seat;
  return { provider: model.providerId, modelId: model.id };
}

export function withSettingsDefaults(partial?: Partial<WorkspaceSettings> | null): WorkspaceSettings {
  const base = defaultSettings();
  if (!partial) return base;
  const agents = { ...base.agents, ...partial.agents };
  return {
    ...base,
    ...partial,
    agents: Object.fromEntries(
      AGENT_SLOTS.map((slot) => [slot.id, migrateSeat(agents[slot.id], base.agents[slot.id])]),
    ) as WorkspaceSettings["agents"],
  };
}

export function describeAssignment(assignment: LlmAssignment) {
  const model = getLlmOrDefault(assignment.modelId);
  return `${model.provider} · ${model.name}`;
}
