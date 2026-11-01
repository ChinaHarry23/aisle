/**
 * Everything that needs a person, in one queue.
 *
 * Compliance sign-off, trend research that stopped or left a gap, distribution
 * channel conflicts, and any other founder gate are the same kind of work.
 * They stay distinct by type so the Approvals desk can filter them.
 */

import { isArchived } from "@/lib/campaign-lifecycle";
import type { Campaign } from "@/lib/types";
import type { ScheduleConflict } from "@/lib/runtime/types";
import { researchNotice, trendNoticeKey, type ResearchNotice } from "@/lib/trend/notice";

export const reviewTypes = [
  { id: "compliance", label: "Compliance", noun: "compliance review" },
  { id: "trends", label: "Trends", noun: "trend review" },
  { id: "channels", label: "Distribution channels", noun: "distribution channel decision" },
  { id: "other", label: "Other decisions", noun: "other decision" },
] as const;

export type ReviewType = (typeof reviewTypes)[number]["id"];

export type ReviewEntry =
  | { id: string; type: "compliance"; campaign: Campaign }
  | {
      id: string;
      type: "trends";
      campaign: Campaign;
      notice: ResearchNotice | null;
      pending: number;
      /** Set when research is paused and the founder has to continue or correct it. */
      pausedDetail: string | null;
    }
  | {
      id: string;
      type: "channels";
      campaign: Campaign;
      conflict: ScheduleConflict | null;
      title: string;
      detail: string;
    }
  | {
      id: string;
      type: "other";
      campaign: Campaign;
      kind: "brief" | "collect" | "recommendation";
      title: string;
      detail: string;
    };

const typeRank: Record<ReviewType, number> = {
  compliance: 0,
  trends: 1,
  channels: 2,
  other: 3,
};

const riskRank = { high: 0, medium: 1, low: 2 } as const;

const conflictTitle: Record<ScheduleConflict["kind"], string> = {
  same_slot: "Same time slot",
  frequency: "Posting too often",
  outside_window: "Outside the campaign window",
  budget: "Channel budget",
};

function complianceRisk(campaign: Campaign) {
  return riskRank[campaign.complianceReports.at(-1)?.risk ?? "low"];
}

function channelFailure(campaign: Campaign): { title: string; detail: string } | null {
  const run = campaign.run;
  if (!run || run.status !== "awaiting_human" || run.awaiting !== "failure") return null;
  if (run.step !== "media.receive" && run.step !== "media.adapt" && run.step !== "media.publish") return null;
  const title =
    run.step === "media.publish"
      ? "Channel delivery"
      : run.step === "media.adapt"
        ? "Channel adaptation"
        : "Distribution context";
  return {
    title,
    detail: run.awaitingDetail ?? "A distribution channel needs a decision before it can continue.",
  };
}

function entriesFor(campaign: Campaign): ReviewEntry[] {
  const items: ReviewEntry[] = [];

  if (campaign.status === "awaiting_approval") {
    items.push({ id: `compliance:${campaign.id}`, type: "compliance", campaign });
  }

  const pending = campaign.trendRequests?.filter((request) => request.status === "pending").length ?? 0;
  const found = researchNotice(campaign);
  const notice = found && campaign.trendNoticeAck === trendNoticeKey(campaign) ? null : found;
  const trendPaused = campaign.status === "paused" && Boolean(campaign.run?.step.startsWith("trend."));
  if (pending > 0 || notice || trendPaused) {
    items.push({
      id: `trends:${campaign.id}`,
      type: "trends",
      campaign,
      notice,
      pending,
      pausedDetail: trendPaused ? campaign.run?.awaitingDetail ?? "Research is paused until you continue it." : null,
    });
  }

  for (const conflict of campaign.scheduleConflicts ?? []) {
    if (conflict.resolved) continue;
    items.push({
      id: `channels:${conflict.id}`,
      type: "channels",
      campaign,
      conflict,
      title: conflictTitle[conflict.kind],
      detail: conflict.detail,
    });
  }

  const failure = channelFailure(campaign);
  if (failure) {
    items.push({
      id: `channels:${campaign.id}:${campaign.run?.step ?? "failure"}`,
      type: "channels",
      campaign,
      conflict: null,
      title: failure.title,
      detail: failure.detail,
    });
  }

  if (campaign.run?.awaiting === "brief_correction") {
    items.push({
      id: `other:brief:${campaign.id}`,
      type: "other",
      campaign,
      kind: "brief",
      title: "Brief needs a correction",
      detail: campaign.run.awaitingDetail ?? "The campaign cannot start until the brief is corrected.",
    });
  }

  if (campaign.status === "published" && !campaign.performanceReport) {
    items.push({
      id: `other:collect:${campaign.id}`,
      type: "other",
      campaign,
      kind: "collect",
      title: "Collect results",
      detail: "The campaign is live. Pull in results from the channels before the next recommendation.",
    });
  }

  if (campaign.performanceReport && !campaign.recommendationDecision) {
    items.push({
      id: `other:recommendation:${campaign.id}`,
      type: "other",
      campaign,
      kind: "recommendation",
      title: "Next-campaign recommendation",
      detail:
        campaign.run?.step === "feedback.summarise" && campaign.run.awaitingDetail
          ? campaign.run.awaitingDetail
          : "Accept, edit or discard the recommendation. Nothing is offered for a later campaign until you do.",
    });
  }

  return items;
}

/** Active campaigns only. One campaign can contribute several entries, one per decision. */
export function reviewQueue(campaigns: Campaign[]): ReviewEntry[] {
  return campaigns
    .filter((campaign) => !isArchived(campaign))
    .flatMap(entriesFor)
    .sort((a, b) => {
      const byType = typeRank[a.type] - typeRank[b.type];
      if (byType !== 0) return byType;
      if (a.type === "compliance" && b.type === "compliance") {
        const byRisk = complianceRisk(a.campaign) - complianceRisk(b.campaign);
        if (byRisk !== 0) return byRisk;
      }
      return b.campaign.updatedAt.localeCompare(a.campaign.updatedAt);
    });
}

export function parseReviewType(value: string | null): ReviewType | "all" {
  return reviewTypes.some((type) => type.id === value) ? (value as ReviewType) : "all";
}

export function approvalsHref(type: ReviewType | "all" = "all") {
  return type === "all" ? "/approvals" : `/approvals?type=${type}`;
}
