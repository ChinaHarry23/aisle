import type { AgentSlot, LlmModel, LlmProviderId } from "./types";

/** Every cloud call is capped, so its worst-case cost (and credit hold) is known up front. */
const OPENAI_MAX_OUTPUT = 2000;
/**
 * Claude 5.x thinking counts toward `max_tokens`. At effort "low" a decision
 * thinks briefly and answers in a few hundred tokens, so 3,000 leaves room for
 * the JSON while keeping the credit hold near 7 (Sonnet) / 13 (Opus) credits.
 */
const ANTHROPIC_MAX_OUTPUT = 3000;
/** gpt-5, gpt-5-mini and o3 have one snapshot each, all on OpenAI's deprecation list. */
const OPENAI_GPT5_SUNSET = "2026-12-11";

export const LLM_PROVIDERS: { id: LlmProviderId; name: string; blurb: string }[] = [
  {
    id: "local",
    name: "Local",
    blurb: "Qwen3.8 on MTPLX by default; Ollama or LM Studio through Custom tag. Free, never uses credits.",
  },
  { id: "openai", name: "OpenAI", blurb: "GPT family on Aisle's OpenAI key, paid in credits." },
  { id: "anthropic", name: "Claude", blurb: "Anthropic Messages API on Aisle's key, paid in credits." },
];

/** Shown greyed out in pickers so nobody wonders where they went. */
export const UNAVAILABLE_LLM_PROVIDERS: { id: string; name: string; reason: string }[] = [
  { id: "cursor", name: "Cursor", reason: "Cursor has no public completions API, so Aisle cannot call it." },
];

