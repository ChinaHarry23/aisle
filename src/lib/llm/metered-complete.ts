/**
 * The single LLM completion entry point (credit hold, tool calling, local reroute).
 * Server-only: importing it from a Client Component would pull `pg` into the browser bundle.
 */

import { balanceMilli } from "@/lib/billing/ledger";
import { holdCredits, releaseHold, settleHold, type BillingContext, type Hold } from "@/lib/billing/meter";
import { formatCredits, milliForCost } from "@/lib/billing/plan";
import { callLlm, isLlmConfigured, localBase, systemFor } from "./adapters";
import { fetchLocalModel } from "./local-base";
import { getLlmOrDefault } from "./catalog";
import { estimateLlmUsage, llmCostUsd, usageFromProvider, worstCaseUsd } from "./estimate";
import { traceModelCall } from "./langsmith";
import { parseToolArgs } from "@/lib/pr2-shims";
import { stubComplete } from "./stub";
import type { CompleteRequest, CompleteResult, LlmModel, ToolCall } from "./types";

export const OUT_OF_CREDITS = "Out of credits — subscribe on Billing";

/** "Out of credits … Sonnet 5.5 needs 7.7 credits held per call; you have 3.2." */
async function outOfCreditsNote(model: LlmModel, req: CompleteRequest, billing: BillingContext | undefined) {
  if (billing?.kind !== "user") return OUT_OF_CREDITS;
  const needed = milliForCost(worstCaseUsd(model, req));
  try {
    const have = await balanceMilli(billing.userId);
    return `${OUT_OF_CREDITS}. ${model.name} needs ${formatCredits(needed)} credits held per call; you have ${formatCredits(Math.max(0, have))}.`;
  } catch {
    return `${OUT_OF_CREDITS}. ${model.name} needs ${formatCredits(needed)} credits held per call.`;
  }
}

