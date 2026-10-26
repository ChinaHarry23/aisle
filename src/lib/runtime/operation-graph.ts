import {runTrendQuality,handoffTrend,resolveTrend,cancelTrend} from './trend-quality';
import { releaseResearchWait } from '@/lib/trend/quality';
/**
 * The campaign operation as a LangGraph.
 *
 * Each engine command is one graph run: `routeCommand` picks the handler
 * node, stage nodes call the step functions in `steps.ts`, and on ADVANCE
 * `afterStage` follows the run pointer until a founder gate, a block, a
 * stopped run, or the step budget. LangSmith traces it and `getGraphAsync()`
 * draws it; the campaign document stays the record.
 */

import type { RunnableConfig } from "@langchain/core/runnables";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { evaluateGuard } from "./guard";
import { validateIntake } from "./intake";
import {
  addEvent,
  addStep,
  setRun,
  runComplianceReview,
  receiveComplianceSubmission,
  runCreativeGeneration,
  runFeedbackCollection,
  runMediaAdaptation,
  runSchedule,
  runTrendResearch,
  type StepEnv,
  type Work,
} from "./steps";
import { FOUNDER_WAIT_STEPS, MAX_REVISION_ATTEMPTS, type Command } from "./types";

export type OpState = {
  work: Work;
  /** Null only in a Studio checkpoint, which cannot store it; Studio fills it in for each node from its own map. */
  env: StepEnv | null;
  command: Command;
  maxSteps: number;
  taken: number;
  message: string;
  blocked: boolean;
  canAdvance: boolean;
  /** Set when this command should not enter another node. */
  stop: boolean;
};

function envOf(state: OpState): StepEnv {
  if (!state.env) throw new Error("Operation graph has no StepEnv for this campaign.");
  return state.env;
}

const GraphState = Annotation.Root({
  work: Annotation<Work>(),
  env: Annotation<StepEnv | null>(),
  command: Annotation<Command>(),
  maxSteps: Annotation<number>(),
  taken: Annotation<number>(),
  message: Annotation<string>(),
  blocked: Annotation<boolean>(),
  canAdvance: Annotation<boolean>(),
  stop: Annotation<boolean>(),
});

const STAGE_NODES = ["trend", "creative", "revise", "compliance", "media", "unhandled"] as const;
type StageNode = (typeof STAGE_NODES)[number];

/**
 * Destinations each branch is allowed to name.
 *
 * Without this list LangGraph treats a conditional edge as able to reach every
 * node, and Studio draws that mesh. These are the transitions in the Stage 1
 * process: a command enters one handler, intake hands to trend, a revision
 * returns to creative, and an advance follows the run pointer.
 */
export const COMMAND_DESTINATIONS = [
  "intake",
  "advance",
  "approve",
  "request_changes",
  "reject",
  "pause",
  "publish",
  "collect_feedback",
  "decide_recommendation",
  "resolve_conflict",
  "boundary_check",
  "trend_decision",
] as const;

export const stageDestinations = {
  trend: "trend",
  creative: "creative",
  revise: "revise",
  compliance: "compliance",
  media: "media",
  unhandled: "unhandled",
  [END]: END,
} as const;

export const reviseDestinations = { revise: "revise", [END]: END } as const;

export function stageFor(state: OpState): StageNode {
  switch (state.work.run?.step) {
    case "trend.receive":
    case "trend.quality":
    case "trend.handoff":
      return "trend";
    case "trend.brief":
    case "creative.receive":
      return "creative";
    case "creative.revise":
      return "revise";
    case "compliance.receive":
    case "compliance.review":
      return "compliance";
    case "media.receive":
      return "media";
    default:
      return "unhandled";
  }
}

