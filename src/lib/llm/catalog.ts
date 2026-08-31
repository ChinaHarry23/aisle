import type { AgentSlot, LlmModel, LlmProviderId } from "./types";

export const LLM_PROVIDERS: { id: LlmProviderId; name: string; blurb: string }[] = [
  { id: "local", name: "Local", blurb: "Ollama, LM Studio, or any OpenAI-compatible server. $0 API bill." },
  { id: "openai", name: "OpenAI", blurb: "GPT family via api.openai.com." },
  { id: "anthropic", name: "Claude", blurb: "Anthropic Messages API." },
  { id: "cursor", name: "Cursor", blurb: "Cursor API / cloud agent gateway." },
];

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
    endpoint: "/chat/completions",
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
    endpoint: "/chat/completions",
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
    endpoint: "/chat/completions",
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
    endpoint: "/chat/completions",
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
    endpoint: "/chat/completions",
    estimateLabel: "$0 / call",
    billing: { inputPerM: 0, outputPerM: 0 },
    notes: "Uses the model name field on Settings",
  },
  {
    id: "openai:gpt-5",
    providerId: "openai",
    provider: "OpenAI",
    name: "GPT-5",
    apiModel: "gpt-5",
    blurb: "Flagship reasoning for briefs and tricky compliance.",
    bestFor: "Hero campaigns",
    envKeys: ["OPENAI_API_KEY"],
    endpoint: "https://api.openai.com/v1/chat/completions",
    estimateLabel: "~$0.007 / call",
    billing: { inputPerM: 1.25, outputPerM: 10 },
  },
  {
    id: "openai:gpt-5-mini",
    providerId: "openai",
    provider: "OpenAI",
    name: "GPT-5 mini",
    apiModel: "gpt-5-mini",
    blurb: "Cheap enough to run the whole bench.",
    bestFor: "Default company brain",
    envKeys: ["OPENAI_API_KEY"],
    endpoint: "https://api.openai.com/v1/chat/completions",
    estimateLabel: "~$0.001 / call",
    billing: { inputPerM: 0.25, outputPerM: 2 },
  },
  {
    id: "openai:gpt-4.1",
    providerId: "openai",
    provider: "OpenAI",
    name: "GPT-4.1",
    apiModel: "gpt-4.1",
    blurb: "Long-context workhorse. Strong instruction following.",
    bestFor: "Media adaptations",
    envKeys: ["OPENAI_API_KEY"],
    endpoint: "https://api.openai.com/v1/chat/completions",
    estimateLabel: "~$0.006 / call",
    billing: { inputPerM: 2, outputPerM: 8 },
  },
  {
    id: "openai:gpt-4.1-mini",
    providerId: "openai",
    provider: "OpenAI",
    name: "GPT-4.1 mini",
    apiModel: "gpt-4.1-mini",
    blurb: "Fast, cheap, good JSON. Sensible default.",
    bestFor: "Trend + copy volume",
    envKeys: ["OPENAI_API_KEY"],
    endpoint: "https://api.openai.com/v1/chat/completions",
    estimateLabel: "~$0.001 / call",
    billing: { inputPerM: 0.4, outputPerM: 1.6 },
  },
  {
    id: "openai:o3",
    providerId: "openai",
    provider: "OpenAI",
    name: "o3",
    apiModel: "o3",
    blurb: "Heavier reasoning. Use when a claim is legally close.",
    bestFor: "Compliance edge cases",
    envKeys: ["OPENAI_API_KEY"],
    endpoint: "https://api.openai.com/v1/chat/completions",
    estimateLabel: "~$0.006 / call",
    billing: { inputPerM: 2, outputPerM: 8 },
  },
  {
    id: "anthropic:claude-opus-4.1",
    providerId: "anthropic",
    provider: "Claude",
    name: "Opus 4.1",
    apiModel: "claude-opus-4-1",
    blurb: "Highest-judgment Claude. Expensive, careful.",
    bestFor: "Compliance, founder-grade copy",
    envKeys: ["ANTHROPIC_API_KEY"],
    endpoint: "https://api.anthropic.com/v1/messages",
    estimateLabel: "~$0.048 / call",
    billing: { inputPerM: 15, outputPerM: 75 },
  },
  {
    id: "anthropic:claude-sonnet-4",
    providerId: "anthropic",
    provider: "Claude",
    name: "Sonnet 4",
    apiModel: "claude-sonnet-4-0",
    blurb: "Best everyday Claude. Strong at policy language.",
    bestFor: "Compliance + Trend",
    envKeys: ["ANTHROPIC_API_KEY"],
    endpoint: "https://api.anthropic.com/v1/messages",
    estimateLabel: "~$0.010 / call",
    billing: { inputPerM: 3, outputPerM: 15 },
  },
  {
    id: "anthropic:claude-haiku-3.5",
    providerId: "anthropic",
    provider: "Claude",
    name: "Haiku 3.5",
    apiModel: "claude-3-5-haiku-latest",
    blurb: "Fast Claude for volume passes.",
    bestFor: "Media Manager rewrites",
    envKeys: ["ANTHROPIC_API_KEY"],
    endpoint: "https://api.anthropic.com/v1/messages",
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
    endpoint: "https://api.cursor.com/v1/chat/completions",
    estimateLabel: "~$0.004 / call",
    billing: { inputPerM: 1.25, outputPerM: 6 },
    notes: "Wire the Cursor gateway in llm/adapters.ts",
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
    endpoint: "https://api.cursor.com/v1/chat/completions",
    estimateLabel: "~$0.006 / call",
    billing: { inputPerM: 2, outputPerM: 8 },
  },
  {
    id: "cursor:gpt-5",
    providerId: "cursor",
    provider: "Cursor",
    name: "GPT-5 via Cursor",
    apiModel: "gpt-5",
    blurb: "OpenAI through Cursor usage, not a separate OpenAI key.",
    bestFor: "When you already pay Cursor",
    envKeys: ["CURSOR_API_KEY"],
    endpoint: "https://api.cursor.com/v1/chat/completions",
    estimateLabel: "~$0.008 / call",
    billing: { inputPerM: 1.4, outputPerM: 11 },
  },
  {
    id: "cursor:claude-sonnet-4",
    providerId: "cursor",
    provider: "Cursor",
    name: "Sonnet 4 via Cursor",
    apiModel: "claude-sonnet-4-0",
    blurb: "Claude through Cursor usage.",
    bestFor: "Compliance without a separate Anthropic key",
    envKeys: ["CURSOR_API_KEY"],
    endpoint: "https://api.cursor.com/v1/chat/completions",
    estimateLabel: "~$0.011 / call",
    billing: { inputPerM: 3.3, outputPerM: 16.5 },
  },
];

export const DEFAULT_LLM = "openai:gpt-4.1-mini";

export const PROVIDER_DEFAULT_MODEL: Record<LlmProviderId, string> = {
  local: "local:llama3.3",
  openai: "openai:gpt-4.1-mini",
  anthropic: "anthropic:claude-sonnet-4",
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
    help: "Copy and prompts. Poster pixels still use the image model below.",
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

export function llmsByProvider(providerId: LlmProviderId | "all") {
  if (providerId === "all") return LLM_MODELS;
  return LLM_MODELS.filter((m) => m.providerId === providerId);
}

export function assignmentFor(provider: LlmProviderId, modelId?: string) {
  const models = llmsByProvider(provider);
  const id = models.some((m) => m.id === modelId) ? modelId! : PROVIDER_DEFAULT_MODEL[provider];
  return { provider, modelId: id };
}
