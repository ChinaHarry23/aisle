/**
 * The one plan Aisle sells. Prices and conversions live here and nowhere else.
 *
 * Users never hold provider keys: cloud agents, posters and ad videos run on
 * the owner's keys and are paid for in credits. A credit is worth one cent at
 * retail and is charged at twice what the provider bills, so the subscription
 * covers the API bill, Stripe's fee and a margin. Local models are free.
 */
export const PLAN = {
  name: "Aisle Credits",
  priceUsd: 10,
  monthlyCredits: 1000,
  /** Default one-time trial; the server reads FREE_CREDITS through `freeCredits()`. */
  freeCredits: 1000,
  /** Retail value of one credit. */
  usdPerCredit: 0.01,
  /** Credits are charged at this multiple of what the provider bills. */
  markup: 2,
} as const;

/**
 * One-time credit pack. Added on top of the balance (the monthly plan resets
 * instead). Checkout sends this id in metadata; the webhook grants only then.
 */
export const CREDIT_PACK = {
  id: "credits_1000",
  priceUsd: 20,
  credits: 1000,
} as const;

/** The plan as the server sells it, with the owner's FREE_CREDITS override applied. */
export type Plan = Omit<typeof PLAN, "freeCredits"> & { freeCredits: number };

const envCount = (name: string, fallback: number) => {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
};

/** Free trial credits for a new person (FREE_CREDITS, default 1,000; 0 switches the grant off). */
export function freeCredits(): number {
  return envCount("FREE_CREDITS", PLAN.freeCredits);
}

/** At most this many free grants per UTC day across the whole install (FREE_GRANTS_PER_DAY, default 200). */
export function freeGrantsPerDay(): number {
  return envCount("FREE_GRANTS_PER_DAY", 200);
}

export function currentPlan(): Plan {
  return { ...PLAN, freeCredits: freeCredits() };
}

/** Balances are kept in thousandths of a credit so a cheap call is not rounded up to a whole one. */
export const MILLI = 1000;

/** Milli-credits for a provider cost in USD. Any paid call costs at least one milli-credit. */
export function milliForCost(costUsd: number): number {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return 0;
  return Math.max(1, Math.ceil(((costUsd * PLAN.markup) / PLAN.usdPerCredit) * MILLI - 1e-6));
}

export function creditsForCost(costUsd: number): number {
  return milliForCost(costUsd) / MILLI;
}

/** "1,000", "987.4", "0.2", "<0.1". */
export function formatCredits(milli: number): string {
  const credits = milli / MILLI;
  if (credits > 0 && credits < 0.1) return "<0.1";
  return (Math.round(credits * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** Statuses of a subscription that is billing or about to (shared by lib/billing/summary.ts and BillingView). */
export const LIVE_STATUSES = ["active", "trialing", "past_due", "unpaid", "incomplete"];
