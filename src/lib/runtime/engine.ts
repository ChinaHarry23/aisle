/**
 * The run engine.
 *
 * `runEngine` is a pure-ish transition function: give it the workspace, a campaign
 * and one command, and it returns the updated campaign plus the log lines, run
 * steps and guard decisions that command produced. It performs no I/O of its own
 * beyond the tools the agents call, which keeps the Next.js route handler thin and
 * makes the whole bench testable without a browser.
 */

import { uid } from "@/lib/ids";
import { requestGenerate } from "@/lib/media/client";
import { posterPrompt } from "@/lib/media/prompts";
import type { MediaGeneration } from "@/lib/media/types";
import type { Campaign, Creative } from "@/lib/types";
import { makeLlmRuntime, type LlmRuntime } from "./decide";
import { evaluateGuard } from "./guard";
import { validateIntake } from "./intake";
import {
  addEvent,
  addStep,
  setRun,
  runComplianceReview,
  runCreativeGeneration,
  runFeedbackCollection,
  runMediaAdaptation,
  runSchedule,
  runTrendResearch,
  type StepEnv,
  type Work,
} from "./steps";
import {
  MAX_REVISION_ATTEMPTS,
  type AgentRun,
  type Command,
  type EngineContext,
  type EngineResult,
} from "./types";

export type EngineOptions = {
  llm?: LlmRuntime;
  /** Bounded work per ADVANCE so one HTTP call cannot run away. */
  maxSteps?: number;
  /** Poster renderer. Defaults to the studio route; tests pass a stub. */
  renderPoster?: (input: {
    campaign: Campaign;
    creative: Creative;
    modelId: string;
  }) => Promise<MediaGeneration>;
};

const DEFAULT_MAX_STEPS = 12;

async function defaultRenderPoster(input: {
  campaign: Campaign;
  creative: Creative;
  modelId: string;
}): Promise<MediaGeneration> {
  return requestGenerate({
    kind: "image",
    modelId: input.modelId,
    prompt: posterPrompt(input.campaign, input.creative),
    aspectRatio: "4:5",
  });
}

function newRun(campaignId: string, now: string): AgentRun {
  return {
    id: uid("run"),
    campaignId,
    startedAt: now,
    updatedAt: now,
    status: "idle",
    step: "intake.validate",
    stepsTaken: 0,
    maxSteps: DEFAULT_MAX_STEPS * 3,
    revisionAttempts: 0,
    toolsUsed: [],
    haltedReason: null,
    awaiting: null,
    awaitingDetail: null,
  };
}

function blankWork(campaign: Campaign, now: string): Work {
  return {
    now,
    campaign: {
      ...campaign,
      evidence: campaign.evidence ?? [],
      trendFindings: campaign.trendFindings ?? [],
      trendGaps: campaign.trendGaps ?? [],
      complianceAttempts: campaign.complianceAttempts ?? [],
      channelVersions: campaign.channelVersions ?? [],
      scheduleConflicts: campaign.scheduleConflicts ?? [],
      runSchedule: campaign.runSchedule ?? [],
      policyDecisions: campaign.policyDecisions ?? [],
      runSteps: campaign.runSteps ?? [],
      toolCalls: campaign.toolCalls ?? [],
      performanceReport: campaign.performanceReport ?? null,
      recommendationDecision: campaign.recommendationDecision ?? null,
      internalDataAuthorised: campaign.internalDataAuthorised !== false,
      spend: campaign.spend ?? {
        inferenceUsd: 0,
        mediaUsd: 0,
        capUsd: defaultSpendCap(campaign),
        blockedAttempts: 0,
      },
      run: campaign.run ?? newRun(campaign.id, now),
    },
    run: campaign.run ?? newRun(campaign.id, now),
    steps: [],
    policy: [],
    toolCalls: [],
    events: [],
  };
}

/** Founder-set ceiling for automated spend (UC-01 ext 13.a). */
export function defaultSpendCap(campaign: Pick<Campaign, "budget" | "spendCapUsd">) {
  if (typeof campaign.spendCapUsd === "number" && campaign.spendCapUsd > 0) {
    return campaign.spendCapUsd;
  }
  return Math.max(5, Math.min(50, Math.round(campaign.budget * 0.002 * 100) / 100));
}