/** `billing` undefined means nobody pays: cloud calls are not sent. */
export async function runComplete(req: CompleteRequest, billing?: BillingContext): Promise<CompleteResult> {
  const assigned = getLlmOrDefault(req.modelId);
  let model = assigned;
  let active = req;
  let reroute = "";
  let hold: Hold | null = null;
  const started = Date.now();

  const toLocal = async (why: string) => {
    // Poster checks carry images and must stay on the signed-in vision model.
    // The account's local URL is not given that key, so a free reroute is the
    // 401 that dropped GPT-6.1 Sol at the compliance step.
    if (req.direct || req.images?.length) return false;
    const local = getLlmOrDefault("local:custom");
    if (!isLlmConfigured(local, req.localBaseUrl)) return false;
    reroute = `${why} This decision ran free on the local model instead of ${assigned.name}.`;
    model = local;
    active = { ...req, modelId: model.id };
    return true;
  };

  if (assigned.providerId !== "local") {
    if (!isLlmConfigured(assigned)) {
      await toLocal(`${assigned.provider} is not set up on this server.`);
    } else {
      let unchecked = false;
      try {
        hold = await holdCredits(billing, worstCaseUsd(assigned, req));
      } catch (err) {
        // The ledger is unreachable: fail closed rather than spend unmetered.
        console.error("[credits] hold failed", err);
        unchecked = true;
      }
      if (!hold) {
        const short = unchecked ? "" : await outOfCreditsNote(assigned, req, billing);
        const why = unchecked ? "Credits could not be checked." : short.endsWith(".") ? short : `${short}.`;
        if (!(await toLocal(why))) {
          return unchecked
            ? stubComplete(req, "Credits could not be checked, so the cloud call was skipped.", "error")
            : stubComplete(req, short, "no_credits");
        }
      }
    }
  }

  if (!isLlmConfigured(model, active.localBaseUrl)) {
    return stubComplete(
      req,
      model.providerId === "local"
        ? "No local model is answering. Start MTPLX, LM Studio or Ollama, or pick a cloud model on Settings."
        : `${assigned.provider} is not available on this server. Start a local model or pick another provider.`,
      "unconfigured",
    );
  }

  try {
    const live: {
      text: string;
      inputTokens?: number;
      outputTokens?: number;
      toolCalls?: ToolCall[];
    } = await traceModelCall(model, active, () => {
      if (model.providerId === "openai" && (active.direct || active.webSearch || active.images?.length)) {
        return model.toolApi === "responses" ? callOpenAIResponses(model, active) : callOpenAIChatTools(model, active);
      }
      if (active.tools?.length || active.history?.length) return callLlmWithTools(model, active);
      return callLlm(model, active);
    });
    const latencyMs = Date.now() - started;
    const reported = live.inputTokens != null && live.outputTokens != null;
    const usage = reported
      ? usageFromProvider(model, live.inputTokens!, live.outputTokens!, latencyMs, req.agent)
      : estimateLlmUsage(model, active, latencyMs);
    if (hold) {
      // Without the provider's own counts, charge the hold: never less than it could have cost.
      const cost = reported ? llmCostUsd(model, live.inputTokens!, live.outputTokens!) : worstCaseUsd(model, req);
      if (!reported) usage.costUsd = Math.round(cost * 100000) / 100000;
      await settle(hold, cost, model, req);
    }
    const spoken = active.localModel && model.id === "local:custom" ? active.localModel : model.name;
    return {
      provider: model.provider,
      providerId: model.providerId,
      modelId: model.id,
      modelName: spoken,
      status: "ok",
      usage: { ...usage, estimate: !reported },
      text: live.text || null,
      ...(live.toolCalls?.length ? { toolCalls: live.toolCalls } : {}),
      note: reroute || `Live ${spoken}.`,
      at: new Date().toISOString(),
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Provider error";
    const failed = stubComplete(req, reason, "error");
    if (hold) await release(hold);
    return failed;
  }
}

/** The call already happened; a ledger hiccup must not turn it into a failure. */
async function settle(hold: Hold, costUsd: number, model: LlmModel, req: CompleteRequest) {
  try {
    // Rounded to a nano-dollar only to keep float noise out of the ledger.
    const note = `${model.name} · ${req.agent} decision`;
    await settleHold(hold, Math.round(costUsd * 1e9) / 1e9, { modelId: model.id, note });
  } catch (err) {
    console.error("[credits] settle failed", err);
  }
}

async function release(hold: Hold) {
  try {
    await releaseHold(hold);
  } catch (err) {
    console.error("[credits] release failed", err);
  }
}

function openaiBase() {
  return (process.env.OPENAI_API_BASE?.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
}

function openAIMessages(req: CompleteRequest): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [
    { role: "system", content: req.system || systemFor(req.agent) },
  ];
  for (const turn of req.history ?? []) {
    if (turn.role === "user") messages.push({ role: "user", content: turn.content });
    else if (turn.role === "assistant") {
      messages.push({
        role: "assistant",
        content: turn.content,
        ...(turn.toolCalls?.length
          ? {
              tool_calls: turn.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              })),
            }
          : {}),
      });
    } else {
      messages.push({ role: "tool", tool_call_id: turn.toolCallId, name: turn.name, content: turn.content });
    }
  }
  if (req.lastTurnIsToolResult) {
    messages.push({ role: "tool", tool_call_id: req.toolCallId, content: req.prompt });
  } else if (req.images?.length) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: req.prompt },
        ...req.images.map((url) => ({ type: "image_url", image_url: { url } })),
      ],
    });
  } else {
    messages.push({ role: "user", content: req.prompt });
  }
  return messages;
}

