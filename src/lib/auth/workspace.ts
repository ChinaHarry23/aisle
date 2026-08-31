import { defaultBrand, seedCampaigns } from "@/lib/seed";
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
    campaigns: [],
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

export function normalizeWorkspace(raw: Partial<WorkspaceSnapshot> | null): WorkspaceSnapshot {
  const fallback = emptyWorkspace();
  return {
    brand: { ...fallback.brand, ...raw?.brand },
    campaigns: raw?.campaigns ?? fallback.campaigns,
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