export const LLM_MODELS: LlmModel[] = [
  {
    id: "local:qwen3.8-mtplx",
    providerId: "local",
    provider: "Local",
    name: "Qwen3.8 Flash-Next",
    apiModel: "mtplx-flash-next-optimized-speed",
    blurb: "Qwen 3.8 Flash-Next served by MTPLX on this Mac.",
    bestFor: "Agentic reasoning and code",
    envKeys: ["LOCAL_LLM_BASE_URL"],
    endpoint: "/chat/completions",
    estimateLabel: "$0 / call",
    billing: { inputPerM: 0, outputPerM: 0 },
    notes: "MTPLX · mtplx quickstart --port 8000",
  },
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
    id: "openai:gpt-6.1-sol",
    providerId: "openai",
    provider: "OpenAI",
    name: "GPT-6.1 Sol",
    apiModel: "gpt-6.1-sol",
    blurb: "Current mid-size GPT-6. Strong reasoning at an everyday price.",
    bestFor: "Default for every seat",
    envKeys: ["OPENAI_API_KEY"],
    endpoint: "/chat/completions",
    estimateLabel: "~$0.017 / call",
    billing: { inputPerM: 2, outputPerM: 10 },
    maxOutputTokens: OPENAI_MAX_OUTPUT,
    reasoning: true,
    // Sol rejects reasoning_effort "none" and "minimal"; "low" is its floor.
    effort: "low",
  },
  {
    id: "openai:gpt-6-astra",
    providerId: "openai",
    provider: "OpenAI",
    name: "GPT-6 Astra",
    apiModel: "gpt-6-astra",
    blurb: "OpenAI's flagship. Deepest reasoning, five times Sol's price.",
    bestFor: "Hero campaigns, legally close claims",
    envKeys: ["OPENAI_API_KEY"],
    endpoint: "/chat/completions",
    estimateLabel: "~$0.087 / call",
    billing: { inputPerM: 10, outputPerM: 50 },
    maxOutputTokens: OPENAI_MAX_OUTPUT,
    reasoning: true,
    effort: "low",
  },
  {
    id: "openai:gpt-6-luna",
    providerId: "openai",
    provider: "OpenAI",
    name: "GPT-6 Luna",
    apiModel: "gpt-6-luna",
    blurb: "Current small GPT-6. Cheapest cloud brain, with light reasoning.",
    bestFor: "Whole-bench volume on credits",
    envKeys: ["OPENAI_API_KEY"],
    endpoint: "/chat/completions",
    estimateLabel: "~$0.001 / call",
    billing: { inputPerM: 0.1, outputPerM: 0.5 },
    maxOutputTokens: OPENAI_MAX_OUTPUT,
    reasoning: true,
    effort: "low",
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
    endpoint: "/chat/completions",
    estimateLabel: "~$0.017 / call",
    billing: { inputPerM: 1.25, outputPerM: 10 },
    maxOutputTokens: OPENAI_MAX_OUTPUT,
    reasoning: true,
    effort: "low",
    sunset: OPENAI_GPT5_SUNSET,
    notes: `Retires ${OPENAI_GPT5_SUNSET}`,
  },
  {
    id: "openai:gpt-5-mini",
    providerId: "openai",
    provider: "OpenAI",
    name: "GPT-5 mini",
    apiModel: "gpt-5-mini",
    blurb: "Cheap reasoning. GPT-6 Luna is cheaper and current.",
    bestFor: "Budget reasoning",
    envKeys: ["OPENAI_API_KEY"],
    endpoint: "/chat/completions",
    estimateLabel: "~$0.003 / call",
    billing: { inputPerM: 0.25, outputPerM: 2 },
    maxOutputTokens: OPENAI_MAX_OUTPUT,
    reasoning: true,
    effort: "low",
    sunset: OPENAI_GPT5_SUNSET,
    notes: `Retires ${OPENAI_GPT5_SUNSET}`,
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
    endpoint: "/chat/completions",
    estimateLabel: "~$0.008 / call",
    billing: { inputPerM: 2, outputPerM: 8 },
    maxOutputTokens: OPENAI_MAX_OUTPUT,
  },
  {
    id: "openai:gpt-4.1-mini",
    providerId: "openai",
    provider: "OpenAI",
    name: "GPT-4.1 mini",
    apiModel: "gpt-4.1-mini",
    blurb: "Fast, cheap, good JSON, no reasoning.",
    bestFor: "Trend + copy volume",
    envKeys: ["OPENAI_API_KEY"],
    endpoint: "/chat/completions",
    estimateLabel: "~$0.002 / call",
    billing: { inputPerM: 0.4, outputPerM: 1.6 },
    maxOutputTokens: OPENAI_MAX_OUTPUT,
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
    endpoint: "/chat/completions",
    estimateLabel: "~$0.015 / call",
    billing: { inputPerM: 2, outputPerM: 8 },
    maxOutputTokens: OPENAI_MAX_OUTPUT,
    reasoning: true,
    effort: "low",
    sunset: OPENAI_GPT5_SUNSET,
    notes: `Retires ${OPENAI_GPT5_SUNSET}`,
  },
  {
    id: "anthropic:claude-opus-5-5",
    providerId: "anthropic",
    provider: "Claude",
    name: "Opus 5.5",
    apiModel: "claude-opus-5-5",
    blurb: "Highest-judgment Claude. Always thinks; careful and pricier.",
    bestFor: "Compliance, founder-grade copy",
    envKeys: ["ANTHROPIC_API_KEY"],
    endpoint: "/messages",
    estimateLabel: "~$0.036 / call",
    billing: { inputPerM: 4, outputPerM: 20 },
    maxOutputTokens: ANTHROPIC_MAX_OUTPUT,
    effort: "low",
  },
  {
    id: "anthropic:claude-sonnet-5-5",
    providerId: "anthropic",
    provider: "Claude",
    name: "Sonnet 5.5",
    apiModel: "claude-sonnet-5-5",
    blurb: "Best everyday Claude. Strong at policy language.",
    bestFor: "Compliance + Trend",
    envKeys: ["ANTHROPIC_API_KEY"],
    endpoint: "/messages",
    estimateLabel: "~$0.018 / call",
    billing: { inputPerM: 2, outputPerM: 10 },
    maxOutputTokens: ANTHROPIC_MAX_OUTPUT,
    effort: "low",
  },
  {
    id: "anthropic:claude-haiku-4-5",
    providerId: "anthropic",
    provider: "Claude",
    name: "Haiku 4.5",
    apiModel: "claude-haiku-4-5",
    blurb: "Fast Claude for volume passes.",
    bestFor: "Media Manager rewrites",
    envKeys: ["ANTHROPIC_API_KEY"],
    endpoint: "/messages",
    estimateLabel: "~$0.005 / call",
    billing: { inputPerM: 1, outputPerM: 5 },
    maxOutputTokens: ANTHROPIC_MAX_OUTPUT,
  },
];

