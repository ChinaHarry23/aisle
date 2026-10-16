import { defaultBrand, migrateLegacyBrand, seedCampaigns } from "@/lib/seed";
import { defaultSettings, withSettingsDefaults, type WorkspaceSettings } from "@/lib/settings";
import type { BrandProfile, Campaign } from "@/lib/types";
import { kvGet, kvSet } from "./kv";
import type { UserRole } from "./types";

export type WorkspaceSnapshot = {
  brand: BrandProfile;
  campaigns: Campaign[];
  settings: WorkspaceSettings;
};

function workspaceKey(userId: string) {
  return `workspace/${userId}`;
}

export function emptyWorkspace(): WorkspaceSnapshot {
  return {
    brand: {
      ...defaultBrand,
      retailerName: "Your shop",
      tagline: "Set this on Brand to make it yours.",
    },
    // Every new account starts with the two sample campaigns so the flow is
    // visible straight away: one finished, one waiting for approval.
    campaigns: seedCampaigns(defaultBrand),
    settings: defaultSettings(),
  };
}

export function demoWorkspace(): WorkspaceSnapshot {
  return {
    brand: defaultBrand,
    campaigns: seedCampaigns(defaultBrand),
    settings: defaultSettings(),
  };
}

/** Samples added after a workspace was first saved are prepended once, so older accounts see them too. */
const LATE_SAMPLE_IDS = ["cmp_spring_produce"];

/** createdAt stamps of earlier drafts of the produce sample (scheduled, then published). */
const OLD_PRODUCE_VERSIONS = ["2026-10-12T22:30", "2026-09-28T22:30"];

const RETIRED_SAMPLE_IDS = new Set(["cmp_parka", "cmp_stonefruit"]);

function withSampleCampaigns(all: Campaign[]): Campaign[] {
  // The first version of the produce sample was four-channel and scheduled; swap an
  // untouched copy of it for the current one.
  const campaigns = all.filter(
    (c) =>
      !RETIRED_SAMPLE_IDS.has(c.id) &&
      !(c.id === "cmp_spring_produce" && OLD_PRODUCE_VERSIONS.some((v) => c.createdAt.startsWith(v))),
  );
  const have = new Set(campaigns.map((c) => c.id));
  const missing = seedCampaigns(defaultBrand).filter(
    (c) => LATE_SAMPLE_IDS.includes(c.id) && !have.has(c.id),
  );
  return missing.length ? [...missing, ...campaigns] : campaigns;
}

export function normalizeWorkspace(raw: Partial<WorkspaceSnapshot> | null): WorkspaceSnapshot {
  const fallback = emptyWorkspace();
  return {
    brand: { ...fallback.brand, ...(raw?.brand ? migrateLegacyBrand(raw.brand) : {}) },
    campaigns: withSampleCampaigns(raw?.campaigns ?? fallback.campaigns),
    settings: withSettingsDefaults(raw?.settings),
  };
}

export async function loadWorkspace(userId: string, role: UserRole): Promise<WorkspaceSnapshot> {
  const stored = await kvGet<WorkspaceSnapshot>(workspaceKey(userId));
  if (stored) return normalizeWorkspace(stored);
  const fresh = role === "dev" ? demoWorkspace() : emptyWorkspace();
  await kvSet(workspaceKey(userId), fresh);
  return fresh;
}

export async function saveWorkspace(userId: string, snapshot: WorkspaceSnapshot) {
  await kvSet(workspaceKey(userId), normalizeWorkspace(snapshot));
}
