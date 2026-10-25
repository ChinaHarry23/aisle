/**
 * Seat-level entry point: run one agent, get its structured answer.
 *
 * `seats.ts` builds an agent; this decides *whether* to build one and turns the
 * model's answer into the trace the run log already speaks. The decision functions
 * in `runtime/decide.ts` call in here and keep their deterministic fallbacks: an
 * agent that cannot run (no key, no credits, no local model, a refused call, a
 * budget stop) must degrade to rules rather than fail the campaign.
 */

import type { z } from "zod";
import type { BillingContext } from "@/lib/billing/meter";
import type { CompleteResult } from "@/lib/llm/types";
import { getLlmOrDefault } from "@/lib/llm/catalog";
import { runComplete } from "@/lib/llm/metered-complete";
import type { ToolAgent } from "@/lib/runtime/tools";
import { agentTools, type AgentToolContext } from "./agent-tools";
import {
  MeteredCallUnavailable,
  MeteredChatModel,
  MAX_MODEL_CALLS_PER_RUN,
} from "./metered-chat-model";
import { buildAgent, SEAT_SCHEMAS, type AgentSeat } from "./seats";

export type AgentAnswer<T> = {
  /** Every model that answered, so a local reroute is visible. */
  models: string[];
  answer: T;
  /** Mirrors `DecisionTrace`, so the engine records one shape of trace. */
  trace: {
    modelId: string;
    modelName: string;
    status: CompleteResult["status"];
    path: "live_model" | "deterministic_fallback";
    note: string;
    usage: CompleteResult["usage"];
  };
  /** What the agent decided to call, in order. */
  usedTools: string[];
};

/** The trace for a decision that ran on the deterministic rules. */
function ruleTrace(seat: AgentSeat, modelId: string, note: string): AgentAnswer<never>["trace"] {
  const model = getLlmOrDefault(modelId);
  return {
    modelId: model.id,
    modelName: model.name,
    status: "stubbed",
    path: "deterministic_fallback",
    note,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      billedAs: "not called",
      estimate: true,
      latencyMs: 0,
    },
  };
}

/**
 * Run a seat's agent.
 *
 * Returns `null` when no agent could run, so the caller uses its rules. Every
 * failure mode is deliberately non-fatal: a marketing pipeline that stops because
 * a model was unavailable would be worse than one that falls back, and the run
 * trace records which happened.
 */
export async function runSeatAgent<T>(options: {
  seat: AgentSeat;
  /** Which tool slice the seat may call. Matches the seat name. */
  toolAgent: ToolAgent;
  modelId: string;
  billing: BillingContext | undefined;
  localBaseUrl?: string;
  localModel?: string;
  /** The task, written by the caller with its campaign context. */
  task: string;
  tools?: AgentToolContext;
  /** When false, the seat answers without calling tools. */
  bindTools?: boolean;
  /** Overrides the seat's default answer schema. */
  schema?: z.ZodType<T>;
  /**
   * Replaces the seat's default instructions.
   *
   * The creative seat has a longer art-director brief than the generic one, and an
   * agent that ignored it would lose the representation restrictions the copy
   * validation depends on.
   */
  instructions?: string;
  /** Output allowance per model call, for seats that legitimately need more. */
  maxOutputTokens?: number;
  /** Logs a decision to the run trace (one line per model turn is the engine's job). */
  onNote?: (note: string) => void;
  /**
   * Books a run that failed after the provider had already been charged.
   *
   * A successful run carries its total in the trace, which the caller books. A run
   * that threw has no trace, but its calls were still settled by the funnel — so
   * without this a seat that errored and fell back to the rules would spend money
   * the campaign's meter never showed.
   */
  onFailedUsage?: (costUsd: number) => void;
  /** Test transport or a server-side bounded wrapper around the shared metered funnel. */
  complete?: ConstructorParameters<typeof MeteredChatModel>[0]["complete"];
}): Promise<AgentAnswer<T> | null> {
  // Each tool call is announced, so the run trace can show what the agent chose.
  const used: string[] = [];
  const library =
    options.bindTools === false || !options.tools
      ? []
      : agentTools(options.toolAgent, {
          ...options.tools,
          execute: async (name, args) => {
            used.push(name);
            return options.tools!.execute(name, args);
          },
        });

  const model = new MeteredChatModel({
    agent: options.seat,
    modelId: options.modelId,
    billing: options.billing,
    localBaseUrl: options.localBaseUrl,
    localModel: options.localModel,
    maxOutputTokens: options.maxOutputTokens,
    complete: options.complete ?? runComplete,
  });

  const agent = buildAgent<T>({
    seat: options.seat,
    chat: model,
    tools: library,
    ...(options.instructions ? { instructions: options.instructions } : {}),
    // The seat's schema is fixed per seat; the cast keeps the caller's `T` honest
    // without duplicating the schema map as per-seat overloads.
    schema: (options.schema ?? SEAT_SCHEMAS[options.seat]) as unknown as z.ZodType<T>,
  });

  let failed = false;
  try {
    const answer = await agent.invoke({ task: options.task });
    const assigned = getLlmOrDefault(options.modelId);
    const spoken = model.usage.models.length ? model.usage.models.join(", ") : assigned.name;
    return {
      answer,
      models: model.usage.models,
      usedTools: used,
      trace: {
        // The model that actually answered: a cloud seat rerouted to a local model
        // is reported as the local one, exactly as a single call would be.
        modelId: model.usage.models.includes(assigned.name) ? assigned.id : options.modelId,
        modelName: spoken,
        status: "ok",
        path: "live_model",
        note: `${spoken} ran aisle_${options.seat} over ${model.usage.calls} model call(s), ceiling ${MAX_MODEL_CALLS_PER_RUN}${
          used.length ? `; tools: ${used.join(", ")}` : "; no tools needed"
        }. ${model.usage.lastNote}`.trim(),
        // The real total for the run, so the campaign's spend meter books what the
        // credit ledger was actually charged across every turn.
        usage: {
          inputTokens: model.usage.inputTokens,
          outputTokens: model.usage.outputTokens,
          totalTokens: model.usage.totalTokens,
          costUsd: Math.round(model.usage.costUsd * 1e5) / 1e5,
          billedAs: `${model.usage.calls} metered call(s)`,
          estimate: false,
          latencyMs: 0,
        },
      },
    };
  } catch (error) {
    failed = true;
    const why =
      error instanceof MeteredCallUnavailable
        ? error.message
        : error instanceof Error
          ? error.message
          : "the agent could not finish";
    options.onNote?.(why);
    return null;
  } finally {
    // Nothing is booked here. The caller books the whole run from the trace, or —
    // when the run failed and there is no trace — from `onFailedUsage` below, so
    // exactly one place ever adds an agent charge to the campaign.
    if (failed) options.onFailedUsage?.(model.usage.costUsd);
  }
}

export { ruleTrace };
