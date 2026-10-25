import { COUNTRIES } from "@/lib/runtime/intake";
import type {
  BrandProfile,
  Campaign,
  Country,
  RetailCatalogue,
  RetailCompetitor,
  RetailDataset,
  RetailPos,
  RetailProduct,
} from "./types";

/** Collapse a retailer name so "Woolworth" and "Woolworths" are the same banner. */
export function retailerKey(name: string): string {
  const compact = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (compact.startsWith("woolworth")) return "woolworths";
  if (compact.startsWith("coles")) return "coles";
  return compact;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function date(value: unknown): string | null {
  const raw = text(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function pos(value: unknown, label: string): RetailPos | string {
  if (!value || typeof value !== "object") return `${label} needs a pos object.`;
  const row = value as Record<string, unknown>;
  const periodFrom = date(row.periodFrom);
  const periodTo = date(row.periodTo);
  const weeks = num(row.weeks);
  const units = num(row.units);
  const unitsYearAgo = num(row.unitsYearAgo);
  const velocity = num(row.velocityVsLastYearPct);
  const stores = num(row.storesRanged);
  const avgUnits = num(row.avgUnitsPerStoreWeek);
  const avgPrice = num(row.avgPriceAud);
  const attach = num(row.basketAttachLiftPct);
  if (!periodFrom || !periodTo || weeks == null || units == null || unitsYearAgo == null || velocity == null || stores == null || avgUnits == null || avgPrice == null || attach == null) {
    return `${label} pos is missing a date, week count, unit count, velocity, store count or price.`;
  }
  if (weeks < 1 || weeks > 104) return `${label} pos weeks must be between 1 and 104.`;
  return {
    periodFrom, periodTo, weeks: Math.round(weeks), units: Math.round(units), unitsYearAgo: Math.round(unitsYearAgo),
    velocityVsLastYearPct: velocity, storesRanged: Math.round(stores), avgUnitsPerStoreWeek: avgUnits, avgPriceAud: avgPrice, basketAttachLiftPct: attach,
  };
}

function catalogue(value: unknown, label: string): RetailCatalogue | string {
  if (!value || typeof value !== "object") return `${label} needs a catalogue object.`;
  const row = value as Record<string, unknown>;
  const asOf = date(row.asOf);
  const shelf = num(row.shelfPriceAud);
  const attach = num(row.attachRatePct);
  const hero = num(row.heroOnlyAttachRatePct);
  const aisle = text(row.aisle, 80);
  const note = text(row.note, 400);
  if (!asOf || shelf == null || attach == null || hero == null || !aisle) return `${label} catalogue needs asOf, aisle, shelf price and attach rates.`;
  const promo = row.promoPriceAud == null ? null : num(row.promoPriceAud);
  if (row.promoPriceAud != null && promo == null) return `${label} catalogue promo price must be a number or null.`;
  const promoEnds = row.promoEnds == null || row.promoEnds === "" ? null : date(row.promoEnds);
  if (row.promoEnds && !promoEnds) return `${label} catalogue promoEnds must be YYYY-MM-DD.`;
  const pairedWith = Array.isArray(row.pairedWith)
    ? row.pairedWith.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 6).map((item) => item.trim().slice(0, 80))
    : [];
  return {
    asOf, ranged: row.ranged !== false, aisle, shelfPriceAud: shelf, promoPriceAud: promo,
    promoMechanic: text(row.promoMechanic, 80) || null, promoEnds, pairedWith, attachRatePct: attach, heroOnlyAttachRatePct: hero, note,
  };
}

function competitor(value: unknown, label: string): RetailCompetitor | string {
  if (!value || typeof value !== "object") return `${label} has a competitor row that is not an object.`;
  const row = value as Record<string, unknown>;
  const retailer = text(row.retailer, 80);
  const observedAt = date(row.observedAt);
  const channel = text(row.channel, 80);
  const price = num(row.shelfPriceAud);
  const observation = text(row.observation, 400);
  if (!retailer || !observedAt || !channel || price == null || !observation) return `${label} competitor needs retailer, observedAt, channel, shelf price and observation.`;
  return {
    retailer, observedAt, channel, shelfPriceAud: price, onPromotion: row.onPromotion === true,
    promoMechanic: text(row.promoMechanic, 80) || null, observation,
  };
}

function product(value: unknown, index: number): RetailProduct | string {
  const label = `Product ${index + 1}`;
  if (!value || typeof value !== "object") return `${label} is not an object.`;
  const row = value as Record<string, unknown>;
  const sku = text(row.sku, 32);
  const name = text(row.name, 80);
  const brandName = text(row.brandName, 80);
  const category = text(row.category, 80);
  const subcategory = text(row.subcategory, 80);
  if (!sku || !name || !brandName || !category || !subcategory) return `${label} needs sku, name, brandName, category and subcategory.`;
  const parsedPos = pos(row.pos, label);
  if (typeof parsedPos === "string") return parsedPos;
  const parsedCatalogue = catalogue(row.catalogue, label);
  if (typeof parsedCatalogue === "string") return parsedCatalogue;
  if (!Array.isArray(row.competitors) || row.competitors.length === 0) return `${label} needs at least one competitor observation.`;
  const competitors: RetailCompetitor[] = [];
  for (const item of row.competitors.slice(0, 6)) {
    const parsed = competitor(item, label);
    if (typeof parsed === "string") return parsed;
    competitors.push(parsed);
  }
  const aliases = Array.isArray(row.aliases)
    ? row.aliases.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 8).map((item) => item.trim().slice(0, 80))
    : undefined;
  return { sku, name, brandName, category, subcategory, ...(aliases?.length ? { aliases } : {}), pos: parsedPos, catalogue: parsedCatalogue, competitors };
}

/** Accept a retail data JSON upload. The shape is schema 1.0. */
export function parseRetailUpload(value: unknown, fileName: string): { ok: true; dataset: RetailDataset } | { ok: false; error: string } {
  if (!value || typeof value !== "object") return { ok: false, error: "The file is not a JSON object." };
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== "1.0") return { ok: false, error: 'schemaVersion must be "1.0". See the retail data file guide.' };
  const retailer = raw.retailer as Record<string, unknown> | undefined;
  const name = text(retailer?.name, 80);
  const id = text(retailer?.id, 40);
  const country = text(retailer?.country, 2).toUpperCase();
  const extractedAt = date(raw.extractedAt);
  if (!name || !id) return { ok: false, error: "retailer.id and retailer.name are required." };
  if (!COUNTRIES.includes(country as Country)) return { ok: false, error: "retailer.country must be AU, NZ, UK or US." };
  if (raw.currency !== "AUD") return { ok: false, error: 'currency must be "AUD".' };
  if (!extractedAt) return { ok: false, error: "extractedAt must be YYYY-MM-DD." };
  if (!Array.isArray(raw.products) || raw.products.length < 1) return { ok: false, error: "The file needs at least one product." };
  if (raw.products.length > 200) return { ok: false, error: "Limit the file to 200 products." };
  const products: RetailProduct[] = [];
  for (let i = 0; i < raw.products.length; i += 1) {
    const parsed = product(raw.products[i], i);
    if (typeof parsed === "string") return { ok: false, error: parsed };
    products.push(parsed);
  }
  return {
    ok: true,
    dataset: {
      schemaVersion: "1.0",
      fileName: fileName.slice(0, 120) || "retail-data.json",
      uploadedAt: new Date().toISOString(),
      retailer: { id, name, country: country as Country },
      currency: "AUD",
      extractedAt,
      note: text(raw.note, 400),
      products,
    },
  };
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function hits(haystack: string, needle: string): boolean {
  if (needle.length < 4) return false;
  return haystack.includes(needle) || needle.includes(haystack);
}

export type RetailMatch =
  | { kind: "missing" }
  | { kind: "mismatch"; fileRetailer: string; brandRetailer: string }
  | { kind: "wrong_country"; fileCountry: Country; campaignCountry: Country }
  | { kind: "unmatched" }
  | { kind: "product"; product: RetailProduct }
  | { kind: "category"; category: string; products: RetailProduct[] };

/** Find uploaded rows for this campaign. A file for another banner does not match. */
export function matchRetailData(brand: BrandProfile, campaign: Campaign): RetailMatch {
  const dataset = brand.retailData;
  if (!dataset || dataset.schemaVersion !== "1.0" || !dataset.products?.length) return { kind: "missing" };
  if (retailerKey(dataset.retailer.name) !== retailerKey(brand.retailerName)) {
    return { kind: "mismatch", fileRetailer: dataset.retailer.name, brandRetailer: brand.retailerName };
  }
  if (dataset.retailer.country !== campaign.country) {
    return { kind: "wrong_country", fileCountry: dataset.retailer.country, campaignCountry: campaign.country };
  }
  const productName = norm(campaign.product);
  const named = dataset.products.find((row) => {
    const names = [row.name, row.brandName, ...(row.aliases ?? [])].map(norm);
    return names.some((name) => hits(productName, name));
  });
  if (named) return { kind: "product", product: named };
  const category = norm(campaign.category);
  const grouped = dataset.products.filter((row) => hits(category, norm(row.category)) || norm(row.category) === category);
  if (grouped.length) return { kind: "category", category: grouped[0].category, products: grouped };
  return { kind: "unmatched" };
}

export function aud(value: number): string {
  return `$${value.toFixed(2)}`;
}
