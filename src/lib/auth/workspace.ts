import { applyBackend, BACKENDS, type BackendId } from "@/lib/backends";
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

/**
 * The backend new server-created workspaces start on. AISLE_DEFAULT_BACKEND
 * (local | openai | anthropic, default local) lets a hosted deployment, where
 * nothing runs on loopback, start new accounts on cloud models paid in credits.
 */
export function defaultBackendId(): BackendId {
  const wanted = process.env.AISLE_DEFAULT_BACKEND?.trim().toLowerCase();
  return BACKENDS.find((b) => b.id === wanted)?.id ?? "local";
}

/** Settings for a workspace the server is creating now. */
export function newWorkspaceSettings(): WorkspaceSettings {
  const base = defaultSettings();
  const backend = defaultBackendId();
  return backend === "local" ? base : withSettingsDefaults({ ...base, ...applyBackend(base, backend) });
}

export function emptyWorkspace(): WorkspaceSnapshot {
  return {
    brand: {
      ...defaultBrand,
      retailerName: "Your shop",
      tagline: "Tell Aisle who you sell to.",
    },
    campaigns: [],
    settings: newWorkspaceSettings(),
  };
}

export function demoWorkspace(): WorkspaceSnapshot {
  return {
    brand: defaultBrand,
    campaigns: seedCampaigns(defaultBrand),
    settings: newWorkspaceSettings(),
  };
}

export function normalizeWorkspace(raw: Partial<WorkspaceSnapshot> | null): WorkspaceSnapshot {
  const fallback = emptyWorkspace();
  return {
    brand: { ...fallback.brand, ...raw?.brand },
    campaigns: raw?.campaigns ?? fallback.campaigns,
    settings: raw?.settings ? withSettingsDefaults(raw.settings) : fallback.settings,
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
