/**
 * Finds the brand a render should follow, and ingests it once.
 *
 * The engine and Studio call `renderCampaignPoster` with only the owner's id,
 * so the stored workspace brand is read here, read-only: nothing is created or
 * saved. A render that cannot find a brand carries on without one.
 */
import { kvGet } from "@/lib/db/kv";
import { defaultBrand, migrateLegacyBrand } from "@/lib/seed";
import type { BrandProfile } from "@/lib/types";
import { ingestBrandInputs, type BrandInputs, type LogoOptions } from "./brand-inputs";

/** Same key `auth/workspace.ts` stores the workspace under; the suite saves a workspace and reads it back to guard this. */
export const workspaceKey = (ownerId: string) => `workspace/${ownerId}`;

export async function loadStoredBrand(ownerId: string): Promise<BrandProfile | null> {
  const stored = await kvGet<{ brand?: Partial<BrandProfile> }>(workspaceKey(ownerId));
  return stored?.brand ? { ...defaultBrand, ...migrateLegacyBrand(stored.brand) } : null;
}

const TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 20;
const cache = new Map<string, { at: number; value: Promise<BrandInputs> }>();

/** Ingest a brand, reusing a recent result so two variants do not fetch the same logo twice. */
export function ingestBrandCached(ownerId: string, brand: BrandProfile, options: LogoOptions = {}): Promise<BrandInputs> {
  const key = JSON.stringify([ownerId, brand.logoUrl, brand.colors, brand.visualStyle, brand.tone]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = ingestBrandInputs(brand, options);
  cache.set(key, { at: Date.now(), value });
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  value.catch(() => cache.delete(key));
  return value;
}

export function clearBrandCache() {
  cache.clear();
}
