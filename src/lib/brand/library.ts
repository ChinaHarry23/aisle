/**
 * Brands the founder keeps and switches between.
 * The workspace still has one active brand. The library is the set they can return to.
 */

import { uid } from "@/lib/ids";
import { defaultBrand, migrateLegacyBrand } from "@/lib/seed";
import type { BrandProfile } from "@/lib/types";

export type SavedBrand = {
  id: string;
  savedAt: string;
  profile: BrandProfile;
};

const MAX_BRANDS = 24;

export function freshBrand(name = "New brand"): BrandProfile {
  return {
    ...defaultBrand,
    retailerName: name,
    tagline: "",
    about: "",
    website: "",
    logoUrl: "",
    guidelines: [],
    retailData: null,
  };
}

function asProfile(raw: unknown): BrandProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const profile = raw as Partial<BrandProfile>;
  if (typeof profile.retailerName !== "string" || !profile.retailerName.trim()) return null;
  return migrateLegacyBrand({
    ...defaultBrand,
    ...profile,
    retailerName: profile.retailerName.trim().slice(0, 160),
    colors: { ...defaultBrand.colors, ...profile.colors },
    countryRules: { ...defaultBrand.countryRules, ...profile.countryRules },
  });
}

export function normaliseSavedBrands(raw: unknown): SavedBrand[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const brands: SavedBrand[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<SavedBrand>;
    const profile = asProfile(row.profile);
    if (typeof row.id !== "string" || !row.id.trim() || seen.has(row.id) || !profile) continue;
    seen.add(row.id);
    brands.push({
      id: row.id.trim().slice(0, 80),
      savedAt: typeof row.savedAt === "string" && !Number.isNaN(Date.parse(row.savedAt)) ? row.savedAt : new Date(0).toISOString(),
      profile,
    });
    if (brands.length >= MAX_BRANDS) break;
  }
  return brands;
}

export function normaliseActiveBrandId(raw: unknown, brands: readonly SavedBrand[]): string | null {
  return typeof raw === "string" && brands.some((brand) => brand.id === raw) ? raw : null;
}

function writeBrand(brands: SavedBrand[], id: string, profile: BrandProfile, at: string): SavedBrand[] {
  const entry: SavedBrand = { id, savedAt: at, profile: structuredClone(profile) };
  const index = brands.findIndex((brand) => brand.id === id);
  const next = index < 0 ? [...brands, entry] : brands.map((brand) => (brand.id === id ? entry : brand));
  return next.length > MAX_BRANDS ? next.slice(next.length - MAX_BRANDS) : next;
}

/** Keep the working brand in the library. A brand that was never saved gets an id. */
export function rememberBrand(
  brands: SavedBrand[],
  activeBrandId: string | null,
  profile: BrandProfile,
  at: string,
): { savedBrands: SavedBrand[]; activeBrandId: string } {
  const id = activeBrandId && brands.some((brand) => brand.id === activeBrandId) ? activeBrandId : uid("brd");
  return { activeBrandId: id, savedBrands: writeBrand(brands, id, profile, at) };
}

/** Store the working brand, then load another saved one. */
export function switchSavedBrand(
  brands: SavedBrand[],
  activeBrandId: string | null,
  profile: BrandProfile,
  nextId: string,
  at: string,
): { savedBrands: SavedBrand[]; activeBrandId: string; brand: BrandProfile } | null {
  const next = brands.find((brand) => brand.id === nextId);
  if (!next || nextId === activeBrandId) return null;
  const remembered = rememberBrand(brands, activeBrandId, profile, at);
  const chosen = remembered.savedBrands.find((brand) => brand.id === nextId);
  if (!chosen) return null;
  return { savedBrands: remembered.savedBrands, activeBrandId: nextId, brand: structuredClone(chosen.profile) };
}

/** Store the working brand, then open a blank one that is already saved. */
export function startSavedBrand(
  brands: SavedBrand[],
  activeBrandId: string | null,
  profile: BrandProfile,
  at: string,
): { savedBrands: SavedBrand[]; activeBrandId: string; brand: BrandProfile } {
  const remembered = rememberBrand(brands, activeBrandId, profile, at);
  const id = uid("brd");
  const brand = freshBrand();
  return {
    activeBrandId: id,
    brand,
    savedBrands: writeBrand(remembered.savedBrands, id, brand, at),
  };
}
