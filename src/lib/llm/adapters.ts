import { LLM_PROVIDERS } from "./catalog";
import { isHosted } from "@/lib/billing/hosted";
import { outputCap } from "./estimate";
import type { CompleteRequest, LlmModel, ToolCall } from "./types";
import { POSTER_ARTIST_SYSTEM } from "../media/art-director-system";

export class LlmAdapterNotWiredError extends Error {
  constructor(provider: string) {
    super(`${provider} LLM adapter is not wired yet. Add the fetch in src/lib/llm/adapters.ts`);
    this.name = "LlmAdapterNotWiredError";
  }
}

/**
 * The model declined (Claude `stop_reason: "refusal"`, OpenAI `message.refusal`).
 * It still arrives as HTTP 200 with a usage block, and the provider bills
 * those tokens, so the counts travel with the error.
 */
export class LlmRefusalError extends Error {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  constructor(provider: string, detail?: string, usage: { inputTokens?: number; outputTokens?: number } = {}) {
    super(`${provider} declined this request${detail ? ` (${detail})` : ""}.`);
    this.name = "LlmRefusalError";
    this.inputTokens = usage.inputTokens;
    this.outputTokens = usage.outputTokens;
  }
}

/**
 * Our own client gave up waiting after the request went out. The provider may
 * well have finished (and billed) the call, so this is not a free failure.
 */
export class LlmTimeoutError extends Error {
  constructor(provider: string) {
    super(`${provider} did not answer in time.`);
    this.name = "LlmTimeoutError";
  }
}

/**
 * Client timeouts per provider, in ms. Opus 5.5 always thinks before answering,
 * so Claude gets the longest. Mutable only so offline tests can shorten them.
 */
export const LLM_TIMEOUTS = { local: 90_000, openai: 60_000, anthropic: 120_000 };

/** Base URLs, overridable so offline tests can point them at a fake server. */
export function openaiBase() {
  return (process.env.OPENAI_API_BASE?.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
}

export function anthropicBase() {
  return (process.env.ANTHROPIC_API_BASE?.trim() || "https://api.anthropic.com/v1").replace(/\/$/, "");
}

/** billing/hosted.ts has no imports, so this module stays free of the DB. */
const hostedInstall = isHosted;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function normaliseBase(url: string) {
  return url.trim().replace(/\/+$/, "");
}

/** The local servers this server itself is configured to use. */
function configuredLocalBases(): string[] {
  return [process.env.LOCAL_LLM_BASE_URL, ...localProbePorts()]
    .filter((url): url is string => Boolean(url?.trim()))
    .map(normaliseBase);
}

/**
 * The local LLM base URL a request may make this server call, or null.
 *
 * The URL comes from workspace settings, i.e. from a user, so it is never
 * trusted as-is: a URL the server is configured with (LOCAL_LLM_BASE_URL or
 * LOCAL_LLM_PROBE_URLS) always passes. On a hosted install nothing else does.
 * On a local install another port on loopback is allowed — http(s) to
 * 127.0.0.1, localhost or [::1], with no credentials, query or fragment — so
 * someone running Ollama on a different port still works.
 */
export function allowedLocalBase(url: string | undefined): string | null {
  if (!url?.trim()) return null;
  const wanted = normaliseBase(url);
  if (configuredLocalBases().includes(wanted)) return wanted;
  if (hostedInstall()) return null;
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

export function isLlmConfigured(model: LlmModel, localBaseUrl?: string) {
  // A provider dropped from the catalog (Cursor) is never callable, whatever is in env.
  if (!LLM_PROVIDERS.some((p) => p.id === model.providerId)) return false;
  if (model.providerId === "local") {
    return Boolean(allowedLocalBase(localBaseUrl) || process.env.LOCAL_LLM_BASE_URL?.trim());
  }
  return model.envKeys.every((key) => Boolean(process.env[key]));
}

/**
 * Fallback role text for a call that carries no system prompt of its own.
 *
 * These used to be the real instructions and ended with "Return JSON: …". That is
 * no longer how a seat is driven: the agents in `lib/agents/seats.ts` own their
 * instructions, and a structured answer now comes from a schema the model calls
 * rather than a JSON blob parsed out of prose. Asking for JSON here as well would
 * tell the model to do the wrong thing twice over. This exists only so a direct
 * completion with no system prompt still knows which seat it is.
 */
export function systemFor(agent: CompleteRequest["agent"]) {
  const role = {
    trend: "You are the Trend Analyser for a neighbourhood retailer.",
    creative: POSTER_ARTIST_SYSTEM,
    compliance:
      "You are the Compliance Checker for a neighbourhood retailer. You may analyse, flag and recommend corrections, but you never approve an advertisement: approval is a human decision.",
    media: "You are the Media Manager for a neighbourhood retailer.",
    intake:
      "You are the Conversational Intake Assistant for a neighbourhood retailer. You interview the founder to draft a campaign brief and never invent budget, dates, country, or channels.",
  };
  return role[agent];
}

/**
 * The conversation as OpenAI-shaped messages.
 *
 * Kept separate from the Anthropic translation below because the two providers
 * disagree about almost everything here: OpenAI puts tool calls on the assistant
 * message and results in `role: "tool"` messages, while Anthropic uses typed
 * content blocks and requires results in a user turn.
 */
function openAiMessages(system: string, req: CompleteRequest): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [{ role: "system", content: system }];
  for (const turn of req.history ?? []) {
    if (turn.role === "user") {
      messages.push({ role: "user", content: turn.content });
    } else if (turn.role === "assistant") {
      messages.push({
        role: "assistant",
        content: turn.content || null,
        ...(turn.toolCalls?.length
          ? {
              tool_calls: turn.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
              })),
            }
          : {}),
      });
    } else {
      messages.push({ role: "tool", tool_call_id: turn.toolCallId, content: turn.content });
    }
  }
  // The final turn is either the user's request or, mid-loop, the result of a tool
  // the model asked for. Providers require the latter to stay a tool message paired
  // to its call id, so it cannot be flattened into a plain user turn.
  if (req.lastTurnIsToolResult) {
    messages.push({ role: "tool", tool_call_id: req.toolCallId ?? "", content: req.prompt });
  } else {
    messages.push({ role: "user", content: req.prompt });
  }
  return messages;
}

