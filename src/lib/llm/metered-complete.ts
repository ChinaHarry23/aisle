/**
 * PR #2 metered completion funnel (billing, tool-calling, local reroute).
 *
 * Cindy's `src/lib/llm/complete.ts` stays the client-safe 1-arg path her
 * `decide.ts` / store import. This module is server-only: importing it from a
 * Client Component would pull `pg` into the browser bundle.
 */

import { balanceMilli } from "@/lib/billing/ledger";
import { holdCredits, releaseHold, settleHold, type BillingContext, type Hold } from "@/lib/billing/meter";
import { formatCredits, milliForCost } from "@/lib/billing/plan";
import { callLlm, isLlmConfigured, systemFor } from "./adapters";
import { getLlmOrDefault } from "./catalog";
import { estimateLlmUsage, llmCostUsd, usageFromProvider, worstCaseUsd } from "./estimate";
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

/**
 * `billing` is optional so Cindy's `runComplete(req)` call sites typecheck.
 * Pass `undefined` explicitly from PR #2 callers to mean "nobody pays", which
 * keeps cloud calls from going out at all when credits cannot be held.
 */
export async function runComplete(req: CompleteRequest, billing?: BillingContext): Promise<CompleteResult> {
  const assigned = getLlmOrDefault(req.modelId);
  let model = assigned;
  let active = req;
  let reroute = "";
  let hold: Hold | null = null;
  const started = Date.now();

  const toLocal = async (why: string) => {
    const local = getLlmOrDefault("local:custom");
    if (!isLlmConfigured(local, req.localBaseUrl || process.env.LOCAL_LLM_BASE_URL)) return false;
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
    } =
      active.tools?.length || active.history?.length
        ? await callLlmWithTools(model, active)
        : await callLlm(model, active);
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
async function settle(hold: Hold, costUsd: number, model: LlmModel, req: CompleteRequest, outcome?: string) {
  try {
    // Rounded to a nano-dollar only to keep float noise out of the ledger.
    const note = `${model.name} · ${req.agent} decision${outcome ? ` (${outcome})` : ""}`;
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

/**
 * Cindy's adapters return text only. Tool-calling seats (PR #2 LangChain)
 * need OpenAI-format `tools` / `tool_calls`, so this path talks to a local
 * OpenAI-compatible server without changing her adapter module.
 */
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
    ...(req.tools?.length ? { tools: openAITools(req) } : {}),
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
  else input.push({ role: "user", content: req.prompt });

  const json = await postOpenAI("/responses", {
    model: model.apiModel,
    input,
    reasoning: { effort: model.effort ?? "low" },
    ...(req.maxOutputTokens !== undefined ? { max_output_tokens: req.maxOutputTokens } : {}),
    ...(req.tools?.length
      ? {
          tools: req.tools.map((tool) => ({
            type: "function",
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        }
      : {}),
  });
  const output = (json.output as { type?: string; call_id?: string; name?: string; arguments?: string; content?: { type?: string; text?: string }[] }[]) ?? [];
  const text = output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text" && part.text)
    .map((part) => part.text)
    .join("");
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

async function callLlmWithTools(
  model: LlmModel,
  req: CompleteRequest,
): Promise<{ text: string; inputTokens?: number; outputTokens?: number; toolCalls?: ToolCall[] }> {
  if (model.providerId === "openai") {
    return model.toolApi === "responses" ? callOpenAIResponses(model, req) : callOpenAIChatTools(model, req);
  }
  if (model.providerId !== "local") {
    throw new Error(`${model.provider} tool calling is not wired through Cindy's adapters.`);
  }
  const base = (req.localBaseUrl || process.env.LOCAL_LLM_BASE_URL || "http://127.0.0.1:11434/v1").replace(
    /\/$/,
    "",
  );
  const apiModel = model.id === "local:custom" ? req.localModel || "llama3.3" : model.apiModel;
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
  } else {
    messages.push({ role: "user", content: req.prompt });
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: apiModel,
      temperature: 0.4,
      messages,
      ...(req.tools?.length
        ? {
            tools: req.tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
          }
        : {}),
    }),
    signal: AbortSignal.timeout(2_500),
  });
  if (!res.ok) {
    throw new Error(`Local LLM ${res.status}: ${(await res.text()).slice(0, 240)}`);
  }
  const json = (await res.json()) as {
    choices?: {
      message?: {
        content?: string;
        tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
      };
    }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const message = json.choices?.[0]?.message;
  const toolCalls: ToolCall[] = (message?.tool_calls ?? [])
    .filter((call) => call.function?.name)
    .map((call, index) => ({
      id: call.id || `call_${index}`,
      name: call.function!.name!,
      args: parseToolArgs(call.function?.arguments),
    }));
  return {
    text: message?.content ?? "",
    inputTokens: json.usage?.prompt_tokens,
    outputTokens: json.usage?.completion_tokens,
    ...(toolCalls.length ? { toolCalls } : {}),
  };
}