function startIntake(w: Work, env: StepEnv): { ok: boolean; message: string } {
  const c = w.campaign;
  const problems = validateIntake(c, env.brand);

  if (problems.length > 0) {
    c.status = "draft";
    c.running = false;
    setRun(w, {
      status: "halted",
      step: "intake.validate",
      haltedReason: problems.map((p) => p.message).join(" "),
      awaiting: "brief_correction",
      awaitingDetail: problems.map((p) => `${p.field}: ${p.message}`).join(" · "),
    });
    c.validationProblems = problems;
    addEvent(
      w,
      "founder",
      "decision",
      `Launch refused — ${problems.length} problem(s) in the brief`,
      problems.map((p) => `${p.field}: ${p.message} (${p.clause})`).join(" · "),
    );
    addStep(w, "intake.validate", "founder", "blocked", "Brief not valid", problems.map((p) => p.message).join(" "));
    return { ok: false, message: `The pipeline did not start. ${problems.map((p) => p.message).join(" ")}` };
  }

  c.validationProblems = [];
  const guidance = evaluateGuard(
    {
      actor: "founder",
      action: "FOUNDER.DECIDE",
      campaign: c,
      target: "launch the agent bench",
      triggeredBy: "intake.validate",
    },
    env.now,
  );
  w.policy.push(guidance.decision);
  c.policyDecisions = [...c.policyDecisions, guidance.decision];

  c.status = "analysing";
  c.running = true;
  c.sharedContext = {
    ...c.sharedContext,
    approvedClaims: c.sharedContext.approvedClaims ?? [],
    founderNotes: c.notes ? [...new Set([...c.sharedContext.founderNotes, c.notes])] : c.sharedContext.founderNotes,
  };
  setRun(w, {
    status: "running",
    step: "trend.receive",
    awaiting: null,
    awaitingDetail: null,
    haltedReason: null,
    startedAt: env.now,
    updatedAt: env.now,
  });
  addEvent(
    w,
    "founder",
    "decision",
    "Pipeline launched",
    `Shared campaign context stored and handed to the Trend Analyser. Boundaries in force: agents may research, draft and check — they may not publish, exceed $${c.spend.capUsd.toFixed(2)} of automated spend, change scope, or send a print piece live.`,
    { policyDecisionId: guidance.decision.id },
  );
  addStep(w, "intake.validate", "founder", "ok", "Shared context stored", `Handed to AHR-02. Spend threshold $${c.spend.capUsd.toFixed(2)}.`);
  return { ok: true, message: "Launched." };
}

async function executeStep(w: Work, env: StepEnv): Promise<{ blocked: boolean; message: string }> {
  const run = w.run!;
  const c = w.campaign;

  switch (run.step) {
    case "trend.receive":
      return runTrendResearch(w, env);
    case "trend.quality":
      return runTrendQuality(w,env);
    case "trend.handoff":
      return handoffTrend(w,env);
    case "trend.brief":
    case "creative.receive":
      return runCreativeGeneration(w, env, 1);
    case "creative.revise":
      // `revisionCount` counts completed compliance attempts, so the next draft
      // is one beyond it. Reading the version off the creatives would repeat v1,
      // because a rejected draft keeps its version number.
      return runCreativeGeneration(w, env, Math.max(2, c.revisionCount + 1));
    case "compliance.receive":
      return receiveComplianceSubmission(w, env);
    case "compliance.review": {
      const result = await runComplianceReview(w, env);
      if (result.blocked) return result;
      const attempt = c.complianceAttempts.at(-1);
      if (!attempt) return result;
      if (attempt.outcome === "changes_required") {
        // AHR-04 already recorded the attempt number and pointed the run at
        // AHR-03; mirror it on the campaign so the desk can show the cycle count.
        c.running = true;
        c.revisionCount = attempt.attempt;
        if (attempt.attempt >= MAX_REVISION_ATTEMPTS) {
          // Defensive only: the review itself escalates once the limit is spent.
          c.status = "awaiting_approval";
          c.running = false;
          setRun(w, { status: "awaiting_human", awaiting: "approval", step: "founder.gate" });
        }
      }
      return result;
    }
    case "media.receive": {
      const result = await runMediaAdaptation(w, env);
      if (result.blocked) return result;
      if (c.channelVersions.some((v) => v.status === "failed")) return result;
      runSchedule(w, env.allCampaigns);
      return { blocked: false, message: "Scheduled." };
    }
    case "founder.gate":
      return { blocked: true, message: "Waiting for the founder." };
    default:
      return { blocked: true, message: `No handler for step ${run.step}.` };
  }
}

function settle(state: OpState, blocked: boolean, message: string): Partial<OpState> {
  const run = state.work.run!;
  if (state.command.type === "ADVANCE") {
    setRun(state.work, { stepsTaken: run.stepsTaken + 1, updatedAt: envOf(state).now });
  }
  const taken = state.taken + 1;
  const human = FOUNDER_WAIT_STEPS.has(run.step);
  const running = run.status === "running";
  let canAdvance = false;
  if (state.command.type === "ADVANCE") {
    canAdvance = running && !human;
  } else if (state.command.type === "START" || state.command.type === "APPROVE" || state.command.type === "REQUEST_CHANGES") {
    canAdvance = !blocked && running;
  }
  return { work: state.work, message, blocked, taken, canAdvance, stop: false };
}

