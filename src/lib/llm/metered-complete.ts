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
async function callLlmWithTools(
  model: LlmModel,
  req: CompleteRequest,
): Promise<{ text: string; inputTokens?: number; outputTokens?: number; toolCalls?: ToolCall[] }> {
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
