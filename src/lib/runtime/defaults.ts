/**
 * One place that guarantees a `Campaign` satisfies the agent-runtime contract.
 *
 * Campaigns arrive from three directions — the seed file, the workspace store
 * (which may hold documents written by an older build), and the brief intake
 * form. Rather than trusting each of them, everything passes through
 * `withRuntimeDefaults` before the engine or a view touches it.
 */

import { isArchived } from "@/lib/campaign-lifecycle";
import type { Campaign } from "@/lib/types";
import { defaultSpendCap } from "./budget";
import type { Evidence, PolicyDecision, RunStep, ToolCall } from "./types";

export function withRuntimeDefaults(campaign: Campaign): Campaign {
  const internalDataAuthorised = campaign.internalDataAuthorised === true;
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
    complianceReviewRuns: campaign.complianceReviewRuns ?? [],
    channelVersions: campaign.channelVersions ?? [],
    scheduleConflicts: campaign.scheduleConflicts ?? [],
    runSchedule: campaign.runSchedule ?? [],
    performanceReport: campaign.performanceReport ?? null,
    recommendationDecision: campaign.recommendationDecision ?? null,
    unitCostAud: typeof campaign.unitCostAud === "number" && Number.isFinite(campaign.unitCostAud) ? campaign.unitCostAud : null,
    currentPriceAud:
      typeof campaign.currentPriceAud === "number" && Number.isFinite(campaign.currentPriceAud)
        ? campaign.currentPriceAud
        : null,
    priceRecommendation: campaign.priceRecommendation ?? null,
    productImageUrl:
      typeof campaign.productImageUrl === "string" && campaign.productImageUrl.startsWith("data:image/")
        ? campaign.productImageUrl
        : null,
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
      intakeSummary: campaign.sharedContext.intakeSummary ?? null,
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
    .filter((c) => !isArchived(c) && c.status === "published" && c.performanceReport && c.recommendationDecision)
    .sort((a, b) => (a.performanceReport!.at < b.performanceReport!.at ? 1 : -1));

  for (const c of published) {
    const decision = c.recommendationDecision!;
    if (!['accepted','edited'].includes(decision.action) || c.performanceReport!.recommendationUnsupported || !decision.at || !decision.author) continue;
    const text = decision.text ?? c.performanceReport?.recommendationText;
    if (!text) continue;
    return { note: text, fromCampaignId: c.id, fromCampaignName: c.name };
  }

  return null;
}

/** Trend consumer checks the platform record, rather than trusting an attached
 * browser/legacy note. Absence never blocks a first campaign. */
export function verifiedPreviousAdvice(c:Campaign,campaigns:Campaign[]):NonNullable<Campaign['sharedContext']['previousAdvice']>|null{
 const source=campaigns.find(v=>v.id===c.sharedContext.previousPerformanceFrom&&v.id!==c.id);
 if(!source)return null;
 const eligible=attachableRecommendation([source]),decision=source.recommendationDecision,report=source.performanceReport;
 if(!eligible||!decision||!report||eligible.note!==c.sharedContext.previousPerformanceNote)return null;
 return {sourceCampaignId:source.id,wording:eligible.note,action:decision.action as 'accepted'|'edited',decidedAt:decision.at,author:decision.author,reportId:report.id};
}