export async function stageNode(state: OpState): Promise<Partial<OpState>> {
  const outcome = await executeStep(state.work, envOf(state));
  return settle(state, outcome.blocked, outcome.message);
}

export function afterStage(state: OpState): StageNode | typeof END {
  if (state.command.type !== "ADVANCE") return END;
  if (state.taken >= state.maxSteps || state.blocked || state.work.run?.step === "trend.handoff") return END;
  const run = state.work.run!;
  if (run.status !== "running" || FOUNDER_WAIT_STEPS.has(run.step)) return END;
  return stageFor(state);
}

export async function intakeNode(state: OpState): Promise<Partial<OpState>> {
  const w = state.work;
  if (w.campaign.status !== "draft" && w.campaign.status !== "paused") {
    addEvent(
      w,
      "founder",
      "escalation",
      "Launch ignored — a bench is already running",
      `This campaign is at ${w.campaign.status}. The existing run and its log are left unchanged (UC-01 ext 10.a).`,
    );
    return { work: w, stop: true, canAdvance: false, message: "This campaign is already running." };
  }
  if (w.campaign.status === "paused" && w.campaign.trendQuality) {
    releaseResearchWait(w.campaign, envOf(state).now);
    w.campaign.status = "analysing";
    w.campaign.running = true;
    setRun(w, { status: "running", step: "trend.handoff", awaiting: null, awaitingDetail: null, haltedReason: null });
    addEvent(w, "founder", "decision", "Research gaps kept on the report", "Image generation continues. Compliance is the human review.");
    return { work: w, stop: false, canAdvance: true, message: "Research gaps recorded. Continuing to image generation." };
  }
  const env = envOf(state);
  const started = startIntake(w, env);
  if (started.ok && env.llm.meta?.live) {
    const formatted = await env.llm.request({
      agent: "creative",
      modelId: env.settings.agents.creative.modelId,
      purpose: "intake",
      prompt: [
        "You are the intake assistant. Turn the founder's campaign into the context the trend researcher will search.",
        "Do not invent prices, dates, or claims the founder did not give you.",
        `Product: ${w.campaign.product}`,
        `Category: ${w.campaign.category}`,
        `Audience: ${w.campaign.targetAudience}`,
        `Objective: ${w.campaign.objective}`,
        `Country: ${w.campaign.country}`,
        `Notes: ${w.campaign.notes || "none"}`,
        'Reply with JSON only: {"context":"one paragraph the researcher can search from"}',
      ].join("\n"),
      localBaseUrl: env.settings.localBaseUrl,
      localModel: env.settings.localModel,
    });
    const parsed = formatted.text?.match(/"context"\s*:\s*"([^"]+)"/);
    if (formatted.status === "ok" && parsed?.[1]) {
      w.campaign.sharedContext = { ...w.campaign.sharedContext, intakeSummary: parsed[1] };
      addEvent(w, "intake", "output", "Intake formatted the brief", parsed[1]);
    }
  }
  return {
    work: w,
    stop: !started.ok,
    canAdvance: false,
    message: started.message,
  };
}

export function beginAdvance(state: OpState): Partial<OpState> {
  const run = state.work.run!;
  const gate = FOUNDER_WAIT_STEPS.has(run.step);
  if (run.status !== "running" || gate) {
    return {
      stop: true,
      message: "The bench is not running for this campaign.",
      canAdvance: false,
    };
  }
  return { stop: false };
}

export async function approveNode(state: OpState): Promise<Partial<OpState>> {
  if (state.command.type !== "APPROVE") return { stop: true };
  const w = state.work;
  const c = w.campaign;
  const outcome = evaluateGuard(
    {
      actor: "founder",
      action: "FOUNDER.DECIDE",
      campaign: c,
      target: c.channels.join(", "),
      triggeredBy: "founder.gate",
    },
    envOf(state).now,
  );
  w.policy.push(outcome.decision);
  c.policyDecisions = [...c.policyDecisions, outcome.decision];
  c.founderDecision = { action: "approve", note: state.command.note, at: envOf(state).now };
  c.sharedContext = {
    ...c.sharedContext,
    founderNotes: state.command.note ? [...c.sharedContext.founderNotes, state.command.note] : c.sharedContext.founderNotes,
  };
  c.creatives = c.creatives.map((cr) => ({ ...cr, status: "approved" }));
  addEvent(
    w,
    "founder",
    "decision",
    "Approved for distribution",
    state.command.note || "Founder signed off. Media Manager may adapt and schedule; it still may not publish.",
  );
  setRun(w, { status: "running", step: "media.receive", awaiting: null, awaitingDetail: null });
  return { work: w, stop: false };
}

