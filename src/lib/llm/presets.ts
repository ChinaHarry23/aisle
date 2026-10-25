import { quoteLlm } from "./estimate";
import type { AgentSlot, LlmAssignment, LlmProviderId } from "./types";

type PresetId = "cheapest" | "balanced" | "best";

export const PRESETS: { id: PresetId; label: string; help: string }[] = [
  { id: "cheapest", label: "Cheapest", help: "Smallest model everywhere. Good for drafting and demos." },
  { id: "balanced", label: "Balanced", help: "Small models for volume, a stronger one for compliance." },
  { id: "best", label: "Best quality", help: "Strongest model on the steps where mistakes cost the most." },
];

type Tier = Record<AgentSlot, string>;

/** Per provider, which catalog model each tier puts on each agent. */
const TIERS: Partial<Record<LlmProviderId, Record<PresetId, Tier>>> = {
  openai: {
    cheapest: {
      trend: "openai:gpt-6-luna",
      creative: "openai:gpt-6-luna",
      compliance: "openai:gpt-6-luna",
      media: "openai:gpt-6-luna",
    },
    balanced: {
      trend: "openai:gpt-6-luna",
      creative: "openai:gpt-6-luna",
      compliance: "openai:gpt-6.1-sol",
      media: "openai:gpt-6-luna",
    },
    best: {
      trend: "openai:gpt-6-astra",
      creative: "openai:gpt-6-astra",
      compliance: "openai:gpt-6-astra",
      media: "openai:gpt-6.1-sol",
    },
  },
  anthropic: {
    cheapest: {
      trend: "anthropic:claude-haiku-5.5",
      creative: "anthropic:claude-haiku-5.5",
      compliance: "anthropic:claude-haiku-5.5",
      media: "anthropic:claude-haiku-5.5",
    },
    balanced: {
      trend: "anthropic:claude-sonnet-5.5",
      creative: "anthropic:claude-haiku-5.5",
      compliance: "anthropic:claude-sonnet-5.5",
      media: "anthropic:claude-haiku-5.5",
    },
    best: {
      trend: "anthropic:claude-sonnet-5.5",
      creative: "anthropic:claude-sonnet-5.5",
      compliance: "anthropic:claude-opus-5.5",
      media: "anthropic:claude-sonnet-5.5",
    },
  },
  local: {
    cheapest: {
      trend: "local:gemma3",
      creative: "local:gemma3",
      compliance: "local:gemma3",
      media: "local:gemma3",
    },
    balanced: {
      trend: "local:llama3.3",
      creative: "local:llama3.3",
      compliance: "local:llama3.3",
      media: "local:mistral-small",
    },
    best: {
      trend: "local:llama3.3",
      creative: "local:qwen2.5",
      compliance: "local:llama3.3",
      media: "local:qwen2.5",
    },
  },
};

export const PRESET_PROVIDERS = Object.keys(TIERS) as LlmProviderId[];

const SLOTS: AgentSlot[] = ["trend", "creative", "compliance", "media"];

export function presetAssignments(
  provider: LlmProviderId,
  preset: PresetId,
): Record<AgentSlot, LlmAssignment> | null {
  const tier = TIERS[provider]?.[preset];
  if (!tier) return null;
  const out = {} as Record<AgentSlot, LlmAssignment>;
  for (const slot of SLOTS) out[slot] = { provider, modelId: tier[slot] };
  return out;
}

/** Which preset the current assignments exactly match, if any. */
export function matchPreset(
  provider: LlmProviderId,
  agents: Record<AgentSlot, LlmAssignment>,
): PresetId | null {
  for (const p of PRESETS) {
    const tier = TIERS[provider]?.[p.id];
    if (tier && SLOTS.every((s) => agents[s].modelId === tier[s])) return p.id;
  }
  return null;
}

/** One call per agent, using the same typical-token assumptions as the run meter. */
export function textCostPerRun(agents: Record<AgentSlot, LlmAssignment>) {
  let total = 0;
  for (const slot of SLOTS) {
    try {
      total += quoteLlm(agents[slot].modelId, slot).costUsd;
    } catch {
      // unknown model id in old saved settings: ignore it in the estimate
    }
  }
  return total;
}
