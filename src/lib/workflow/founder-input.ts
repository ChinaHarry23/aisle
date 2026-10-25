/**
 * The founder's side of the trust boundary.
 *
 * The browser may supply a campaign brief and a few explicit controls: the
 * trash, declared report outcomes, the spend cap and an authorised aggregate
 * retail export. Everything the agents produce (status, run, creatives,
 * approvals, compliance, spend, log) comes only from the stored copy. Inline
 * /api/engine, the durable queue and PUT /api/workspace all make this cut, so
 * they share it here.
 */

import { isArchived } from "@/lib/campaign-lifecycle";
import { attachableRecommendation } from "@/lib/runtime/defaults";
import type { ChannelResultStatus } from "@/lib/runtime/types";
import { blankCampaign } from "@/lib/seed";
import type { WorkspaceSettings } from "@/lib/settings";
import { holdsStoredResearch } from "@/lib/trend/inline-state";
import { retailUploadSchema, type RetailUpload } from "@/lib/trend/internal-retail";
import type { BrandProfile, Campaign, CampaignInput, Channel } from "@/lib/types";

type StoredWorkspace = {
  brand: BrandProfile;
  settings: WorkspaceSettings;
  campaigns: Campaign[];
};

/** The brief fields a founder writes when creating a campaign. */
export function founderInput(raw: Campaign): CampaignInput {
  return {
    name: raw.name,
    product: raw.product,
    category: raw.category,
    targetAudience: raw.targetAudience,
    objective: raw.objective,
    budget: raw.budget,
    channels: raw.channels,
    startDate: raw.startDate,
    endDate: raw.endDate,
    country: raw.country,
    notes: typeof raw.notes === "string" ? raw.notes : "",
    unitCostAud: raw.unitCostAud,
    currentPriceAud: raw.currentPriceAud,
    productImageUrl: raw.productImageUrl,
    imageModelId: raw.imageModelId,
    videoModelId: raw.videoModelId,
    spendCapUsd: raw.spendCapUsd,
  };
}

/** The founder's aggregate retail export, when they authorised it and it validates. */
function founderRetailUpload(raw: Campaign): { retailUpload?: RetailUpload } {
  if (raw.internalDataAuthorised !== true || raw.retailUpload === undefined) return {};
  const parsed = retailUploadSchema.safeParse(raw.retailUpload);
  return parsed.success ? { retailUpload: parsed.data } : {};
}

const COLLECTOR_STATUSES: ChannelResultStatus[] = ["ok", "no_data", "not_authorised", "late", "incomplete", "excluded"];

/** Declared report outcomes, kept only for the campaign's own channels and known statuses. */
export function founderCollectorOverrides(
  campaign: Pick<Campaign, "channels">,
  raw: unknown,
): Campaign["collectorOverrides"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(
      ([channel, status]) =>
        campaign.channels.includes(channel as Channel) && COLLECTOR_STATUSES.includes(status as ChannelResultStatus),
    ),
  );
}

function isoOrNull(value: unknown): string | null {
  return typeof value === "string" && value && !Number.isNaN(Date.parse(value)) ? value : null;
}

/**
 * A campaign the server has never stored: a blank draft built from the brief
 * alone. Brand, settings and any carried-forward recommendation come from the
 * stored workspace, the same as a fresh START.
 */
function draftFromFounder(raw: Campaign, stored: StoredWorkspace): Campaign {
  const recommendation = attachableRecommendation(stored.campaigns);
  const draft = blankCampaign(
    founderInput(raw),
    stored.brand,
    recommendation?.note ?? null,
    stored.settings,
    recommendation?.fromCampaignId ?? null,
  );
  const createdAt = isoOrNull(raw.createdAt) ?? draft.createdAt;
  const archivedAt = isoOrNull(raw.archivedAt);
  return {
    ...draft,
    id: raw.id,
    createdAt,
    updatedAt: isoOrNull(raw.updatedAt) ?? createdAt,
    ...(archivedAt ? { archivedAt } : {}),
    internalDataAuthorised: raw.internalDataAuthorised === true,
    ...founderRetailUpload(raw),
    collectorOverrides: founderCollectorOverrides(draft, raw.collectorOverrides),
  };
}

/**
 * The campaigns a browser workspace save may write.
 *
 * A campaign the server already holds keeps its stored copy; only the trash,
 * the declared report outcomes, the spend cap and an attached retail export
 * are taken from the browser. A campaign the server has never seen is stored as a blank draft. Leaving a
 * campaign out of the list still deletes it, as before.
 */
export function acceptWorkspaceCampaigns(stored: StoredWorkspace, submitted: unknown[]): Campaign[] {
  const byId = new Map(stored.campaigns.map((campaign) => [campaign.id, campaign]));
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const accepted: Campaign[] = [];
  for (const item of submitted) {
    const raw = item as Campaign;
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id || seen.has(raw.id)) continue;
    seen.add(raw.id);
    const prior = byId.get(raw.id);
    if (!prior) {
      accepted.push(draftFromFounder(raw, stored));
      continue;
    }
    const next = structuredClone(prior);
    if (raw.archivedAt === null) {
      next.archivedAt = null;
    } else {
      const archivedAt = isoOrNull(raw.archivedAt);
      if (archivedAt && !isArchived(prior)) {
        next.archivedAt = archivedAt;
        next.running = false;
      }
    }
    next.collectorOverrides = founderCollectorOverrides(next, raw.collectorOverrides);
    if (Number.isFinite(raw.spendCapUsd) && raw.spendCapUsd! > 0) next.spendCapUsd = raw.spendCapUsd;
    // A running campaign, or one whose research the server holds, takes a new
    // export only through the engine (RESOLVE_TREND with provide_data).
    const { retailUpload } = founderRetailUpload(raw);
    if (retailUpload && !prior.running && !holdsStoredResearch(prior)) {
      next.retailUpload = retailUpload;
      next.internalDataAuthorised = true;
    }
    // The browser's clock, but never later than the server's.
    const updatedAt = isoOrNull(raw.updatedAt);
    if (updatedAt && updatedAt > next.updatedAt) next.updatedAt = updatedAt < now ? updatedAt : now;
    accepted.push(next);
  }
  return accepted;
}
