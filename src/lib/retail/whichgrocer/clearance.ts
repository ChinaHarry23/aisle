/**
 * Clearance discount from the founder's own prices and WhichGrocer catalogue rows.
 *
 * The percentage is arithmetic, not a model guess. The recommended price meets the
 * cheapest similar catalogue price and never goes under the founder's raw cost.
 */

import type { PriceRecommendation } from "@/lib/types";
import { aud, GROCERY_STORES, type ShelfOffer } from "./query";

function cents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Dollars typed into the brief. Empty is null. Anything else that is not a dollar amount is invalid. */
export function parseMoneyInput(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return "invalid";
  return cents(Number(trimmed));
}

export function isClearStock(objective: string): boolean {
  return /clear\s+stock/i.test(objective);
}

export function clearanceFieldProblems(input: {
  objective: string;
  unitCostAud?: number | null;
  currentPriceAud?: number | null;
}): { field: "unitCostAud" | "currentPriceAud"; message: string }[] {
  const cost = input.unitCostAud;
  const price = input.currentPriceAud;
  const costSet = typeof cost === "number" && Number.isFinite(cost);
  const priceSet = typeof price === "number" && Number.isFinite(price);
  const needed = isClearStock(input.objective) || costSet || priceSet;
  const problems: { field: "unitCostAud" | "currentPriceAud"; message: string }[] = [];
  if (!needed) return problems;
  if (!costSet || cost < 0) {
    problems.push({
      field: "unitCostAud",
      message: "Enter what the product costs you, in dollars.",
    });
  }
  if (!priceSet || price <= 0) {
    problems.push({
      field: "currentPriceAud",
      message: "Enter the price you sell it for now, in dollars.",
    });
  }
  return problems;
}

function pricedOffers(offers: ShelfOffer[]): ShelfOffer[] {
  const inStock = offers.filter((offer) => !offer.outOfStock && offer.price > 0);
  const grocery = inStock.filter((offer) => GROCERY_STORES.has(offer.store));
  return grocery.length > 0 ? grocery : inStock;
}

/**
 * Discount the current price until it meets the cheapest similar catalogue price.
 * If that price is below cost, stop at cost.
 */
export function recommendClearance(input: {
  unitCostAud?: number | null;
  currentPriceAud?: number | null;
  offers: ShelfOffer[];
}): { ok: true; recommendation: PriceRecommendation } | { ok: false; reason: string } {
  const cost = input.unitCostAud;
  const current = input.currentPriceAud;
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
    return { ok: false, reason: "The brief has no raw cost, so no discount was recommended." };
  }
  if (typeof current !== "number" || !Number.isFinite(current) || current <= 0) {
    return { ok: false, reason: "The brief has no current selling price, so no discount was recommended." };
  }
  const pool = pricedOffers(input.offers);
  if (pool.length === 0) {
    return { ok: false, reason: "WhichGrocer returned no comparable price, so no discount was recommended." };
  }

  const cheapest = [...pool].sort((a, b) => a.price - b.price)[0];
  const market = cents(cheapest.price);
  const marketLabel = `${cheapest.storeLabel} ${aud(market)}`;
  const costCents = cents(cost);
  const currentCents = cents(current);
  const base = {
    unitCostAud: costCents,
    currentPriceAud: currentCents,
    marketPriceAud: market,
    marketLabel,
  };

  if (currentCents <= costCents) {
    return {
      ok: true,
      recommendation: {
        ...base,
        recommendedPriceAud: currentCents,
        discountPct: 0,
        limitedByCost: true,
        rationale: `The current price ${aud(currentCents)} is already at or below the ${aud(costCents)} cost, so no further discount was recommended. The cheapest similar catalogue price is ${marketLabel}.`,
      },
    };
  }

  const limitedByCost = market < costCents;
  const target = limitedByCost ? costCents : market;
  if (currentCents <= target) {
    return {
      ok: true,
      recommendation: {
        ...base,
        recommendedPriceAud: currentCents,
        discountPct: 0,
        limitedByCost: false,
        rationale: `The current price ${aud(currentCents)} is already at or below the cheapest similar catalogue price (${marketLabel}), so no discount was recommended.`,
      },
    };
  }

  let discountPct = Math.round(((currentCents - target) / currentCents) * 100);
  let recommended = cents(currentCents * (1 - discountPct / 100));
  while (discountPct > 0 && recommended + 0.001 < target) {
    discountPct -= 1;
    recommended = cents(currentCents * (1 - discountPct / 100));
  }

  const rationale = limitedByCost
    ? `The cheapest similar catalogue price is ${marketLabel}, which is below the ${aud(costCents)} cost. A ${discountPct}% discount takes ${aud(currentCents)} to ${aud(recommended)}, the deepest cut that still covers cost.`
    : `The cheapest similar catalogue price is ${marketLabel}. A ${discountPct}% discount takes ${aud(currentCents)} to ${aud(recommended)}, in line with that shelf and above the ${aud(costCents)} cost.`;

  return {
    ok: true,
    recommendation: {
      ...base,
      recommendedPriceAud: recommended,
      discountPct,
      limitedByCost,
      rationale,
    },
  };
}
