import type { AgentSlot, LlmModel, LlmProviderId } from "./types";

export const LLM_PROVIDERS: { id: LlmProviderId; name: string; blurb: string }[] = [
  { id: "local", name: "Local", blurb: "Ollama, LM Studio, or any OpenAI-compatible server. $0 API bill." },
  { id: "openai", name: "OpenAI", blurb: "GPT family via api.openai.com." },
  { id: "anthropic", name: "Claude", blurb: "Anthropic Messages API." },
  { id: "cursor", name: "Cursor", blurb: "Cursor API / cloud agent gateway." },
];

/** Providers offered in Settings. Cursor stays in the catalog (so saved assignments still resolve) but has no gateway yet. */
export const OFFERED_LLM_PROVIDERS: LlmProviderId[] = ["local", "openai", "anthropic"];

export const LLM_MODELS: LlmModel[] = [
  {
    id: "local:llama3.3",
    providerId: "local",
    provider: "Local",
    name: "Llama 3.3",
    apiModel: "llama3.3",
    blurb: "Strong general local default. Run via Ollama.",
    bestFor: "Offline Trend + Media drafts",
    envKeys: ["LOCAL_LLM_BASE_URL"],
    estimateLabel: "$0 / call",
    billing: { inputPerM: 0, outputPerM: 0 },
  },
  {
    id: "local:qwen2.5",
    providerId: "local",
    provider: "Local",
    name: "Qwen 2.5",
    apiModel: "qwen2.5",
    blurb: "Good JSON and bilingual copy.",
    bestFor: "Structured briefs",
    envKeys: ["LOCAL_LLM_BASE_URL"],
    estimateLabel: "$0 / call",
    billing: { inputPerM: 0, outputPerM: 0 },
  },
  {
    id: "local:gemma3",
    providerId: "local",
    provider: "Local",
    name: "Gemma 3",
    apiModel: "gemma3",
    blurb: "Small enough for a laptop, sharp enough for compliance flags.",
    bestFor: "Light Compliance passes",
    envKeys: ["LOCAL_LLM_BASE_URL"],
    estimateLabel: "$0 / call",
    billing: { inputPerM: 0, outputPerM: 0 },
  },
  {
    id: "local:mistral-small",
    providerId: "local",
    provider: "Local",
    name: "Mistral Small",
    apiModel: "mistral-small",
    blurb: "Fast local instruct model.",
    bestFor: "Volume iteration",
    envKeys: ["LOCAL_LLM_BASE_URL"],
    estimateLabel: "$0 / call",
    billing: { inputPerM: 0, outputPerM: 0 },
  },
  {
    id: "local:custom",
    providerId: "local",
    provider: "Local",
    name: "Custom tag",
    apiModel: "custom",
    blurb: "Whatever tag your server exposes. Set it in Local runtime.",
    bestFor: "Your fine-tune",
    envKeys: ["LOCAL_LLM_BASE_URL"],
    estimateLabel: "$0 / call",
    billing: { inputPerM: 0, outputPerM: 0 },
  },
  {
    id: "openai:gpt-6-astra",
    providerId: "openai",
    provider: "OpenAI",
    name: "GPT-6 Astra",
    apiModel: "gpt-6-astra",
    blurb: "Most capable GPT-6 model. Tool calls go through the Responses API.",
    bestFor: "Hard compliance and hero campaigns",
    envKeys: ["OPENAI_API_KEY"],
    estimateLabel: "~$0.11 / call",
    billing: { inputPerM: 10, outputPerM: 50 },
    reasoning: true,
    effort: "medium",
    toolApi: "responses",
  },
  {
    id: "openai:gpt-6.1-sol",
    providerId: "openai",
    provider: "OpenAI",
    name: "GPT-6.1 Sol",
    apiModel: "gpt-6.1-sol",
    blurb: "Near-Astra quality at a lower price. Tool calls go through the Responses API.",
    bestFor: "Balanced company brain",
    envKeys: ["OPENAI_API_KEY"],
    estimateLabel: "~$0.022 / call",
    billing: { inputPerM: 2, outputPerM: 10 },
    reasoning: true,
    effort: "medium",
    toolApi: "responses",
  },
  {
    id: "openai:gpt-6-luna",
    providerId: "openai",
    provider: "OpenAI",
    name: "GPT-6 Luna",
    apiModel: "gpt-6-luna",
    blurb: "Efficient GPT-6 for high-volume drafts. Chat tools run with reasoning off.",
    bestFor: "Intake, trend, and copy volume",
    envKeys: ["OPENAI_API_KEY"],
    estimateLabel: "~$0.001 / call",
    billing: { inputPerM: 0.1, outputPerM: 0.5 },
    reasoning: true,
    effort: "low",
    toolApi: "chat",
  },
  {
    id: "anthropic:claude-opus-5.5",
    providerId: "anthropic",
    provider: "Claude",
    name: "Opus 5.5",
    apiModel: "claude-opus-5-5",
    blurb: "Highest-judgment Claude. Expensive, careful.",
    bestFor: "Compliance, founder-grade copy",
    envKeys: ["ANTHROPIC_API_KEY"],
    estimateLabel: "~$0.048 / call",
    billing: { inputPerM: 15, outputPerM: 75 },
  },
  {
    id: "anthropic:claude-sonnet-5.5",
    providerId: "anthropic",
    provider: "Claude",
    name: "Sonnet 5.5",
    apiModel: "claude-sonnet-5-5",
    blurb: "Everyday Claude. Strong at policy language.",
    bestFor: "Compliance + Trend",
    envKeys: ["ANTHROPIC_API_KEY"],
    estimateLabel: "~$0.010 / call",
    billing: { inputPerM: 3, outputPerM: 15 },
  },
  {
    id: "anthropic:claude-haiku-5.5",
    providerId: "anthropic",
    provider: "Claude",
    name: "Haiku 5.5",
    apiModel: "claude-haiku-5-5",
    blurb: "Fast Claude for volume passes.",
    bestFor: "Media Manager rewrites",
    envKeys: ["ANTHROPIC_API_KEY"],
    estimateLabel: "~$0.003 / call",
    billing: { inputPerM: 0.8, outputPerM: 4 },
  },
  {
    id: "cursor:composer",
    providerId: "cursor",
    provider: "Cursor",
    name: "Composer",
    apiModel: "composer-1",
    blurb: "Cursor’s coding/planning model, used here as a company brain.",
    bestFor: "Structured agent JSON",
    envKeys: ["CURSOR_API_KEY"],
    estimateLabel: "~$0.004 / call",
    billing: { inputPerM: 1.25, outputPerM: 6 },
  },
  {
    id: "cursor:auto",
    providerId: "cursor",
    provider: "Cursor",
    name: "Auto",
    apiModel: "auto",
    blurb: "Lets Cursor pick the underlying model.",
    bestFor: "Default Cursor backend",
    envKeys: ["CURSOR_API_KEY"],
    estimateLabel: "~$0.006 / call",
    billing: { inputPerM: 2, outputPerM: 8 },
  },
  {
    id: "cursor:gpt-6-luna",
    providerId: "cursor",
    provider: "Cursor",
    name: "GPT-6 Luna via Cursor",
    apiModel: "gpt-6-luna",
    blurb: "OpenAI through Cursor usage, not a separate OpenAI key.",
    bestFor: "When you already pay Cursor",
    envKeys: ["CURSOR_API_KEY"],
    estimateLabel: "~$0.008 / call",
    billing: { inputPerM: 1.4, outputPerM: 11 },
  },
  {
    id: "cursor:claude-sonnet-5.5",
    providerId: "cursor",
    provider: "Cursor",
    name: "Sonnet 5.5 via Cursor",
    apiModel: "claude-sonnet-5-5",
    blurb: "Claude through Cursor usage.",
    bestFor: "Compliance without a separate Anthropic key",
    envKeys: ["CURSOR_API_KEY"],
    estimateLabel: "~$0.011 / call",
    billing: { inputPerM: 3.3, outputPerM: 16.5 },
  },
];