function envFor(
  ctx: EngineContext,
  campaign: Campaign,
  settings: StepEnv["settings"],
  brand: StepEnv["brand"],
  llm: LlmRuntime,
  renderPoster: NonNullable<EngineOptions["renderPoster"]>,
): StepEnv {
  return {
    now: ctx.now,
    settings,
    brand,
    llm,
    allCampaigns: ctx.campaigns.map((c) => (c.id === campaign.id ? campaign : c)),
    renderPoster,
  };
}

function activeRun(run: AgentRun | null): boolean {
  return run?.status === "running" || run?.status === "awaiting_human" || run?.status === "paused";
}

function isHalted(run: AgentRun): boolean {
  return run.status === "complete" || run.status === "halted";
}

/* ------------------------------------------------------------------ intake -- */

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

/* ------------------------------------------------------------------- steps -- */

async function executeStep(w: Work, env: StepEnv): Promise<{ blocked: boolean; message: string }> {
  const run = w.run!;
  const c = w.campaign;

  switch (run.step) {
    case "trend.receive":
      return runTrendResearch(w, env);
    case "trend.brief":
    case "creative.receive":
      return runCreativeGeneration(w, env, 1);
    case "creative.revise":
      // `revisionCount` counts completed compliance attempts, so the next draft
      // is one beyond it. Reading the version off the creatives would repeat v1,
      // because a rejected draft keeps its version number.
      return runCreativeGeneration(w, env, Math.max(2, c.revisionCount + 1));
    case "compliance.receive": {
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
        return result;
      }
      return result;
    }
    case "media.receive": {
      const result = await runMediaAdaptation(w);
      if (result.blocked) return result;
      if (c.channelVersions.some((v) => v.status === "failed")) return result;
      const sched = runSchedule(w, env.allCampaigns);
      void sched;
      return { blocked: false, message: "Scheduled." };
    }
    case "founder.gate":
      return { blocked: true, message: "Waiting for the founder." };
    default:
      return { blocked: true, message: `No handler for step ${run.step}.` };
  }
}

/* ------------------------------------------------------------------ engine -- */

