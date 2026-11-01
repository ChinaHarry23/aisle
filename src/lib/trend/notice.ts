import { isArchived } from "@/lib/campaign-lifecycle";
import type { Campaign } from "@/lib/types";
import type { ResearchCategory } from "@/lib/trend/contracts";

const labels: Record<ResearchCategory, string> = {
  current_market: "Current market",
  historical_market: "Historical trends",
  customer_interest: "Customer interests",
  purchase_preference: "Purchasing preferences",
  seasonal: "Seasonal influences",
  cultural: "Cultural influences",
  channel: "Channel behaviour",
  competitor: "Competitor activity",
};

type Area = NonNullable<Campaign["researchCoverage"]>[number];

/** One campaign, not one row per research area. Null when nothing failed. */
export type ResearchNotice = {
  succeeded: string[];
  failed: string[];
};

function areaTitle(area: Area) {
  return `${labels[area.category]}${area.channel ? ` · ${area.channel}` : ""}`;
}

function statusFor(campaign: Campaign, area: Area) {
  const quality = campaign.trendQuality;
  if (area.category === "seasonal" && campaign.seasonalityJudgement?.seasonal === false) return "Not seasonal";
  if (area.category === "cultural" && campaign.culturalMatch) return campaign.culturalMatch.name;
  if (area.category === "cultural" && campaign.culturalMatch === null) return "No occasion match";
  if (!quality) {
    if (area.analysis) return area.analysis.evidenceIds.length ? "Draft assessment" : "Evidence gap";
    if (area.evidenceIds.length) return "Sources retrieved";
    if (area.attempts?.length) return "No evidence";
    return "Not run";
  }
  return quality.researchAreas.find((item) => item.category === area.category && item.channel === area.channel)?.supported
    ? "Supported"
    : "Evidence gap";
}

function settled(campaign: Campaign, status: string) {
  return status === "Supported" || status === "Not seasonal" || status === "No occasion match" || status === campaign.culturalMatch?.name;
}

/**
 * What this campaign's research established, and what it could not.
 * A running trend step is still working, so it is not a notice yet.
 * Unassessed areas become one notice only after that step has stopped.
 */
export function researchNotice(campaign: Campaign): ResearchNotice | null {
  if (isArchived(campaign)) return null;
  const areas = campaign.researchCoverage ?? [];
  const started = Boolean(
    campaign.researchAttempts?.length ||
      campaign.trendQuality ||
      areas.some((area) => (area.attempts?.length ?? 0) > 0 || area.evidenceIds.length > 0),
  );
  if (!started) return null;
  const working = Boolean(campaign.running && campaign.run?.step?.startsWith("trend."));
  const succeeded: string[] = [];
  const failed: string[] = [];
  for (const area of areas) {
    const status = statusFor(campaign, area);
    const title = areaTitle(area);
    if (settled(campaign, status)) {
      succeeded.push(title);
      continue;
    }
    if (status === "No evidence" || status === "Evidence gap") {
      failed.push(`${title} · ${status.toLowerCase()}`);
      continue;
    }
    if (!working && status !== "Not run") failed.push(`${title} · not assessed yet`);
  }
  const report = campaign.structuredTrendBrief;
  if (report && report.validation !== "passed") failed.push("Saved report needs recovery");
  if (!failed.length) return null;
  return { succeeded, failed };
}

/**
 * Identity of the reminder on screen. A new assessment or a different gap list
 * is a different reminder, so a previous "Noted" does not hide it.
 */
export function trendNoticeKey(campaign: Campaign): string | null {
  const notice = researchNotice(campaign);
  if (!notice) return null;
  const quality = campaign.trendQuality;
  const brief = campaign.structuredTrendBrief;
  return JSON.stringify([
    notice.failed,
    notice.succeeded,
    quality ? [quality.runId, quality.version, quality.assessedAt, quality.status] : null,
    brief ? [brief.version, brief.generatedAt, brief.validation, brief.status] : null,
  ]);
}

function ackValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 4000 ? value : undefined;
}

/**
 * The reminder the founder is allowed to mark seen: the one currently stored.
 * Anything else is ignored, and an omitted value does not wipe a saved one.
 */
export function acceptTrendNoticeAck(stored: Campaign, submitted: { trendNoticeAck?: unknown }): string | undefined {
  const key = trendNoticeKey(stored);
  const submittedAck = ackValue(submitted.trendNoticeAck);
  if (key && submittedAck === key) return submittedAck;
  return ackValue(stored.trendNoticeAck);
}

/**
 * Keep a "Noted" mark when another copy of the campaign arrives.
 * The mark sticks only while it still names the incoming reminder.
 * A newer mark that names that reminder wins over a stale local one.
 */
export function withNotedTrendNotice(authority: Campaign | undefined, incoming: Campaign): Campaign {
  const key = trendNoticeKey(incoming);
  const local = ackValue(authority?.trendNoticeAck);
  const remote = ackValue(incoming.trendNoticeAck);
  const ack =
    (key && local === key ? local : undefined) ??
    (key && remote === key ? remote : undefined) ??
    remote ??
    local;
  if (ack === remote) return incoming;
  if (!ack) return incoming;
  return { ...incoming, trendNoticeAck: ack };
}

export function retainTrendNoticeAck(authority: Campaign[], incoming: Campaign[]): Campaign[] {
  const byId = new Map(authority.map((campaign) => [campaign.id, campaign]));
  return incoming.map((campaign) => withNotedTrendNotice(byId.get(campaign.id), campaign));
}
