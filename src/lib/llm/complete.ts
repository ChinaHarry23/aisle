/**
 * The one funnel every agent LLM call goes through.
 *
 * Local models are free and never touch billing. A cloud call runs on the
 * owner's key, so it first holds the worst case (catalog price × the output
 * ceiling), then settles what the provider reports it used. A refusal is
 * settled at its reported tokens and a client timeout at a typical call, since
 * the provider bills both; an HTTP error releases the hold. Whoever cannot
 * pay is moved to a local model when one is answering; otherwise nothing is
 * sent and the decision layer falls back to its deterministic rules.
 */

import { balanceMilli } from "@/lib/billing/ledger";
import { holdCredits, releaseHold, settleHold, type BillingContext, type Hold } from "@/lib/billing/meter";
import { formatCredits, milliForCost } from "@/lib/billing/plan";
import { callLlm, findLiveLocal, isLlmConfigured, LlmRefusalError, LlmTimeoutError } from "./adapters";
import { getLlmOrDefault } from "./catalog";
import { estimateLlmUsage, llmCostUsd, usageFromProvider, worstCaseUsd } from "./estimate";
import { stubComplete } from "./stub";
import type { CompleteRequest, CompleteResult, LlmModel } from "./types";

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
 * `billing` is required so a new caller cannot forget who pays; pass
 * `undefined` explicitly to mean "nobody", which keeps cloud calls from going
 * out at all.
 */
export async function runComplete(req: CompleteRequest, billing: BillingContext | undefined): Promise<CompleteResult> {
  const assigned = getLlmOrDefault(req.modelId);
  let model = assigned;
  let active = req;
  let reroute = "";
  let hold: Hold | null = null;
  const started = Date.now();

  const toLocal = async (why: string) => {
    const seat = await findLiveLocal(req);
    if (!seat) return false;
    reroute = `${why} This decision ran free on the local model ${seat.model} instead of ${assigned.name}.`;
    model = getLlmOrDefault("local:custom");
    active = { ...req, modelId: model.id, localBaseUrl: seat.base, localModel: seat.model };
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
    const live = await callLlm(model, active);
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
    const cut = live.truncated ? " The reply hit the output limit and may be cut short." : "";
    return {
      provider: model.provider,
      providerId: model.providerId,
      modelId: model.id,
      modelName: spoken,
      status: "ok",
      usage: { ...usage, estimate: !reported },
      text: live.text || null,
      // Carried through so a tool-using agent can run what the model asked for
      // and send the result back. Plain decisions never set this.
      ...(live.toolCalls?.length ? { toolCalls: live.toolCalls } : {}),
      note: `${reroute || `Live ${spoken}.`}${cut}`,
      at: new Date().toISOString(),
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Provider error";
    const failed = stubComplete(req, reason, "error");
    const latencyMs = Date.now() - started;
    if (err instanceof LlmRefusalError && (err.inputTokens != null || err.outputTokens != null)) {
      // A refusal is billed by the provider for the tokens it reports.
      const inputTokens = err.inputTokens ?? 0;
      const outputTokens = err.outputTokens ?? 0;
      if (hold) await settle(hold, llmCostUsd(model, inputTokens, outputTokens), model, req, "refused");
      return { ...failed, usage: usageFromProvider(model, inputTokens, outputTokens, latencyMs, req.agent) };
    }
    if (err instanceof LlmTimeoutError && hold) {
      // The request went out and may have run to completion upstream: charge a typical call.
      const usage = estimateLlmUsage(model, active, latencyMs);
      await settle(hold, usage.costUsd, model, req, "timed out");
      return { ...failed, usage };
    }
    // HTTP errors and unreachable servers carry no usage and are not billed.
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
