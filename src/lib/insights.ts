/**
 * Insights the founder keeps from a finished campaign.
 *
 * Accepting a recommendation records that the advice was sound. It does not
 * attach that advice to whatever campaign is created next. The founder saves
 * the points they want, then ticks them when starting a later brief.
 */

import type { Campaign } from "@/lib/types";

export type SavedInsight = {
  id: string;
  /** Verbatim advice. The words are not rewritten. */
  text: string;
  /** Recommendation area, when this came from one point. */
  area: string | null;
  sourceCampaignId: string;
  sourceCampaignName: string;
  product: string;
  savedAt: string;
};

export function normaliseInsightText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Points an accepted or edited recommendation may contribute to the library. */
export function extractableInsights(campaign: Campaign): Omit<SavedInsight, "id" | "savedAt">[] {
  if (campaign.performanceReport?.recommendationUnsupported) return [];
  const decision = campaign.recommendationDecision;
  if (!decision || decision.action === "discarded") return [];
  const source = {
    sourceCampaignId: campaign.id,
    sourceCampaignName: campaign.name,
    product: campaign.product,
  };
  if (decision.action === "edited") {
    const text = (decision.text ?? "").trim();
    return text ? [{ text, area: null, ...source }] : [];
  }
  const points = (campaign.performanceReport?.recommendationPoints ?? []).filter((point) => point.text.trim());
  if (points.length) {
    return points.map((point) => ({ text: point.text.trim(), area: point.area, ...source }));
  }
  const text = (decision.text ?? campaign.performanceReport?.recommendationText ?? "").trim();
  return text ? [{ text, area: null, ...source }] : [];
}

/** Hide a saved insight once its source recommendation has been discarded. */
export function usableInsights(library: readonly SavedInsight[], campaigns: readonly Campaign[]): SavedInsight[] {
  const byId = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  return library.filter((insight) => {
    const source = byId.get(insight.sourceCampaignId);
    if (!source) return true;
    const action = source.recommendationDecision?.action;
    return action === "accepted" || action === "edited";
  });
}

export function resolveInsights(
  library: readonly SavedInsight[],
  ids: unknown,
  campaigns?: readonly Campaign[],
): SavedInsight[] {
  if (!Array.isArray(ids)) return [];
  const pool = campaigns ? usableInsights(library, campaigns) : library;
  const byId = new Map(pool.map((insight) => [insight.id, insight]));
  const chosen: SavedInsight[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || seen.has(id)) continue;
    const insight = byId.get(id);
    if (!insight) continue;
    seen.add(id);
    chosen.push(insight);
  }
  return chosen;
}

/**
 * The note a brief may carry. Each line keeps the source product in front of
 * the original sentence, so a later campaign can see where it came from.
 */
/** One labelled line. Research verifies this exact string against the source campaign. */
export function insightNoteLine(insight: Pick<SavedInsight, "sourceCampaignName" | "product" | "area" | "text">): string {
  const area = insight.area ? insight.area.replace(/_/g, " ") : "note";
  return `[${insight.sourceCampaignName} · ${insight.product} · ${area}] ${insight.text}`;
}

export function composeSelectedFeedback(insights: readonly SavedInsight[]): {
  note: string | null;
  from: string | null;
} {
  if (!insights.length) return { note: null, from: null };
  const note = insights.map((insight) => insightNoteLine(insight)).join("\n");
  const from = [...new Set(insights.map((insight) => insight.sourceCampaignId))].join(",");
  return { note, from };
}

export function applySelectedFeedback(
  campaign: Campaign,
  library: readonly SavedInsight[],
  ids: unknown,
  campaigns?: readonly Campaign[],
): Campaign {
  const chosen = resolveInsights(library, ids, campaigns);
  const feedback = composeSelectedFeedback(chosen);
  return {
    ...campaign,
    feedbackInsightIds: chosen.map((insight) => insight.id),
    sharedContext: {
      ...campaign.sharedContext,
      previousPerformanceNote: feedback.note,
      previousPerformanceFrom: feedback.from,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Records already stored. A missing list is an empty library, not a wipe of a caller that omitted the field. */
export function normaliseSavedInsights(raw: unknown): SavedInsight[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedInsight[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const record = asRecord(item);
    if (!record) continue;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const text = typeof record.text === "string" ? record.text.trim() : "";
    const sourceCampaignId = typeof record.sourceCampaignId === "string" ? record.sourceCampaignId : "";
    const sourceCampaignName = typeof record.sourceCampaignName === "string" ? record.sourceCampaignName : "";
    const product = typeof record.product === "string" ? record.product : "";
    const savedAt =
      typeof record.savedAt === "string" && !Number.isNaN(Date.parse(record.savedAt)) ? record.savedAt : "";
    if (!id || !text || !sourceCampaignId || !sourceCampaignName || !product || !savedAt || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      text,
      area: typeof record.area === "string" && record.area ? record.area : null,
      sourceCampaignId,
      sourceCampaignName,
      product,
      savedAt,
    });
  }
  return out.slice(0, 100);
}

/**
 * The library a browser save may write.
 *
 * An insight already stored is kept when its text is unchanged, including after
 * its campaign is deleted. A new one is kept only when the text is an accepted
 * or edited recommendation on a campaign this workspace holds.
 */
export function acceptSavedInsights(
  campaigns: readonly Campaign[],
  previous: readonly SavedInsight[],
  submitted: unknown,
): SavedInsight[] {
  if (!Array.isArray(submitted)) return [...previous];
  const prior = new Map(previous.map((insight) => [insight.id, insight]));
  const allowed = new Map<string, Omit<SavedInsight, "id" | "savedAt">>();
  for (const campaign of campaigns) {
    for (const insight of extractableInsights(campaign)) {
      allowed.set(`${campaign.id}\n${normaliseInsightText(insight.text)}`, insight);
    }
  }
  const out: SavedInsight[] = [];
  const seen = new Set<string>();
  const now = new Date().toISOString();
  for (const item of submitted) {
    const record = asRecord(item);
    if (!record) continue;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (!id || !text || seen.has(id)) continue;
    const existing = prior.get(id);
    if (existing && normaliseInsightText(existing.text) === normaliseInsightText(text)) {
      out.push(existing);
      seen.add(id);
      continue;
    }
    const sourceCampaignId = typeof record.sourceCampaignId === "string" ? record.sourceCampaignId : "";
    const match = allowed.get(`${sourceCampaignId}\n${normaliseInsightText(text)}`);
    if (!match) continue;
    out.push({
      id,
      text: match.text,
      area: match.area,
      sourceCampaignId: match.sourceCampaignId,
      sourceCampaignName: match.sourceCampaignName,
      product: match.product,
      savedAt: now,
    });
    seen.add(id);
  }
  return out.slice(0, 100);
}
