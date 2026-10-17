import { defaultSpendCap } from "./budget";
/**
 * The run engine.
 *
 * `runEngine` is a pure-ish transition function: give it the workspace, a campaign
 * and one command, and it returns the updated campaign plus the log lines, run
 * steps and guard decisions that command produced. The command runs as the
 * LangGraph in `operation-graph.ts`. The engine performs no I/O of its own
 * beyond the tools the agents call, which keeps the Next.js route handler thin and
 * makes the whole bench testable without a browser.
 */

import { uid } from "@/lib/ids";
import { requestGenerate } from "@/lib/media/client";
import { posterPrompt } from "@/lib/media/prompts";
import type { MediaGeneration } from "@/lib/media/types";
import type { Campaign, Creative } from "@/lib/types";
import { makeLlmRuntime, type LlmRuntime } from "./decide";
import { runOperation } from "./operation-graph";
import { type StepEnv, type Work } from "./steps";
import { type AgentRun, type Command, type EngineContext, type EngineResult } from "./types";

export type EngineOptions = {
  llm?: LlmRuntime;
  /** Bounded work per ADVANCE so one HTTP call cannot run away. */
  maxSteps?: number;
  /** Account whose WhichGrocer sign-in the trend step may use. */
  ownerUserId?: string;
  /** Ad renderer. Defaults to the studio route; tests pass a stub. */
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
export { defaultSpendCap } from "./budget";

function envFor(
  ctx: EngineContext,
  campaign: Campaign,
  settings: StepEnv["settings"],
  brand: StepEnv["brand"],
  llm: LlmRuntime,
  renderPoster: NonNullable<EngineOptions["renderPoster"]>,
  ownerUserId?: string,
): StepEnv {
  return {
    now: ctx.now,
    settings,
    brand,
    llm,
    ownerUserId,
    allCampaigns: ctx.campaigns.map((c) => (c.id === campaign.id ? campaign : c)),
    renderPoster,
  };
}

function activeRun(run: AgentRun | null): boolean {
  return run?.status === "running" || run?.status === "awaiting_human" || run?.status === "paused";
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
  const env = envFor(ctx, w.campaign, settings, brand, llm, options.renderPoster ?? defaultRenderPoster, options.ownerUserId);
  let canAdvance = false;

  if (!w.run || !activeRun(w.run)) {
    w.run = newRun(campaign.id, ctx.now);
    w.campaign.run = w.run;
  }

  const operation = await runOperation({ work: w, env, command, maxSteps });
  canAdvance = operation.canAdvance;
  return finish(w, canAdvance, operation.message);
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
