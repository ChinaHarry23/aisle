import { retainCampaignLifecycle } from "@/lib/campaign-lifecycle";
import { defaultBrand, migrateLegacyBrand, seedCampaigns } from "@/lib/seed";
import { defaultSettings, withSettingsDefaults, type WorkspaceSettings } from "@/lib/settings";
import type { BrandProfile, Campaign } from "@/lib/types";
import { kvGet, kvSet } from "@/lib/db/kv";
import type { UserRole } from "./types";

export type WorkspaceSnapshot = {
  brand: BrandProfile;
  campaigns: Campaign[];
  settings: WorkspaceSettings;
  /** Campaigns the founder permanently deleted. Sample campaigns are not put back. */
  retiredCampaignIds?: string[];
};

function workspaceKey(userId: string) {
  return `workspace/${userId}`;
}

function emptyWorkspace(): WorkspaceSnapshot {
  return {
    brand: {
      ...defaultBrand,
      retailerName: "Your shop",
      tagline: "Set this on Brand to make it yours.",
    },
    // Every new account starts with the sample campaign so the flow is
    // visible straight away: it is waiting for approval.
    campaigns: seedCampaigns(defaultBrand),
    settings: defaultSettings(),
    retiredCampaignIds: [],
  };
}

export function demoWorkspace(): WorkspaceSnapshot {
  return {
    brand: defaultBrand,
    campaigns: seedCampaigns(defaultBrand),
    settings: defaultSettings(),
    retiredCampaignIds: [],
  };
}

/** Samples added after a workspace was first saved are prepended once, so older accounts see them too. */
const LATE_SAMPLE_IDS = ["cmp_spring_produce"];

/** createdAt stamps of earlier drafts of the produce sample (scheduled, then published). */
const OLD_PRODUCE_VERSIONS = ["2026-10-12T22:30", "2026-09-28T22:30"];

const RETIRED_SAMPLE_IDS = new Set(["cmp_parka", "cmp_stonefruit"]);

function withSampleCampaigns(all: Campaign[], retired: readonly string[]): Campaign[] {
  const gone = new Set(retired);
  // The first version of the produce sample was four-channel and scheduled; swap an
  // untouched copy of it for the current one.
  const campaigns = all.filter(
    (c) =>
      !gone.has(c.id) &&
      !RETIRED_SAMPLE_IDS.has(c.id) &&
      !(c.id === "cmp_spring_produce" && OLD_PRODUCE_VERSIONS.some((v) => c.createdAt.startsWith(v))),
  );
  const have = new Set(campaigns.map((c) => c.id));
  const missing = seedCampaigns(defaultBrand).filter(
    (c) => LATE_SAMPLE_IDS.includes(c.id) && !have.has(c.id) && !gone.has(c.id),
  );
  return missing.length ? [...missing, ...campaigns] : campaigns;
}

function normalizeWorkspace(raw: Partial<WorkspaceSnapshot> | null): WorkspaceSnapshot {
  const fallback = emptyWorkspace();
  const retired = [...new Set(raw?.retiredCampaignIds ?? [])];
  return {
    brand: { ...fallback.brand, ...(raw?.brand ? migrateLegacyBrand(raw.brand) : {}) },
    campaigns: withSampleCampaigns(raw?.campaigns ?? fallback.campaigns, retired),
    settings: withSettingsDefaults(raw?.settings),
    retiredCampaignIds: retired,
  };
}

function clearArchive(campaign: Campaign): Campaign {
  const next = { ...campaign };
  delete next.archivedAt;
  return next;
}

export async function loadWorkspace(userId: string, role: UserRole): Promise<WorkspaceSnapshot> {
  const stored = await kvGet<WorkspaceSnapshot>(workspaceKey(userId));
  if (stored) return normalizeWorkspace(stored);
  const fresh = role === "dev" ? demoWorkspace() : emptyWorkspace();
  await kvSet(workspaceKey(userId), fresh);
  return fresh;
}

export async function saveWorkspace(userId: string, snapshot: WorkspaceSnapshot) {
  const previous = await kvGet<WorkspaceSnapshot>(workspaceKey(userId));
  const retired = [...new Set([...(previous?.retiredCampaignIds ?? []), ...(snapshot.retiredCampaignIds ?? [])])];
  const previousById = new Map((previous?.campaigns ?? []).map((campaign) => [campaign.id, campaign]));
  const campaigns = snapshot.campaigns
    .filter((campaign) => !retired.includes(campaign.id))
    .map((campaign) => {
      const prior = previousById.get(campaign.id);
      if (campaign.archivedAt === null) return clearArchive(campaign);
      if (typeof campaign.archivedAt === "string" && campaign.archivedAt) return campaign;
      if (typeof prior?.archivedAt === "string" && prior.archivedAt) {
        return { ...campaign, archivedAt: prior.archivedAt, running: false };
      }
      return campaign;
    });
  const kept = retainCampaignLifecycle(campaigns, retired, campaigns);
  await kvSet(workspaceKey(userId), normalizeWorkspace({ ...snapshot, campaigns: kept, retiredCampaignIds: retired }));
}
