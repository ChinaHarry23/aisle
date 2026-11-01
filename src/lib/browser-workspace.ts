/**
 * The browser mirror of a workspace. The server keeps the full record.
 * This copy is only so the desk can open before that record arrives, so it
 * leaves out campaigns and other large fields that overflow browser storage.
 */

import type { SavedBrand } from "@/lib/brand/library";
import type { SavedInsight } from "@/lib/insights";
import type { WorkspaceSettings } from "@/lib/settings";
import type { BrandProfile } from "@/lib/types";

const TEXT_LIMIT = 2_000;

export type BrowserWorkspace = {
  brand: BrandProfile;
  savedBrands: SavedBrand[];
  activeBrandId: string | null;
  retiredCampaignIds: string[];
  savedInsights: SavedInsight[];
  settings: WorkspaceSettings;
};

function slimBrand(brand: BrandProfile): BrandProfile {
  return {
    ...brand,
    logoUrl: brand.logoUrl?.startsWith("data:") ? "" : brand.logoUrl,
    retailData: null,
    guidelines: brand.guidelines?.map((doc) =>
      doc.text.length <= TEXT_LIMIT ? doc : { ...doc, text: doc.text.slice(0, TEXT_LIMIT), truncated: true },
    ),
  };
}

function slimSettings(settings: WorkspaceSettings): WorkspaceSettings {
  return {
    ...settings,
    trendSources: settings.trendSources.map((source) =>
      !source.content || source.content.length <= TEXT_LIMIT
        ? source
        : { ...source, content: source.content.slice(0, TEXT_LIMIT), truncated: true },
    ),
  };
}

export function workspaceForBrowser(state: BrowserWorkspace): BrowserWorkspace {
  return {
    brand: slimBrand(state.brand),
    savedBrands: state.savedBrands.map((item) => ({ ...item, profile: slimBrand(item.profile) })),
    activeBrandId: state.activeBrandId,
    retiredCampaignIds: state.retiredCampaignIds,
    savedInsights: state.savedInsights,
    settings: slimSettings(state.settings),
  };
}

/** True when an older browser mirror still holds campaign records. */
export function cachedWorkspaceHasCampaigns(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { state?: { campaigns?: unknown } };
    return Array.isArray(parsed.state?.campaigns);
  } catch {
    return false;
  }
}

/** Browser storage that keeps the desk usable when the mirror no longer fits. */
export function browserWorkspaceStorage(): Storage {
  const local = window.localStorage;
  return {
    get length() {
      return local.length;
    },
    clear: () => local.clear(),
    key: (index) => local.key(index),
    getItem: (name) => local.getItem(name),
    removeItem: (name) => local.removeItem(name),
    setItem: (name, value) => {
      try {
        local.setItem(name, value);
      } catch {
        try {
          local.removeItem(name);
          local.setItem(name, value);
        } catch {
          // The server workspace is the record. This mirror is optional.
        }
      }
    },
  };
}
