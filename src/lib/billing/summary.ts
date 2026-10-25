/**
 * Everything the Billing page and the credits badge show, in one read.
 */

import type { UserRole } from "@/lib/auth/types";
import { getDatabase } from "@/lib/db";
import { balanceMilli, creditMeter, recentLedger, type LedgerEntry } from "./ledger";
import { billingFor, isUnlimited } from "./meter";
import { currentPlan, LIVE_STATUSES, type Plan } from "./plan";
import { createCheckoutSession, openPortal, rowFromOtherMode, stripeReady, type BillingUser } from "./stripe";

type SubscriptionSummary = {
  status: string;
  /** Cancels at the end of the period (classic `cancel_at_period_end` or flexible `cancel_at`). */
  cancelPending: boolean;
  currentPeriodEnd: string | null;
};

export type BillingSummary = {
  plan: Plan;
  /** Team desks (on a hosted install, only the listed ones): nothing is charged, and the credit amount is still logged. */
  unlimited: boolean;
  balanceMilli: number;
  /** Credits spent since the latest grant. */
  spentMilli: number;
  /** spentMilli + balanceMilli. The bar runs from used to left across this pool. */
  allowanceMilli: number;
  subscription: SubscriptionSummary | null;
  ledger: LedgerEntry[];
  stripeReady: boolean;
};

type Row = {
  status: string | null;
  cancel_at_period_end: number | string | null;
  current_period_end: string | null;
  stripe_livemode: number | string | null;
};

export async function subscriptionFor(userId: string): Promise<SubscriptionSummary | null> {
  const db = await getDatabase();
  const rows = await db.query<Row>(
    "select status, cancel_at_period_end, current_period_end, stripe_livemode from billing_customers where user_id = $1",
    [userId],
  );
  const row = rows[0];
  // A customer created for a checkout that was abandoned has no status yet, and
  // a subscription from the other Stripe mode is not one this key can manage.
  if (!row?.status || rowFromOtherMode(row.stripe_livemode)) return null;
  return {
    status: row.status,
    cancelPending: Number(row.cancel_at_period_end ?? 0) !== 0,
    currentPeriodEnd: row.current_period_end,
  };
}

/**
 * A subscription that is still billing, or whose first payment is in flight:
 * send the user to the portal, never a second checkout.
 */
export function subscriptionIsLive(sub: SubscriptionSummary | null) {
  return Boolean(sub && LIVE_STATUSES.includes(sub.status));
}

export async function billingSummary(
  user: { id: string; role: UserRole; email?: string },
  options: { ledger?: boolean } = {},
): Promise<BillingSummary> {
  // First, so a brand-new account's free grant is in the ledger read below.
  const balance = await balanceMilli(user.id);
  const [subscription, ledger, meter] = await Promise.all([
    subscriptionFor(user.id),
    options.ledger === false ? Promise.resolve([]) : recentLedger(user.id, 30),
    creditMeter(user.id, balance),
  ]);
  return {
    plan: currentPlan(),
    unlimited: isUnlimited(billingFor(user)),
    balanceMilli: balance,
    spentMilli: meter.spentMilli,
    allowanceMilli: meter.allowanceMilli,
    subscription,
    ledger,
    stripeReady: stripeReady(),
  };
}

/**
 * Where Subscribe should send this user: a new Checkout, or the portal when a
 * subscription is still billing (never a second subscription).
 */
export async function checkoutOrPortal(user: BillingUser, origin: string): Promise<{ url: string; portal: boolean }> {
  if (subscriptionIsLive(await subscriptionFor(user.id))) {
    // Null when Stripe no longer has the customer: the stale link is gone, so check out afresh.
    const portal = await openPortal(user.id, origin);
    if (portal) return { url: portal.url, portal: true };
  }
  return { url: (await createCheckoutSession(user, origin)).url, portal: false };
}