export async function requestChangesNode(state: OpState): Promise<Partial<OpState>> {
  if (state.command.type !== "REQUEST_CHANGES") return { stop: true };
  const w = state.work;
  const c = w.campaign;
  c.founderDecision = { action: "changes", note: state.command.note, at: envOf(state).now };
  c.sharedContext = {
    ...c.sharedContext,
    founderNotes: [...c.sharedContext.founderNotes, state.command.note],
  };
  const nextVersion = (c.creatives[0]?.version ?? 1) + 1;
  addEvent(w, "founder", "decision", "Changes requested", state.command.note || "Returned to Image Generation with founder notes.");
  if (nextVersion > MAX_REVISION_ATTEMPTS) {
    c.status = "awaiting_approval";
    c.running = false;
    setRun(w, { status: "awaiting_human", awaiting: "approval", awaitingDetail: "Revision limit reached; founder decision required." });
    addEvent(w, "compliance", "escalation", "Revision limit reached", `v${nextVersion} would exceed ${MAX_REVISION_ATTEMPTS} attempts. The case stays with the founder.`);
    return { work: w, stop: true, canAdvance: false, message: "Revision limit reached." };
  }
  setRun(w, { status: "running", step: "creative.revise", revisionAttempts: nextVersion - 1, awaiting: null, awaitingDetail: null });
  c.running = true;
  return { work: w, stop: false };
}

export async function rejectNode(state: OpState): Promise<Partial<OpState>> {
  if (state.command.type !== "REJECT") return {};
  const w = state.work;
  const c = w.campaign;
  c.status = "rejected";
  c.running = false;
  c.founderDecision = { action: "reject", note: state.command.note, at: envOf(state).now };
  c.creatives = c.creatives.map((cr) => ({ ...cr, status: "rejected" }));
  setRun(w, { status: "halted", haltedReason: "Rejected by the founder." });
  addEvent(w, "founder", "decision", "Rejected", state.command.note || "Campaign will not publish. Nothing was distributed.");
  return { work: w, canAdvance: false, message: "Rejected." };
}

export async function pauseNode(state: OpState): Promise<Partial<OpState>> {
  const w = state.work;
  w.campaign.status = "paused";
  w.campaign.running = false;
  setRun(w, { status: "paused", haltedReason: "Paused by the founder." });
  addEvent(
    w,
    "founder",
    "decision",
    "Paused",
    "No agent may continue research, drafting, checking or scheduling until the founder resumes. The pause is not permission to publish or spend.",
  );
  addStep(w, "intake.validate", "founder", "ok", "Run paused", "Progress saved.");
  return { work: w, canAdvance: false, message: "Paused." };
}

export async function publishNode(state: OpState): Promise<Partial<OpState>> {
  const w = state.work;
  const c = w.campaign;
  if (c.status !== "scheduled") {
    addEvent(w, "media", "escalation", "Publish refused", `Nothing is scheduled (status ${c.status}).`);
    return { work: w, canAdvance: false, message: "Nothing scheduled to publish." };
  }
  const actor = state.command.type === "PUBLISH" ? state.command.actor : "founder";
  const result = await runFeedbackCollection(w, envOf(state), { publish: true, actor });
  // Publishing closes distribution; collecting results stays a separate,
  // explicit founder choice, so the run parks at the feedback step.
  if (!result.blocked) {
    setRun(w, {
      status: "awaiting_human",
      awaiting: "approval",
      awaitingDetail: "Published. Collect results when you are ready.",
      step: "feedback.collect",
    });
  }
  return { work: w, canAdvance: false, message: result.message };
}

export async function collectNode(state: OpState): Promise<Partial<OpState>> {
  const w = state.work;
  if (w.campaign.status !== "published") {
    w.campaign.running = false;
    return { work: w, canAdvance: false, message: "Publish the campaign before collecting results (UC-06 ext 2.a)." };
  }
  const result = await runFeedbackCollection(w, envOf(state), { publish: false });
  return { work: w, canAdvance: false, message: result.message };
}