function openAITools(req: CompleteRequest) {
  return (req.tools ?? []).map((tool) => ({
    type: "function" as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

async function postOpenAI(path: string, body: unknown) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set.");
  const res = await fetch(`${openaiBase()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 240)}`);
  return (await res.json()) as Record<string, unknown>;
}

function toolCallsFromChat(message: {
  content?: string;
  tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
} | undefined): ToolCall[] {
  return (message?.tool_calls ?? [])
    .filter((call) => call.function?.name)
    .map((call, index) => ({
      id: call.id || `call_${index}`,
      name: call.function!.name!,
      args: parseToolArgs(call.function?.arguments),
    }));
}

/** GPT-6 Luna can call tools on Chat Completions only with reasoning turned off. */
async function callOpenAIChatTools(model: LlmModel, req: CompleteRequest) {
  const json = await postOpenAI("/chat/completions", {
    model: model.apiModel,
    reasoning_effort: "none",
    ...(req.maxOutputTokens !== undefined ? { max_completion_tokens: req.maxOutputTokens } : {}),
    messages: openAIMessages(req),
    ...(req.tools?.length ? { tools: openAITools(req), ...(req.toolChoice ? {tool_choice:req.toolChoice} : {}) } : {}),
    ...(req.responseSchema
      ? {
          response_format: {
            type: "json_schema",
            json_schema: { name: req.responseSchema.name, strict: true, schema: req.responseSchema.schema },
          },
        }
      : {}),
  });
  const message = (json.choices as { message?: { content?: string; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } }[] | undefined)?.[0]?.message;
  const usage = json.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  const toolCalls = toolCallsFromChat(message);
  return {
    text: message?.content ?? "",
    inputTokens: usage?.prompt_tokens,
    outputTokens: usage?.completion_tokens,
    ...(toolCalls.length ? { toolCalls } : {}),
  };
}

/** GPT-6 Astra and GPT-6.1 Sol accept function calls on the Responses API. */
async function callOpenAIResponses(model: LlmModel, req: CompleteRequest) {
  const input: Record<string, unknown>[] = [{ role: "system", content: req.system || systemFor(req.agent) }];
  for (const turn of req.history ?? []) {
    if (turn.role === "tool") {
      input.push({ type: "function_call_output", call_id: turn.toolCallId, output: turn.content });
    } else if (turn.role === "assistant" && turn.toolCalls?.length) {
      for (const call of turn.toolCalls) {
        input.push({ type: "function_call", call_id: call.id, name: call.name, arguments: JSON.stringify(call.args) });
      }
    } else {
      input.push({ role: turn.role === "assistant" ? "assistant" : "user", content: turn.content });
    }
  }
  if (req.lastTurnIsToolResult) input.push({ type: "function_call_output", call_id: req.toolCallId, output: req.prompt });
  else if (req.images?.length) {
    input.push({
      role: "user",
      content: [
        { type: "input_text", text: req.prompt },
        ...req.images.map((url) => ({ type: "input_image", image_url: url })),
      ],
    });
  } else input.push({ role: "user", content: req.prompt });

  const tools = [
    ...(req.webSearch ? [{ type: "web_search" }] : []),
    ...(req.tools ?? []).map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
  ];
  const json = await postOpenAI("/responses", {
    model: model.apiModel,
    input,
    reasoning: { effort: model.effort ?? "low" },
    ...(req.maxOutputTokens !== undefined ? { max_output_tokens: req.maxOutputTokens } : {}),
    ...(tools.length ? { tools, ...(req.toolChoice ? {tool_choice:req.toolChoice} : {}) } : {}),
    ...(req.responseSchema
      ? {
          text: {
            format: {
              type: "json_schema",
              name: req.responseSchema.name,
              strict: true,
              schema: req.responseSchema.schema,
            },
          },
        }
      : {}),
  });
  const output = (json.output as { type?: string; call_id?: string; name?: string; arguments?: string; text?: string; content?: { type?: string; text?: string }[] }[]) ?? [];
  const nested = output
    .filter((item) => item.type === "message" || item.type === "output_text")
    .flatMap((item) => item.content ?? (item.text ? [{ type: "output_text", text: item.text }] : []))
    .filter((part) => part.type === "output_text" && part.text)
    .map((part) => part.text)
    .join("");
  const text = nested || (typeof json.output_text === "string" ? json.output_text : "");
  const toolCalls: ToolCall[] = output
    .filter((item) => item.type === "function_call" && item.name)
    .map((item, index) => ({
      id: item.call_id || `call_${index}`,
      name: item.name!,
      args: parseToolArgs(item.arguments),
    }));
  const usage = json.usage as { input_tokens?: number; output_tokens?: number } | undefined;
  return {
    text,
    inputTokens: usage?.input_tokens,
    outputTokens: usage?.output_tokens,
    ...(toolCalls.length ? { toolCalls } : {}),
  };
}

/** Provider-safe aliases must also round-trip through assistant/tool history. */
async function callLlmWithTools(model: LlmModel, req: CompleteRequest) {
  if (model.providerId === "local") return callProviderTools(model, req);
  const aliases = new Map((req.tools ?? []).map(t => [t.name, t.name.replace(/[^a-zA-Z0-9_-]/g, c => `_${c.charCodeAt(0).toString(16)}_`)]));
  if (new Set(aliases.values()).size !== aliases.size || [...aliases.values()].some(name => name.length > 64)) throw Error('Tool alias collision or unsupported length.');
  // A collection phase may narrow the current tool list. Earlier calls still
  // need the same provider-safe names in history even when no longer offered.
  const wireName = (name: string) => aliases.get(name) ?? name.replace(/[^a-zA-Z0-9_-]/g, c => `_${c.charCodeAt(0).toString(16)}_`);
  const wire: CompleteRequest = {...req, tools:req.tools?.map(t => ({...t,name:wireName(t.name)})),
    history:req.history?.map(turn => turn.role === 'assistant' ? {...turn,toolCalls:turn.toolCalls?.map(call => ({...call,name:wireName(call.name)}))}
      : turn.role === 'tool' ? {...turn,...(turn.name ? {name:wireName(turn.name)} : {})} : turn)};
  const result = await callProviderTools(model, wire);
  const originals = new Map([...aliases].map(([original,alias]) => [alias,original]));
  return {...result, ...(result.toolCalls ? {toolCalls:result.toolCalls.map(call => ({...call,name:originals.get(call.name) ?? call.name}))} : {})};
}

/**
 * Tool-calling seats need OpenAI-format `tools` / `tool_calls`. OpenAI models go to the
 * Responses or Chat Completions helpers; local models go to the local OpenAI-compatible server.
 */
async function callProviderTools(
  model: LlmModel,
  req: CompleteRequest,
): Promise<{ text: string; inputTokens?: number; outputTokens?: number; toolCalls?: ToolCall[] }> {
  if (model.providerId === "openai") {
    return model.toolApi === "responses" ? callOpenAIResponses(model, req) : callOpenAIChatTools(model, req);
  }
  if (model.providerId !== "local") {
    throw new Error(`${model.provider} tool calling is not wired through Cindy's adapters.`);
  }
  const base = localBase(req);
  const apiModel = model.id === "local:custom" ? req.localModel || "llama3.3" : model.apiModel;
  const messages = openAIMessages({ ...req, images: undefined });

  const res = await fetchLocalModel(base, "chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model: apiModel,
      temperature: 0.4,
      messages,
      ...(req.tools?.length ? { tools: openAITools(req) } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`Local LLM ${res.status}: ${res.text.slice(0, 240)}`);
  }
  const json = JSON.parse(res.text) as {
    choices?: {
      message?: {
        content?: string;
        tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
      };
    }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const message = json.choices?.[0]?.message;
  const toolCalls = toolCallsFromChat(message);
  return {
    text: message?.content ?? "",
    inputTokens: json.usage?.prompt_tokens,
    outputTokens: json.usage?.completion_tokens,
    ...(toolCalls.length ? { toolCalls } : {}),
  };
}