/** The conversation as Anthropic's `messages` array with typed content blocks. */
function anthropicMessages(req: CompleteRequest): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  for (const turn of req.history ?? []) {
    if (turn.role === "user") {
      messages.push({ role: "user", content: turn.content });
    } else if (turn.role === "assistant") {
      const content: Record<string, unknown>[] = [];
      if (turn.content) content.push({ type: "text", text: turn.content });
      for (const call of turn.toolCalls ?? []) {
        content.push({ type: "tool_use", id: call.id, name: call.name, input: call.args ?? {} });
      }
      messages.push({ role: "assistant", content: content.length ? content : [{ type: "text", text: "" }] });
    } else {
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: turn.toolCallId, content: turn.content }],
      });
    }
  }
  if (req.lastTurnIsToolResult) {
    messages.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: req.toolCallId ?? "", content: req.prompt }],
    });
  } else {
    messages.push({ role: "user", content: req.prompt });
  }
  return messages;
}

/**
 * Provider tools, in the one shape each expects.
 *
 * Both take `input_schema` / `parameters` as JSON Schema, which is exactly what a
 * LangChain tool's schema serialises to, so the same `ToolSpec` feeds both.
 */
function openAiTools(req: CompleteRequest) {
  if (!req.tools?.length) return undefined;
  return req.tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

function anthropicTools(req: CompleteRequest) {
  if (!req.tools?.length) return undefined;
  return req.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

export function buildLlmBody(model: LlmModel, req: CompleteRequest): Record<string, unknown> {
  const apiModel = model.id === "local:custom" ? req.localModel || "llama3.1" : model.apiModel;
  const system = req.system ?? systemFor(req.agent);
  const messages = openAiMessages(system, req);
  if (model.providerId === "anthropic") {
    // Claude 5.x rejects temperature, and its thinking counts toward max_tokens;
    // effort keeps that thinking short. Haiku 4.5 takes no effort setting.
    return {
      model: apiModel,
      max_tokens: outputCap(model, req),
      system,
      messages: anthropicMessages(req),
      ...(anthropicTools(req) ? { tools: anthropicTools(req) } : {}),
      ...(model.effort ? { output_config: { effort: model.effort } } : {}),
    };
  }
  if (model.providerId === "openai") {
    // max_completion_tokens (not max_tokens) also bounds reasoning tokens, so
    // no call can cost more than the credit hold. Reasoning models reject temperature.
    return {
      model: apiModel,
      messages,
      max_completion_tokens: outputCap(model, req),
      ...(openAiTools(req) ? { tools: openAiTools(req) } : {}),
      ...(model.reasoning ? { reasoning_effort: model.effort ?? "low" } : { temperature: 0.4 }),
    };
  }
  return {
    model: apiModel,
    temperature: 0.4,
    messages,
    ...(openAiTools(req) ? { tools: openAiTools(req) } : {}),
    ...(req.maxOutputTokens !== undefined ? { max_tokens: outputCap(model, req) } : {}),
    // Qwen on MTPLX otherwise spends the whole call in its thinking pass.
    chat_template_kwargs: { enable_thinking: false },
  };
}

function localBase(req: CompleteRequest) {
  return (
    allowedLocalBase(req.localBaseUrl) ??
    normaliseBase(process.env.LOCAL_LLM_BASE_URL?.trim() || "http://127.0.0.1:11434/v1")
  );
}

type ProviderJson = {
  choices?: {
    message?: {
      content?: string | null;
      refusal?: string | null;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string;
  }[];
  content?: { type?: string; text?: string; id?: string; name?: string; input?: unknown }[];
  stop_reason?: string;
  stop_details?: { category?: string };
  usage?: { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
};

/**
 * Parse tool-call arguments without letting a malformed call look like a call
 * with no arguments.
 *
 * Providers are supposed to return a JSON object. When one returns something
 * unparseable, recording it as `{ __unparsed }` means the tool runs with a
 * visibly wrong input (and fails loudly) instead of silently seeing `{}`.
 */
export function parseToolArgs(raw: string | undefined | null): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { __unparsed: raw };
  } catch {
    return { __unparsed: raw };
  }
}

/** OpenAI-style `tool_calls` on the assistant message. */
function openAiToolCalls(json: ProviderJson): ToolCall[] {
  const calls = json.choices?.[0]?.message?.tool_calls ?? [];
  return calls
    .filter((call) => call?.function?.name)
    .map((call, index) => ({
      id: call.id || `call_${index}`,
      name: call.function!.name!,
      args: parseToolArgs(call.function?.arguments),
    }));
}

/** Anthropic-style `tool_use` content blocks. */
function anthropicToolCalls(json: ProviderJson): ToolCall[] {
  return (json.content ?? [])
    .filter((part) => part.type === "tool_use" && part.name)
    .map((part, index) => ({
      id: part.id || `call_${index}`,
      name: part.name!,
      args: part.input && typeof part.input === "object" ? (part.input as Record<string, unknown>) : {},
    }));
}

/**
 * POST and parse. Upstream bodies are logged here and never returned: the
 * error text reaches the caller as a note, and for a local URL the upstream
 * could be anything on the server's network. Redirects are refused for the
 * same reason.
 */
async function postJson(
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
) {
  let raw: string;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    raw = await res.text();
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new LlmTimeoutError(provider);
    }
    console.error(`[llm] ${provider} request failed`, err);
    throw new Error(`Could not reach ${provider}.`);
  }
  if (!res.ok) {
    console.error(`[llm] HTTP ${res.status} from ${provider}: ${raw.slice(0, 240)}`);
    throw new Error(`HTTP ${res.status} from ${provider}`);
  }
  try {
    return JSON.parse(raw) as ProviderJson;
  } catch {
    console.error(`[llm] non-JSON reply from ${provider}: ${raw.slice(0, 240)}`);
    throw new Error(`${provider} returned a non-JSON reply.`);
  }
}