export async function decideNode(state: OpState): Promise<Partial<OpState>> {
  if (state.command.type !== "DECIDE_RECOMMENDATION") return {};
  const w = state.work;
  const c = w.campaign;
  const report = c.performanceReport;
  if (!report) return { canAdvance: false, message: "No performance report to decide on." };
  if (report.recommendationUnsupported && state.command.action !== "discarded") {
    return {
      canAdvance: false,
      message: "Collected evidence cannot support advice, so it cannot be accepted or saved. Discard it, or leave the summary as it is.",
    };
  }
  const text =
    state.command.action === "discarded" ? null : (state.command.text ?? report.recommendationText);
  c.recommendationDecision = {
    action: state.command.action,
    text,
    note: state.command.note ?? "",
    at: envOf(state).now,
    author: "Human Founder",
    attachedToCampaignId: null,
  };
  addEvent(
    w,
    "founder",
    "feedback",
    state.command.action === "discarded"
      ? "Recommendation discarded"
      : state.command.action === "edited"
        ? "Recommendation edited and accepted"
        : "Recommendation accepted",
    state.command.action === "discarded"
      ? `Stored as a discard decision; nothing will be attached to a later brief. ${state.command.note ?? ""}`.trim()
      : `${text ?? ""} ${state.command.note ?? ""}`.trim(),
  );
  addStep(w, "feedback.summarise", "founder", "ok", `Recommendation ${state.command.action}`, state.command.note ?? "");
  setRun(w, { status: "complete", awaiting: null, awaitingDetail: null, step: "feedback.summarise" });
  return { work: w, canAdvance: false, message: `Recommendation ${state.command.action}.` };
}

export async function resolveNode(state: OpState): Promise<Partial<OpState>> {
  if (state.command.type !== "RESOLVE_CONFLICT") return {};
  const command = state.command;
  const w = state.work;
  const c = w.campaign;
  const conflict = c.scheduleConflicts.find((x) => x.id === command.conflictId);
  if (!conflict) return { canAdvance: false, message: "Conflict not found." };
  c.scheduleConflicts = c.scheduleConflicts.map((x) =>
    x.id === command.conflictId ? { ...x, resolved: true, detail: `${x.detail} — resolved by the founder: ${command.note}` } : x,
  );
  addEvent(w, "founder", "decision", `Conflict resolved on ${conflict.channel}`, state.command.note);
  const unresolved = c.scheduleConflicts.filter((x) => !x.resolved).length;
  if (unresolved === 0 && w.run) {
    setRun(w, { awaiting: null, awaitingDetail: null, status: "complete" });
  }
  return { work: w, canAdvance: false, message: `Conflict resolved. ${unresolved} remaining.` };
}

export async function boundaryNode(state: OpState): Promise<Partial<OpState>> {
  if (state.command.type !== "ATTEMPT_BLOCKED") return {};
  const w = state.work;
  const c = w.campaign;
  // Framed deliberately over the threshold so the refusal path is observable
  // rather than theoretical: an agent tries to commit eight times the cap.
  const overage = c.spend.capUsd * 8;
  const outcome = evaluateGuard(
    {
      actor: "media",
      action: state.command.actor,
      campaign: c,
      target: state.command.note ?? "a distribution action an agent attempted",
      amountUsd: overage,
      kind: c.channels.includes("print") ? "catalogue_cover" : "social",
      triggeredBy: "founder.boundary_check",
    },
    envOf(state).now,
  );
  w.policy.push(outcome.decision);
  c.policyDecisions = [...c.policyDecisions, outcome.decision];
  if (outcome.verdict === "block") {
    c.spend = { ...c.spend, blockedAttempts: c.spend.blockedAttempts + 1 };
  }
  addEvent(
    w,
    "media",
    "policy",
    `Blocked: ${outcome.decision.action}`,
    `${outcome.reason} ${outcome.remedy ?? ""}`.trim(),
    { policyDecisionId: outcome.decision.id },
  );
  addStep(w, "media.conflict_check", "media", outcome.verdict === "block" ? "blocked" : "ok", `Guard: ${outcome.verdict}`, outcome.reason, {
    policyDecisionId: outcome.decision.id,
  });
  return { work: w, canAdvance: false, message: outcome.reason };
}

export async function trendDecisionNode(state: OpState): Promise<Partial<OpState>> {
  const env = envOf(state);
  if (state.command.type === "CANCEL_TREND") {
    cancelTrend(state.work, env, state.command.note);
    return { work: state.work, canAdvance: false, message: "Analysis cancelled; partial work retained." };
  }
  if (state.command.type !== "RESOLVE_TREND") return { stop: true };
  const result = resolveTrend(state.work, env, state.command);
  return { work: state.work, canAdvance: !result.blocked, message: result.message };
}