export const DEFAULT_LLM = "openai:gpt-6-luna";

export const PROVIDER_DEFAULT_MODEL: Record<LlmProviderId, string> = {
  local: "local:llama3.3",
  openai: "openai:gpt-6-luna",
  anthropic: "anthropic:claude-sonnet-5.5",
  cursor: "cursor:composer",
};

export const AGENT_SLOTS: {
  id: AgentSlot;
  label: string;
  help: string;
}[] = [
  {
    id: "trend",
    label: "Trend Analyser",
    help: "POS, seasonal cycle, personas, campaign brief.",
  },
  {
    id: "creative",
    label: "Image Generation",
    help: "Copy and prompts. Ad pixels still use the image model below.",
  },
  {
    id: "compliance",
    label: "Compliance Checker",
    help: "Country rules, banned claims, revision loop, HITL.",
  },
  {
    id: "media",
    label: "Media Manager",
    help: "Channel adaptations, posting times, schedule.",
  },
];

export function getLlmModel(id: string): LlmModel {
  const found = LLM_MODELS.find((m) => m.id === id);
  if (!found) throw new Error(`Unknown LLM: ${id}`);
  return found;
}

export function getLlmOrDefault(id: string | undefined): LlmModel {
  return LLM_MODELS.find((m) => m.id === id) ?? getLlmModel(DEFAULT_LLM);
}

function llmsByProvider(providerId: LlmProviderId) {
  return LLM_MODELS.filter((m) => m.providerId === providerId);
}

export function assignmentFor(provider: LlmProviderId, modelId?: string) {
  const models = llmsByProvider(provider);
  const id = models.some((m) => m.id === modelId) ? modelId! : PROVIDER_DEFAULT_MODEL[provider];
  return { provider, modelId: id };
}
