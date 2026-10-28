/**
 * The campaign bench, in the shape LangSmith Studio can run.
 *
 * The nodes and edges are the ones in `operation-graph.ts`. What Studio adds is
 * a hydrate step: the input is a campaign id and a founder command, not the
 * live `StepEnv`, because a checkpoint cannot store that function. Hydrate loads
 * the workspace, parks the env beside the graph, and the same nodes run.
 */

import { END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import {
  afterStage,
  approveNode,
  beginAdvance,
  boundaryNode,
  collectNode,
  decideNode,
  intakeNode,
  pauseNode,
  publishNode,
  rejectNode,
  requestChangesNode,
  resolveNode,
  COMMAND_DESTINATIONS,
  reviseDestinations,
  trendDecisionNode,
  routeCommand,
  stageDestinations,
  stageFor,
  stageNode,
  type OpState,
} from "@/lib/runtime/operation-graph";
import type { Command, GuardedAction } from "@/lib/runtime/types";
import type { StepEnv, Work } from "@/lib/runtime/steps";
import { loadStudioRun, saveStudioCampaign } from "./context";

const MAX_STEPS = 12;

const CommandInput = z.object({
  type: z
    .enum([
      "START",
      "PAUSE",
      "ADVANCE",
      "APPROVE",
      "REQUEST_CHANGES",
      "REJECT",
      "PUBLISH",
      "COLLECT_FEEDBACK",
      "DECIDE_RECOMMENDATION",
      "ATTEMPT_BLOCKED",
      "RESOLVE_CONFLICT",
      "RESOLVE_TREND",
      "CANCEL_TREND",
    ])
    .describe("Founder command. START launches the bench. ADVANCE runs the next stage."),
  actor: z
    .string()
    .optional()
    .describe("founder, system, or media. ATTEMPT_BLOCKED uses a guard action such as PUBLISH_CONTENT."),
  note: z.string().optional().describe("Founder note for approve, reject, changes, or publish."),
  action: z.string().optional().describe("Recommendation decision, or a research resolution action."),
  text: z.string().optional(),
  conflictId: z.string().optional().describe("Required for RESOLVE_CONFLICT."),
  requestId: z.string().optional(),
  reviewVersion: z.number().optional(),
  contextVersion: z.string().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  sources: z.array(z.record(z.string(), z.unknown())).optional(),
});

const Input = z.object({
  campaignId: z
    .string()
    .default("")
    .describe("Campaign id in the workspace. Blank uses AISLE_STUDIO_CAMPAIGN_ID, then the first draft."),
  userId: z
    .string()
    .default("")
    .describe("Workspace owner id or email. Blank uses AISLE_STUDIO_USER_ID, then the dev-alex desk."),
  maxSteps: z
    .number()
    .int()
    .default(1)
    .describe("How many stages one ADVANCE may run, from 1 to 12. START still does intake plus the first stage."),
  command: CommandInput.default({ type: "START" }),
});

const State = Input.extend({
  work: z.custom<Work | null>().default(null),
  message: z.string().default(""),
  blocked: z.boolean().default(false),
  canAdvance: z.boolean().default(false),
  stop: z.boolean().default(false),
  taken: z.number().int().default(0),
});

type StudioState = z.infer<typeof State>;
type CommandInput = z.infer<typeof CommandInput>;

const deps: {
  load: typeof loadStudioRun;
  save: typeof saveStudioCampaign;
} = {
  load: loadStudioRun,
  save: saveStudioCampaign,
};

/** Tests substitute the workspace. The dev server uses the real one. */
export function setStudioOperationDeps(next: Partial<typeof deps>) {
  if (next.load) deps.load = next.load;
  if (next.save) deps.save = next.save;
}

function clampSteps(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(MAX_STEPS, Math.max(1, Math.floor(value)));
}

function asCommand(raw: CommandInput | undefined): Command {
  const command = raw?.type ? raw : { type: "START" as const };
  switch (command.type) {
    case "START":
      return { type: "START", actor: "founder", note: command.note };
    case "PAUSE":
      return { type: "PAUSE", actor: "founder", note: command.note };
    case "ADVANCE":
      return { type: "ADVANCE", actor: command.actor === "system" ? "system" : "founder" };
    case "APPROVE":
      return { type: "APPROVE", actor: "founder", note: command.note ?? "" };
    case "REQUEST_CHANGES":
      return { type: "REQUEST_CHANGES", actor: "founder", note: command.note ?? "" };
    case "REJECT":
      return { type: "REJECT", actor: "founder", note: command.note ?? "" };
    case "PUBLISH":
      return { type: "PUBLISH", actor: command.actor === "media" ? "media" : "founder", note: command.note };
    case "COLLECT_FEEDBACK":
      return { type: "COLLECT_FEEDBACK", actor: command.actor === "system" ? "system" : "founder" };
    case "DECIDE_RECOMMENDATION": {
      if (command.action !== "accepted" && command.action !== "edited" && command.action !== "discarded") {
        throw new Error("DECIDE_RECOMMENDATION needs action: accepted, edited, or discarded.");
      }
      return { type: "DECIDE_RECOMMENDATION", actor: "founder", action: command.action, text: command.text, note: command.note };
    }
    case "ATTEMPT_BLOCKED":
      return { type: "ATTEMPT_BLOCKED", actor: (command.actor || "PUBLISH_CONTENT") as GuardedAction, note: command.note };
    case "RESOLVE_CONFLICT":
      if (!command.conflictId) throw new Error("RESOLVE_CONFLICT needs conflictId.");
      return { type: "RESOLVE_CONFLICT", actor: "founder", conflictId: command.conflictId, note: command.note ?? "" };
    case "CANCEL_TREND":
      return { type: "CANCEL_TREND", actor: "founder", note: command.note ?? "" };
    case "RESOLVE_TREND":
      return command as Command;
    default:
      return { type: "START", actor: "founder" };
  }
}

/**
 * StepEnv for each run, outside the checkpoint: it holds `renderPoster` and the
 * model function, which a checkpoint cannot store. Keyed by account and
 * campaign, because sample campaigns share an id across every account.
 */
const envByRun = new Map<string, StepEnv>();
const runKey = (userId: string, campaignId: string) => `${userId}\u0000${campaignId}`;

function toOp(state: StudioState): OpState {
  if (!state.work) throw new Error("No campaign is loaded. The hydrate node did not run.");
  const env = envByRun.get(runKey(state.userId, state.work.campaign.id));
  if (!env) throw new Error("Operation graph has no StepEnv for this campaign. The hydrate node did not run.");
  return {
    work: state.work,
    env,
    command: asCommand(state.command),
    maxSteps: clampSteps(state.maxSteps),
    taken: state.taken ?? 0,
    message: state.message ?? "",
    blocked: state.blocked ?? false,
    canAdvance: state.canAdvance ?? false,
    stop: state.stop ?? false,
  };
}

async function hydrate(state: StudioState): Promise<Partial<StudioState>> {
  const loaded = await deps.load({
    campaignId: state.campaignId,
    userId: state.userId,
    recover:!['PAUSE','CANCEL_TREND'].includes(state.command?.type??''),
  });
  envByRun.set(runKey(loaded.userId, loaded.work.campaign.id), loaded.env);
  return {
    work: loaded.work,
    userId: loaded.userId,
    campaignId: loaded.work.campaign.id,
    command: asCommand(state.command),
    maxSteps: clampSteps(state.maxSteps),
    taken: 0,
    stop: false,
    blocked: false,
    message: "",
    canAdvance: false,
  };
}

function step(fn: (state: OpState) => Partial<OpState> | Promise<Partial<OpState>>) {
  return async (state: StudioState): Promise<Partial<StudioState>> => {
    const update = await fn(toOp(state));
    const work = update.work ?? state.work;
    if (work && state.userId) await deps.save(state.userId, work);
    return {
      ...(work ? { work } : {}),
      ...(update.message !== undefined ? { message: update.message } : {}),
      ...(update.blocked !== undefined ? { blocked: update.blocked } : {}),
      ...(update.canAdvance !== undefined ? { canAdvance: update.canAdvance } : {}),
      ...(update.stop !== undefined ? { stop: update.stop } : {}),
      ...(update.taken !== undefined ? { taken: update.taken } : {}),
    };
  };
}

function edge(fn: (state: OpState) => string) {
  return (state: StudioState) => fn(toOp(state));
}

/**
 * Uncompiled on purpose. The Agent Server compiles it and attaches the
 * checkpointer, which is what threads and time travel use.
 */
export const graph = new StateGraph({ stateSchema: State, input: Input })
  .addNode("hydrate", hydrate)
  .addNode("route", () => ({}))
  .addNode("intake", step(intakeNode))
  .addNode("advance", step(beginAdvance))
  .addNode("approve", step(approveNode))
  .addNode("request_changes", step(requestChangesNode))
  .addNode("reject", step(rejectNode))
  .addNode("pause", step(pauseNode))
  .addNode("publish", step(publishNode))
  .addNode("collect_feedback", step(collectNode))
  .addNode("decide_recommendation", step(decideNode))
  .addNode("resolve_conflict", step(resolveNode))
  .addNode("boundary_check", step(boundaryNode))
  .addNode("trend_decision", step(trendDecisionNode))
  .addNode("trend", step(stageNode))
  .addNode("creative", step(stageNode))
  .addNode("revise", step(stageNode))
  .addNode("compliance", step(stageNode))
  .addNode("media", step(stageNode))
  .addNode("unhandled", step(stageNode))
  .addEdge(START, "hydrate")
  .addEdge("hydrate", "route")
  .addConditionalEdges("route", edge(routeCommand), [...COMMAND_DESTINATIONS])
  .addEdge("trend_decision", END)
  .addConditionalEdges("intake", edge((state) => (state.stop ? END : stageFor(state))), stageDestinations)
  .addConditionalEdges("advance", edge((state) => (state.stop ? END : stageFor(state))), stageDestinations)
  .addEdge("approve", "media")
  .addConditionalEdges("request_changes", (state) => (state.stop ? END : "revise"), reviseDestinations)
  .addConditionalEdges("trend", edge(afterStage), stageDestinations)
  .addConditionalEdges("creative", edge(afterStage), stageDestinations)
  .addConditionalEdges("revise", edge(afterStage), stageDestinations)
  .addConditionalEdges("compliance", edge(afterStage), stageDestinations)
  .addConditionalEdges("media", edge(afterStage), stageDestinations)
  .addConditionalEdges("unhandled", edge(afterStage), stageDestinations)
  .addEdge("reject", END)
  .addEdge("pause", END)
  .addEdge("publish", END)
  .addEdge("collect_feedback", END)
  .addEdge("decide_recommendation", END)
  .addEdge("resolve_conflict", END)
  .addEdge("boundary_check", END);