export function routeCommand(state: OpState): (typeof COMMAND_DESTINATIONS)[number] {
  switch (state.command.type) {
    case "RESOLVE_TREND":
    case "CANCEL_TREND":
      return "trend_decision";
    case "START":
      return "intake";
    case "ADVANCE":
      return "advance";
    case "APPROVE":
      return "approve";
    case "REQUEST_CHANGES":
      return "request_changes";
    case "REJECT":
      return "reject";
    case "PAUSE":
      return "pause";
    case "PUBLISH":
      return "publish";
    case "COLLECT_FEEDBACK":
      return "collect_feedback";
    case "DECIDE_RECOMMENDATION":
      return "decide_recommendation";
    case "RESOLVE_CONFLICT":
      return "resolve_conflict";
    case "ATTEMPT_BLOCKED":
      return "boundary_check";
  }
}

function buildOperationGraph() {
  const graph = new StateGraph(GraphState)
    .addNode("route", () => ({}))
    .addNode("trend_decision", trendDecisionNode)
    .addNode("intake", intakeNode)
    .addNode("advance", beginAdvance)
    .addNode("approve", approveNode)
    .addNode("request_changes", requestChangesNode)
    .addNode("reject", rejectNode)
    .addNode("pause", pauseNode)
    .addNode("publish", publishNode)
    .addNode("collect_feedback", collectNode)
    .addNode("decide_recommendation", decideNode)
    .addNode("resolve_conflict", resolveNode)
    .addNode("boundary_check", boundaryNode)
    .addNode("trend", stageNode)
    .addNode("creative", stageNode)
    .addNode("revise", stageNode)
    .addNode("compliance", stageNode)
    .addNode("media", stageNode)
    .addNode("unhandled", stageNode)
    .addEdge("trend_decision", END)
    .addEdge(START, "route")
    .addConditionalEdges("route", routeCommand, [...COMMAND_DESTINATIONS])
    .addConditionalEdges("intake", (state) => (state.stop ? END : stageFor(state)), stageDestinations)
    .addConditionalEdges("advance", (state) => (state.stop ? END : stageFor(state)), stageDestinations)
    .addEdge("approve", "media")
    .addConditionalEdges("request_changes", (state) => (state.stop ? END : "revise"), reviseDestinations);

  for (const name of STAGE_NODES) {
    graph.addConditionalEdges(name, afterStage, stageDestinations);
  }

  for (const name of ["reject", "pause", "publish", "collect_feedback", "decide_recommendation", "resolve_conflict", "boundary_check"] as const) {
    graph.addEdge(name, END);
  }

  return graph.compile();
}

let compiled: ReturnType<typeof buildOperationGraph> | null = null;

/** The compiled operation graph. One instance: the topology does not change per campaign. */
function operationGraph() {
  compiled ??= buildOperationGraph();
  return compiled;
}

/** Mermaid for the compiled graph, the same drawing LangGraph Studio would open. */
export async function operationMermaid() {
  const drawable = await operationGraph().getGraphAsync();
  return drawable.drawMermaid();
}

export function tracingStatus() {
  const enabled = process.env.LANGSMITH_TRACING === "true" || process.env.LANGCHAIN_TRACING_V2 === "true";
  const project = process.env.LANGSMITH_PROJECT || process.env.LANGCHAIN_PROJECT || "aisle";
  return { enabled, project: enabled ? project : null };
}

/**
 * Run one engine command as a graph invocation.
 *
 * The campaign object inside `work` is updated in place, which is what
 * `runEngine` already promised its callers.
 */
export async function runOperation(
  input: {
    work: Work;
    env: StepEnv;
    command: Command;
    maxSteps: number;
  },
  config?: RunnableConfig,
): Promise<{ canAdvance: boolean; message: string }> {
  const graph = operationGraph();
  const output = await graph.invoke(
    {
      work: input.work,
      env: input.env,
      command: input.command,
      maxSteps: input.maxSteps,
      taken: 0,
      message: "",
      blocked: false,
      canAdvance: false,
      stop: false,
    },
    {
      runName: `aisle.operation.${input.command.type}.${input.work.run?.step ?? "start"}`,
      tags: ["aisle", "operation", input.command.type, input.work.run?.step ?? "start"],
      metadata: {
        campaignId: input.work.campaign.id,
        thread_id: input.work.campaign.id,
        command: input.command.type,
        step: input.work.run?.step ?? "start",
      },
      recursionLimit: 48,
      ...config,
    },
  );
  return { canAdvance: output.canAdvance, message: output.message };
}
