/**
 * One place that guarantees a `Campaign` satisfies the agent-runtime contract.
 *
 * Campaigns arrive from three directions — the seed file, the workspace store
 * (which may hold documents written by an older build), and the brief intake
 * form. Rather than trusting each of them, everything passes through
 * `withRuntimeDefaults` before the engine or a view touches it.
 */

import { isArchived } from "@/lib/campaign-lifecycle";
import { extractableInsights, insightNoteLine } from "@/lib/insights";
import type { Campaign } from "@/lib/types";
import { defaultSpendCap } from "./budget";
import type { Evidence, PolicyDecision, RunStep, ToolCall } from "./types";

type Decided = Campaign & {
  performanceReport: NonNullable<Campaign["performanceReport"]>;
  recommendationDecision: NonNullable<Campaign["recommendationDecision"]>;
};

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
 * The latest accepted or edited recommendation a published campaign can prove.
 *
 * A new brief does not attach this on its own. The founder ticks a saved
 * insight, and `verifiedPreviousAdvice` uses this to reject a note the
 * platform record does not support.
 */
export function attachableRecommendation(
  campaigns: Campaign[],
): { note: string; fromCampaignId: string; fromCampaignName: string } | null {
  const published = campaigns
    .filter((c): c is Decided => !isArchived(c) && c.status === "published" && !!c.performanceReport && !!c.recommendationDecision)
    .sort((a, b) => (a.performanceReport.at < b.performanceReport.at ? 1 : -1));

  for (const c of published) {
    const decision = c.recommendationDecision;
    if (!['accepted','edited'].includes(decision.action) || c.performanceReport.recommendationUnsupported || !decision.at || !decision.author) continue;
    const text = decision.text ?? c.performanceReport.recommendationText;
    if (!text) continue;
    return { note: text, fromCampaignId: c.id, fromCampaignName: c.name };
  }

  return null;
}

/** A labelled insight line is kept only when that campaign can still prove the sentence. */
function verifiedSelectedInsights(
  campaign: Campaign,
  campaigns: Campaign[],
): NonNullable<Campaign["sharedContext"]["previousAdvice"]> | null {
  const note = campaign.sharedContext.previousPerformanceNote;
  const from = campaign.sharedContext.previousPerformanceFrom;
  if (!note || !from) return null;
  const ids = [...new Set(from.split(",").map((id) => id.trim()).filter(Boolean))];
  const lines = note.split("\n").filter((line) => line.length > 0);
  if (!ids.length || !lines.length) return null;
  const byId = new Map(campaigns.filter((item) => item.id !== campaign.id).map((item) => [item.id, item]));
  const allowed = new Map<string, Campaign>();
  for (const id of ids) {
    const source = byId.get(id);
    const decision = source?.recommendationDecision;
    const report = source?.performanceReport;
    if (!source || !decision || !report || report.recommendationUnsupported) return null;
    if ((decision.action !== "accepted" && decision.action !== "edited") || !decision.at || !decision.author) return null;
    for (const insight of extractableInsights(source)) allowed.set(insightNoteLine(insight), source);
  }
  const matched: Campaign[] = [];
  for (const line of lines) {
    const source = allowed.get(line);
    if (!source) return null;
    matched.push(source);
  }
  const used = new Set(matched.map((source) => source.id));
  if (ids.some((id) => !used.has(id))) return null;
  const first = matched[0];
  const decision = first.recommendationDecision;
  const report = first.performanceReport;
  if (!decision || !report || (decision.action !== "accepted" && decision.action !== "edited")) return null;
  return {
    sourceCampaignId: ids.join(","),
    wording: lines.join("\n"),
    action: decision.action,
    decidedAt: decision.at,
    author: decision.author,
    reportId: report.id,
  };
}

/** Trend consumer checks the platform record, rather than trusting an attached
 * browser/legacy note. Absence never blocks a first campaign. */
export function verifiedPreviousAdvice(c:Campaign,campaigns:Campaign[]):NonNullable<Campaign['sharedContext']['previousAdvice']>|null{
 const from=c.sharedContext.previousPerformanceFrom;
 const source=from&&!from.includes(',')?campaigns.find(v=>v.id===from&&v.id!==c.id):undefined;
 if(source){
  const eligible=attachableRecommendation([source]),decision=source.recommendationDecision,report=source.performanceReport;
  if(eligible&&decision&&report&&eligible.note===c.sharedContext.previousPerformanceNote)return {sourceCampaignId:source.id,wording:eligible.note,action:decision.action as 'accepted'|'edited',decidedAt:decision.at,author:decision.author,reportId:report.id};
 }
 return verifiedSelectedInsights(c,campaigns);
}
