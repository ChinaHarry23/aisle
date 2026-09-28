/**
 * One place that guarantees a `Campaign` satisfies the agent-runtime contract.
 *
 * Campaigns arrive from three directions — the seed file, the workspace store
 * (which may hold documents written by an older build), and the brief intake
 * form. Rather than trusting each of them, everything passes through
 * `withRuntimeDefaults` before the engine or a view touches it.
 */

import { uid } from "@/lib/ids";
import type { Campaign } from "@/lib/types";
import { defaultSpendCap } from "./engine";
import type { AgentRun, Evidence, PolicyDecision, RunStep, ToolCall } from "./types";

export function emptyEvidence(): Evidence[] {
  return [];
}

export function blankRun(campaignId: string): AgentRun {
  const now = new Date().toISOString();
  return {
    id: uid("run"),
    campaignId,
    startedAt: now,
    updatedAt: now,
    status: "idle",
    step: "intake.validate",
    stepsTaken: 0,
    maxSteps: 36,
    revisionAttempts: 0,
    toolsUsed: [],
    haltedReason: null,
    awaiting: null,
    awaitingDetail: null,
  };
}

export function withRuntimeDefaults(campaign: Campaign): Campaign {
  const internalDataAuthorised = campaign.internalDataAuthorised !== false;
  const capUsd =
    campaign.spend?.capUsd && campaign.spend.capUsd > 0
      ? campaign.spend.capUsd
      : defaultSpendCap(campaign);

  const evidence: Evidence[] = campaign.evidence ?? [];
  const policyDecisions: PolicyDecision[] = campaign.policyDecisions ?? [];
  const runSteps: RunStep[] = campaign.runSteps ?? [];
  const toolCalls: ToolCall[] = campaign.toolCalls ?? [];

  return {
    ...campaign,
    internalDataAuthorised,
    evidence,
    trendFindings: campaign.trendFindings ?? [],
    trendGaps: campaign.trendGaps ?? [],
    complianceAttempts: campaign.complianceAttempts ?? [],
    channelVersions: campaign.channelVersions ?? [],
    scheduleConflicts: campaign.scheduleConflicts ?? [],
    runSchedule: campaign.runSchedule ?? [],
    performanceReport: campaign.performanceReport ?? null,
    recommendationDecision: campaign.recommendationDecision ?? null,
    policyDecisions,
    runSteps,
    toolCalls,
    validationProblems: campaign.validationProblems ?? [],
    collectorOverrides: campaign.collectorOverrides ?? {},
    spend: {
      inferenceUsd: campaign.spend?.inferenceUsd ?? 0,
      mediaUsd: campaign.spend?.mediaUsd ?? 0,
      capUsd,
      blockedAttempts:
        campaign.spend?.blockedAttempts ??
        policyDecisions.filter((d) => d.verdict === "block").length,
    },
    run: campaign.run ?? null,
    sharedContext: {
      ...campaign.sharedContext,
      approvedClaims: campaign.sharedContext.approvedClaims ?? [],
      founderNotes: campaign.sharedContext.founderNotes ?? [],
      previousPerformanceNote: campaign.sharedContext.previousPerformanceNote ?? null,
      previousPerformanceFrom: campaign.sharedContext.previousPerformanceFrom ?? null,
    },
  };
}

/**
 * The recommendation that a *new* brief may carry forward.
 *
 * UC-06 step 12 is strict: only an accepted or edited note is attached, and a
 * discarded one is never attached. The note also carries the campaign it came
 * from so the Trend Analyser can cite it.
 */
export function attachableRecommendation(
  campaigns: Campaign[],
): { note: string; fromCampaignId: string; fromCampaignName: string } | null {
  const published = campaigns
    .filter((c) => c.status === "published" && c.performanceReport && c.recommendationDecision)
    .sort((a, b) => (a.performanceReport!.at < b.performanceReport!.at ? 1 : -1));

  for (const c of published) {
    const decision = c.recommendationDecision!;
    if (decision.action === "discarded") continue;
    const text = decision.text ?? c.performanceReport?.recommendationText;
    if (!text) continue;
    return { note: text, fromCampaignId: c.id, fromCampaignName: c.name };
  }

  // Seeded history carries a plain recommendation without a decision record.
  const seeded = campaigns.find(
    (c) => c.status === "published" && !c.recommendationDecision && c.performance?.recommendation,
  );
  if (seeded?.performance?.recommendation) {
    return {
      note: seeded.performance.recommendation,
      fromCampaignId: seeded.id,
      fromCampaignName: seeded.name,
    };
  }
  return null;
}