/** GPT-6.1 Sol: OpenAI's current recommended mid-size model (released 2026-04-30). */
export const DEFAULT_LLM = "openai:gpt-6.1-sol";

/** What `mtplx quickstart` serves: Qwen3.8 Flash-Next, Optimized Speed pack. */
export const LOCAL_DEFAULT_LLM = "local:qwen3.8-mtplx";

export const PROVIDER_DEFAULT_MODEL: Record<LlmProviderId, string> = {
  local: LOCAL_DEFAULT_LLM,
  openai: DEFAULT_LLM,
  anthropic: "anthropic:claude-sonnet-5-5",
};

/**
 * Ids saved by older builds, mapped to the direct model that replaces them, so
 * a stored seat keeps its provider and price class instead of silently
 * becoming the global default. Anthropic retired every 4.x id listed here;
 * Cursor has no public completions API, so its seats move to the same model
 * called directly.
 */
export const LLM_ALIASES: Record<string, string> = {
  "anthropic:claude-opus-4.1": "anthropic:claude-opus-5-5",
  "anthropic:claude-sonnet-4": "anthropic:claude-sonnet-5-5",
  "anthropic:claude-haiku-3.5": "anthropic:claude-haiku-4-5",
  "cursor:composer": DEFAULT_LLM,
  "cursor:auto": DEFAULT_LLM,
  "cursor:gpt-5": "openai:gpt-5",
  "cursor:claude-sonnet-4": "anthropic:claude-sonnet-5-5",
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

/** The id a stored or requested model id refers to today. */
export function canonicalLlmId(id: string | undefined): string | undefined {
  if (!id) return id;
  return LLM_ALIASES[id] ?? id;
}

export function getLlmModel(id: string): LlmModel {
  const canonical = canonicalLlmId(id);
  const found = LLM_MODELS.find((m) => m.id === canonical);
  if (!found) throw new Error(`Unknown LLM: ${id}`);
  return found;
}

export function findLlm(id: string | undefined): LlmModel | undefined {
  const canonical = canonicalLlmId(id);
  return LLM_MODELS.find((m) => m.id === canonical);
}

/**
 * Unknown ids stay with their provider's default rather than jumping to
 * another provider (and another price) without anyone choosing it.
 */
export function getLlmOrDefault(id: string | undefined): LlmModel {
  const found = findLlm(id);
  if (found) return found;
  const provider = id?.split(":")[0];
  const fallback = LLM_PROVIDERS.find((p) => p.id === provider);
  return getLlmModel(fallback ? PROVIDER_DEFAULT_MODEL[fallback.id] : DEFAULT_LLM);
}

export function llmsByProvider(providerId: LlmProviderId | "all") {
  if (providerId === "all") return LLM_MODELS;
  return LLM_MODELS.filter((m) => m.providerId === providerId);
}

export function assignmentFor(provider: LlmProviderId, modelId?: string) {
  const models = llmsByProvider(provider);
  const canonical = canonicalLlmId(modelId);
  const id = models.some((m) => m.id === canonical) ? canonical! : PROVIDER_DEFAULT_MODEL[provider];
  return { provider, modelId: id };
}