export type LlmCallResult = {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  /** The output ceiling was reached, so the text may be cut short. */
  truncated?: boolean;
  /** Tools the model asked us to run before it can answer. */
  toolCalls?: ToolCall[];
};

export async function callLlm(model: LlmModel, req: CompleteRequest): Promise<LlmCallResult> {
  if (model.providerId === "local") {
    const json = await postJson(
      model.provider,
      `${localBase(req)}/chat/completions`,
      { "Content-Type": "application/json" },
      buildLlmBody(model, req),
      LLM_TIMEOUTS.local,
    );
    return {
      text: json.choices?.[0]?.message?.content ?? "",
      inputTokens: json.usage?.prompt_tokens,
      outputTokens: json.usage?.completion_tokens,
      toolCalls: openAiToolCalls(json),
    };
  }

  if (model.providerId === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new LlmAdapterNotWiredError(model.provider);
    const json = await postJson(
      model.provider,
      `${openaiBase()}${model.endpoint}`,
      { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      buildLlmBody(model, req),
      LLM_TIMEOUTS.openai,
    );
    const choice = json.choices?.[0];
    if (choice?.message?.refusal) {
      throw new LlmRefusalError(model.provider, choice.message.refusal.slice(0, 120), {
        inputTokens: json.usage?.prompt_tokens,
        outputTokens: json.usage?.completion_tokens,
      });
    }
    return {
      text: choice?.message?.content ?? "",
      inputTokens: json.usage?.prompt_tokens,
      outputTokens: json.usage?.completion_tokens,
      truncated: choice?.finish_reason === "length",
      toolCalls: openAiToolCalls(json),
    };
  }

  if (model.providerId === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new LlmAdapterNotWiredError(model.provider);
    const json = await postJson(
      model.provider,
      `${anthropicBase()}${model.endpoint}`,
      {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      buildLlmBody(model, req),
      LLM_TIMEOUTS.anthropic,
    );
    // A refusal is HTTP 200 with no usable answer; treat it as a failed call.
    if (json.stop_reason === "refusal") {
      throw new LlmRefusalError(model.provider, json.stop_details?.category, {
        inputTokens: json.usage?.input_tokens,
        outputTokens: json.usage?.output_tokens,
      });
    }
    const text = (json.content ?? [])
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("");
    return {
      text,
      inputTokens: json.usage?.input_tokens,
      outputTokens: json.usage?.output_tokens,
      truncated: json.stop_reason === "max_tokens",
      toolCalls: anthropicToolCalls(json),
    };
  }

  throw new LlmAdapterNotWiredError(model.provider);
}

/**
 * Loopback servers tried for a free local model: MTPLX, LM Studio, Ollama.
 * LOCAL_LLM_PROBE_URLS (comma list) replaces them; set it empty on a hosted
 * deployment, where nothing listens on loopback, and in offline tests.
 */
function localProbePorts(): string[] {
  const custom = process.env.LOCAL_LLM_PROBE_URLS;
  if (custom !== undefined) return custom.split(",").map((url) => url.trim()).filter(Boolean);
  return ["http://127.0.0.1:8000/v1", "http://127.0.0.1:1234/v1", "http://127.0.0.1:11434/v1"];
}

/**
 * A local OpenAI-compatible server with a model that can actually answer.
 * LM Studio lists every installed model, including ones that are not loaded, so
 * a bare `/v1/models` hit is not enough — an unloaded id fails the chat call.
 */
export async function findLiveLocal(req: CompleteRequest): Promise<{ base: string; model: string } | null> {
  const [first, ...rest] = localProbePorts();
  const bases = [first, process.env.LOCAL_LLM_BASE_URL, allowedLocalBase(req.localBaseUrl), ...rest].filter(
    (value): value is string => Boolean(value),
  );
  const seen = new Set<string>();
  for (const raw of bases) {
    const base = raw.replace(/\/$/, "");
    if (seen.has(base)) continue;
    seen.add(base);
    const loaded = await loadedLocalModel(base, req.localModel);
    if (loaded) return { base, model: loaded };
  }
  return null;
}

export async function loadedLocalModel(base: string, preferred?: string): Promise<string | null> {
  const root = base.replace(/\/v1$/, "");
  try {
    const native = await fetch(`${root}/api/v0/models`, { redirect: "error", signal: AbortSignal.timeout(800) });
    if (native.ok) {
      const json = (await native.json()) as {
        data?: { id?: string; state?: string; type?: string }[];
      };
      const rows = json.data ?? [];
      const ready = rows.filter((row) => row.state === "loaded" && row.type !== "embeddings" && row.id);
      const pick = ready.find((row) => row.id === preferred) ?? ready[0];
      return pick?.id ?? null;
    }
  } catch {
    // Not LM Studio. Fall through to a plain model list (Ollama).
  }
  try {
    const res = await fetch(`${base}/models`, { redirect: "error", signal: AbortSignal.timeout(800) });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { id?: string }[]; models?: { name?: string }[] };
    return json.data?.find((row) => row.id)?.id || json.models?.find((row) => row.name)?.name || preferred || null;
  } catch {
    return null;
  }
}