export async function runEngine(
  ctx: EngineContext,
  campaign: Campaign,
  command: Command,
  settings: StepEnv["settings"],
  brand: StepEnv["brand"],
  options: EngineOptions = {},
): Promise<EngineResult> {
  const llm = options.llm ?? makeLlmRuntime();
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const w = blankWork(campaign, ctx.now);
  const env = envFor(ctx, w.campaign, settings, brand, llm, options.renderPoster ?? defaultRenderPoster);
  let canAdvance = false;

  if (!w.run || !activeRun(w.run)) {
    w.run = newRun(campaign.id, ctx.now);
    w.campaign.run = w.run;
  }

  switch (command.type) {
    case "START": {
      // UC-01 ext 10.a — one bench per campaign.
      if (w.campaign.status !== "draft" && w.campaign.status !== "paused") {
        addEvent(
          w,
          "founder",
          "escalation",
          "Launch ignored — a bench is already running",
          `This campaign is at ${w.campaign.status}. The existing run and its log are left unchanged (UC-01 ext 10.a).`,
        );
        return finish(w, false, "This campaign is already running.");
      }
      const started = startIntake(w, env);
      if (!started.ok) return finish(w, false, started.message);
      const step = await executeStep(w, env);
      canAdvance = !step.blocked && !isHalted(w.run!) && w.run!.status === "running";
      return finish(w, canAdvance, step.message);
    }

    case "PAUSE": {
      w.campaign.status = "paused";
      w.campaign.running = false;
      setRun(w, { status: "paused", haltedReason: "Paused by the founder." });
      w.campaign.run = w.run;
      addEvent(
        w,
        "founder",
        "decision",
        "Paused",
        "No agent may continue research, drafting, checking or scheduling until the founder resumes. The pause is not permission to publish or spend.",
      );
      addStep(w, "intake.validate", "founder", "ok", "Run paused", "Progress saved.");
      return finish(w, false, "Paused.");
    }

    case "APPROVE": {
      const c = w.campaign;
      const outcome = evaluateGuard(
        {
          actor: "founder",
          action: "FOUNDER.DECIDE",
          campaign: c,
          target: `${c.channels.join(", ")}`,
          triggeredBy: "founder.gate",
        },
        ctx.now,
      );
      w.policy.push(outcome.decision);
      c.policyDecisions = [...c.policyDecisions, outcome.decision];
      c.founderDecision = { action: "approve", note: command.note, at: ctx.now };
      c.sharedContext = {
        ...c.sharedContext,
        founderNotes: command.note ? [...c.sharedContext.founderNotes, command.note] : c.sharedContext.founderNotes,
      };
      c.creatives = c.creatives.map((cr) => ({ ...cr, status: "approved" }));
      c.complianceAttempts = c.complianceAttempts.map((a) => ({ ...a }));
      addEvent(
        w,
        "founder",
        "decision",
        "Approved for distribution",
        command.note || "Founder signed off. Media Manager may adapt and schedule; it still may not publish.",
      );
      setRun(w, { status: "running", step: "media.receive", awaiting: null, awaitingDetail: null });
      c.run = w.run;
      const step = await executeStep(w, env);
      canAdvance = !step.blocked && w.run!.status === "running";
      return finish(w, canAdvance, step.message);
    }

    case "REQUEST_CHANGES": {
      const c = w.campaign;
      c.founderDecision = { action: "changes", note: command.note, at: ctx.now };
      c.sharedContext = {
        ...c.sharedContext,
        founderNotes: [...c.sharedContext.founderNotes, command.note],
      };
      const nextVersion = (c.creatives[0]?.version ?? 1) + 1;
      addEvent(w, "founder", "decision", "Changes requested", command.note || "Returned to Image Generation with founder notes.");
      if (nextVersion > MAX_REVISION_ATTEMPTS) {
        c.status = "awaiting_approval";
        c.running = false;
        setRun(w, { status: "awaiting_human", awaiting: "approval", awaitingDetail: "Revision limit reached; founder decision required." });
        c.run = w.run;
        addEvent(w, "compliance", "escalation", "Revision limit reached", `v${nextVersion} would exceed ${MAX_REVISION_ATTEMPTS} attempts. The case stays with the founder.`);
        return finish(w, false, "Revision limit reached.");
      }
      setRun(w, { status: "running", step: "creative.revise", revisionAttempts: nextVersion - 1, awaiting: null, awaitingDetail: null });
      c.run = w.run;
      c.running = true;
      const step = await executeStep(w, env);
      canAdvance = !step.blocked && w.run!.status === "running";
      return finish(w, canAdvance, step.message);
    }

    case "REJECT": {
      const c = w.campaign;
      c.status = "rejected";
      c.running = false;
      c.founderDecision = { action: "reject", note: command.note, at: ctx.now };
      c.creatives = c.creatives.map((cr) => ({ ...cr, status: "rejected" }));
      setRun(w, { status: "halted", haltedReason: "Rejected by the founder." });
      c.run = w.run;
      addEvent(w, "founder", "decision", "Rejected", command.note || "Campaign will not publish. Nothing was distributed.");
      return finish(w, false, "Rejected.");
    }

    case "PUBLISH": {
      const c = w.campaign;
      if (c.status !== "scheduled") {
        addEvent(w, "media", "escalation", "Publish refused", `Nothing is scheduled (status ${c.status}).`);
        return finish(w, false, "Nothing scheduled to publish.");
      }
      const result = await runFeedbackCollection(w, env, { publish: true });
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
      return finish(w, false, result.message);
    }

    case "COLLECT_FEEDBACK": {
      if (w.campaign.status !== "published") {
        w.campaign.running = false;
        return finish(w, false, "Publish the campaign before collecting results (UC-06 ext 2.a).");
      }
      const result = await runFeedbackCollection(w, env, { publish: false });
      return finish(w, false, result.message);
    }

    case "DECIDE_RECOMMENDATION": {
      const c = w.campaign;
      const report = c.performanceReport;
      if (!report) {
        return finish(w, false, "No performance report to decide on.");
      }
      const text =
        command.action === "discarded"
          ? null
          : (command.text ?? report.recommendationText ?? report.summary);
      c.recommendationDecision = {
        action: command.action,
        text,
        note: command.note ?? "",
        at: ctx.now,
        author: "Human Founder",
        attachedToCampaignId: null,
      };
      addEvent(
        w,
        "founder",
        "feedback",
        command.action === "discarded"
          ? "Recommendation discarded"
          : command.action === "edited"
            ? "Recommendation edited and accepted"
            : "Recommendation accepted",
        command.action === "discarded"
          ? `Stored as a discard decision; nothing will be attached to a later brief. ${command.note ?? ""}`.trim()
          : `${text ?? ""} ${command.note ?? ""}`.trim(),
      );
      addStep(w, "feedback.summarise", "founder", "ok", `Recommendation ${command.action}`, command.note ?? "");
      setRun(w, { status: "complete", awaiting: null, awaitingDetail: null, step: "feedback.summarise" });
      c.run = w.run;
      return finish(w, false, `Recommendation ${command.action}.`);
    }

    case "RESOLVE_CONFLICT": {
      const c = w.campaign;
      const conflict = c.scheduleConflicts.find((x) => x.id === command.conflictId);
      if (!conflict) return finish(w, false, "Conflict not found.");
      c.scheduleConflicts = c.scheduleConflicts.map((x) =>
        x.id === command.conflictId ? { ...x, resolved: true, detail: `${x.detail} — resolved by the founder: ${command.note}` } : x,
      );
      addEvent(w, "founder", "decision", `Conflict resolved on ${conflict.channel}`, command.note);
      const unresolved = c.scheduleConflicts.filter((x) => !x.resolved).length;
      if (unresolved === 0 && w.run) {
        setRun(w, { awaiting: null, awaitingDetail: null, status: "complete" });
        c.run = w.run;
      }
      return finish(w, false, `Conflict resolved. ${unresolved} remaining.`);
    }

    case "ATTEMPT_BLOCKED": {
      const c = w.campaign;
      // Framed deliberately over the threshold so the refusal path is observable
      // rather than theoretical: an agent tries to commit eight times the cap.
      const overage = c.spend.capUsd * 8;
      const outcome = evaluateGuard(
        {
          actor: "media",
          action: command.actor,
          campaign: c,
          target: command.note ?? "a distribution action an agent attempted",
          amountUsd: overage,
          kind: c.channels.includes("print") ? "catalogue_cover" : "social",
          triggeredBy: "founder.boundary_check",
        },
        ctx.now,
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
      return finish(w, false, outcome.reason);
    }

    case "ADVANCE": {
      let last = "Nothing to do.";
      let taken = 0;
      while (taken < maxSteps) {
        const run = w.run!;
        if (run.status !== "running") break;
        if (["founder.gate", "media.schedule"].includes(run.step)) break;
        const outcome = await executeStep(w, env);
        taken += 1;
        last = outcome.message;
        setRun(w, { stepsTaken: w.run!.stepsTaken + 1, updatedAt: ctx.now });
        w.campaign.run = w.run;
        if (outcome.blocked) break;
      }
      canAdvance = w.run!.status === "running" && !["founder.gate", "media.schedule"].includes(w.run!.step);
      if (taken === 0) last = "The bench is not running for this campaign.";
      return finish(w, canAdvance, last);
    }
  }
}

function finish(w: Work, canAdvance: boolean, message: string): EngineResult {
  const campaign = w.campaign;
  if (w.run) {
    campaign.run = {
      ...w.run,
      updatedAt: new Date().toISOString(),
      toolsUsed: [...new Set([...w.run.toolsUsed, ...w.toolCalls.map((t) => t.tool)])],
    };
  }
  campaign.updatedAt = new Date().toISOString();
  return {
    campaign,
    run: campaign.run!,
    events: w.events,
    runSteps: w.steps,
    policyDecisions: w.policy,
    canAdvance,
    message,
  };
}
