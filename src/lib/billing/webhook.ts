/**
 * What a verified Stripe event does to Aisle.
 *
 * `invoice.paid` for a subscription's first or renewal invoice is the only
 * thing that grants credits: it sets the balance to the monthly allowance,
 * once per invoice. Everything else keeps `billing_customers` in step with the
 * subscription so the Billing page can say what is going on.
 *
 * Stripe does not promise order or single delivery, so every handler is safe
 * to replay and to receive early: the user is found from metadata Aisle wrote
 * at checkout (`aisle_user_id`) before falling back to the customer link.
 * Events for objects Aisle never created — `stripe trigger` fixtures, another
 * app on the same account — resolve to no user and are acknowledged unchanged.
 * Late deliveries cannot move state backwards: a canceled subscription stays
 * canceled and ungranted (nor can it take the link back from a newer one),
 * "incomplete" never overwrites a later status, a status snapshot older than
 * the last one applied (Stripe's `event.created`) is skipped, and an older
 * invoice never grants again.
 */

import { getDatabase } from "@/lib/db";
import { expireCredits, resetForInvoice } from "./ledger";
import { stripeRequest, type StripeEvent } from "./stripe";

type Obj = Record<string, unknown>;

const obj = (value: unknown): Obj | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : null;
const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
/** Expandable fields arrive as an id or as the object itself. */
const idOf = (value: unknown): string | null => str(value) ?? str(obj(value)?.id);
const isoFromUnix = (value: unknown): string | null =>
  typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : null;

type WebhookOutcome = { handled: boolean; note: string };

const LINKED = { handled: true };
const ignored = (note: string): WebhookOutcome => ({ handled: false, note });

async function userExists(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const db = await getDatabase();
  const rows = await db.query<{ id: string }>("select id from users where id = $1", [userId]);
  return rows[0]?.id ?? null;
}

async function userForCustomer(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const db = await getDatabase();
  const rows = await db.query<{ user_id: string }>(
    "select user_id from billing_customers where stripe_customer_id = $1",
    [customerId],
  );
  return rows[0]?.user_id ?? null;
}

async function resolveUser(metadataUserId: unknown, customerId: string | null): Promise<string | null> {
  return (await userExists(str(metadataUserId))) ?? (await userForCustomer(customerId));
}

type Link = {
  userId: string;
  customerId: string;
  subscriptionId?: string | null;
  status?: string | null;
  cancelPending?: boolean | null;
  currentPeriodEnd?: string | null;
  /** From the event: which Stripe mode the customer lives in. */
  livemode?: boolean | null;
  /** `event.created` of the event that wrote this status (unix seconds). */
  eventAt?: number | null;
};

/** Upsert the user's Stripe link. Fields left null keep what is stored. */
async function saveLink(link: Link) {
  const db = await getDatabase();
  await db.execute(
    `insert into billing_customers
       (user_id, stripe_customer_id, stripe_subscription_id, status, cancel_at_period_end, current_period_end, stripe_livemode, subscription_event_at, updated_at)
     values ($1, $2, $3, $4, coalesce($5, 0), $6, $8, $9, $7)
     on conflict (user_id) do update set
       stripe_customer_id = $2,
       stripe_subscription_id = coalesce($3, billing_customers.stripe_subscription_id),
       status = coalesce($4, billing_customers.status),
       cancel_at_period_end = coalesce($5, billing_customers.cancel_at_period_end),
       current_period_end = coalesce($6, billing_customers.current_period_end),
       stripe_livemode = coalesce($8, billing_customers.stripe_livemode),
       subscription_event_at = coalesce($9, billing_customers.subscription_event_at),
       updated_at = $7`,
    [
      link.userId,
      link.customerId,
      link.subscriptionId ?? null,
      link.status ?? null,
      link.cancelPending == null ? null : link.cancelPending ? 1 : 0,
      link.currentPeriodEnd ?? null,
      new Date().toISOString(),
      link.livemode == null ? null : link.livemode ? 1 : 0,
      link.eventAt ?? null,
    ],
  );
}

type StoredLink = {
  stripe_subscription_id: string | null;
  status: string | null;
  current_period_end: string | null;
  subscription_event_at: number | string | null;
};

async function storedLink(userId: string): Promise<StoredLink | null> {
  const db = await getDatabase();
  const rows = await db.query<StoredLink>(
    "select stripe_subscription_id, status, current_period_end, subscription_event_at from billing_customers where user_id = $1",
    [userId],
  );
  return rows[0] ?? null;
}

/** A different subscription is stored and still live. */
function otherLiveSubscription(
  stored: StoredLink | null,
  subscriptionId: string,
): stored is StoredLink & { stripe_subscription_id: string } {
  return Boolean(
    stored?.stripe_subscription_id && stored.stripe_subscription_id !== subscriptionId && CURRENT.has(stored.status ?? ""),
  );
}

/**
 * Event ordering for the stored subscription. `older` is true when this event
 * for the same subscription was created before the last one that wrote its
 * status; `stamp` is what to store (the newer of the two, or this event's for
 * a different subscription). Events without `created` are never judged old.
 */
function eventOrder(stored: StoredLink | null, subscriptionId: string, eventAt: number | null) {
  const same = stored?.stripe_subscription_id === subscriptionId;
  const last = same && stored?.subscription_event_at != null ? Number(stored.subscription_event_at) : null;
  const older = eventAt != null && last != null && eventAt < last;
  const stamp = eventAt == null ? null : last != null && last > eventAt ? last : eventAt;
  return { older, stamp };
}

/** Statuses that belong to a subscription someone is (or may soon be) paying for. */
const CURRENT = new Set(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]);

/**
 * May an invoice event for `subscriptionId` write the link's status? Not when
 * another subscription is stored and still live, and never over a canceled one
 * (canceled is final in Stripe).
 */
function invoiceMayWrite(stored: StoredLink | null, subscriptionId: string) {
  if (!stored?.stripe_subscription_id) return true;
  if (stored.stripe_subscription_id !== subscriptionId) return !CURRENT.has(stored.status ?? "");
  return stored.status !== "canceled";
}

/** This subscription's deletion was already processed: its credits are gone and stay gone. */
async function subscriptionEnded(userId: string, subscriptionId: string): Promise<boolean> {
  const db = await getDatabase();
  const rows = await db.query(
    "select 1 as ended from credit_ledger where user_id = $1 and reason = 'expired' and ref = $2 limit 1",
    [userId, subscriptionId],
  );
  return rows.length > 0;
}

/** An invoice for a period that ended at least a day before the stored one is a late replay. */
const OLDER_PERIOD_SLACK_MS = 86_400_000;

/** The subscription behind an invoice, and the metadata snapshotted on it (Basil and later). */
function invoiceSubscription(invoice: Obj) {
  const parent = obj(invoice.parent);
  const details = parent?.type === "subscription_details" ? obj(parent.subscription_details) : null;
  return {
    subscriptionId: idOf(details?.subscription),
    userId: str(obj(details?.metadata)?.aisle_user_id),
  };
}

function invoicePeriodEnd(invoice: Obj): string | null {
  const lines = obj(invoice.lines)?.data;
  const first = Array.isArray(lines) ? obj(lines[0]) : null;
  return isoFromUnix(obj(first?.period)?.end) ?? isoFromUnix(invoice.period_end);
}

async function onCheckoutCompleted(session: Obj, livemode: boolean | null, eventAt: number | null): Promise<WebhookOutcome> {
  if (session.mode !== "subscription") return ignored("not a subscription checkout");
  const customerId = idOf(session.customer);
  const userId = await userExists(str(session.client_reference_id) ?? str(obj(session.metadata)?.aisle_user_id));
  if (!userId || !customerId) return ignored("checkout for an unknown user");
  const subscriptionId = idOf(session.subscription);
  // A late checkout for a subscription that already ended must not take the link back from its successor.
  if (subscriptionId && (await subscriptionEnded(userId, subscriptionId))) {
    return ignored(`checkout for ${subscriptionId}, which already ended`);
  }
  const existing = await storedLink(userId);
  if (subscriptionId && otherLiveSubscription(existing, subscriptionId)) {
    // Another subscription is live: keep it as the stored one and only refresh the customer link.
    await saveLink({ userId, customerId, livemode });
    return { ...LINKED, note: `linked ${customerId} to ${userId}; ${existing.stripe_subscription_id} stays current` };
  }
  // A returning subscriber's old, dead subscription says nothing about this one.
  const replacesDead = Boolean(subscriptionId && existing?.stripe_subscription_id && existing.stripe_subscription_id !== subscriptionId);
  // invoice.paid may already have said "active"; never step that back.
  const writesStatus = !existing?.status || replacesDead;
  await saveLink({
    userId,
    customerId,
    subscriptionId,
    status: writesStatus ? (session.payment_status === "paid" ? "active" : "incomplete") : null,
    livemode,
    eventAt: writesStatus && subscriptionId ? eventAt : null,
  });
  // No credits here: Stripe's rule is to fulfil on the paid invoice.
  return { ...LINKED, note: `linked ${customerId} to ${userId}` };
}

const GRANTING_REASONS = new Set(["subscription_create", "subscription_cycle"]);

/**
 * Stripe may deliver a renewal's invoice.paid days late (a retried delivery),
 * after the subscription was deleted or replaced. Such an invoice grants
 * nothing and cannot revive the subscription.
 */
async function onInvoicePaid(invoice: Obj, livemode: boolean | null, eventAt: number | null): Promise<WebhookOutcome> {
  const invoiceId = str(invoice.id);
  const reason = str(invoice.billing_reason);
  if (!invoiceId || !reason || !GRANTING_REASONS.has(reason)) return ignored(`billing_reason ${reason ?? "none"}`);
  const { subscriptionId, userId: metaUser } = invoiceSubscription(invoice);
  if (!subscriptionId) return ignored("invoice has no subscription");
  const customerId = idOf(invoice.customer);
  const userId = await resolveUser(metaUser, customerId);
  if (!userId || !customerId) return ignored("invoice for an unknown customer");
  if (await subscriptionEnded(userId, subscriptionId)) return ignored(`${subscriptionId} already ended; ${invoiceId} not granted`);
  const stored = await storedLink(userId);
  // A paid invoice for a second live subscription still grants (it was paid, once per
  // invoice), but the stored subscription stays the one the link already tracks.
  const secondLive = otherLiveSubscription(stored, subscriptionId);
  if (!secondLive && !invoiceMayWrite(stored, subscriptionId)) return ignored(`stale ${invoiceId} for ${subscriptionId}`);
  const periodEnd = invoicePeriodEnd(invoice);
  if (
    stored?.stripe_subscription_id === subscriptionId &&
    stored.current_period_end &&
    periodEnd &&
    Date.parse(periodEnd) < Date.parse(stored.current_period_end) - OLDER_PERIOD_SLACK_MS
  ) {
    return ignored(`${invoiceId} is for an earlier period`);
  }
  const order = eventOrder(stored, subscriptionId, eventAt);
  // A paid invoice older than the last status written (say a later payment failure) grants but does not say "active".
  if (!secondLive && !order.older) {
    await saveLink({ userId, customerId, subscriptionId, status: "active", currentPeriodEnd: periodEnd, livemode, eventAt: order.stamp });
  }
  const reset = await resetForInvoice(userId, invoiceId);
  const note = reset ? `reset ${userId} for ${invoiceId}` : `${invoiceId} already granted`;
  return { handled: true, note: secondLive ? `${note}; ${stored.stripe_subscription_id} stays current` : note };
}

async function onInvoiceFailed(invoice: Obj, livemode: boolean | null, eventAt: number | null): Promise<WebhookOutcome> {
  // A first invoice that fails leaves the subscription "incomplete" (Stripe then expires it);
  // calling that past_due would keep a subscription that never started live for good.
  if (str(invoice.billing_reason) === "subscription_create") return ignored("first invoice failed; the subscription stays incomplete");
  const { subscriptionId, userId: metaUser } = invoiceSubscription(invoice);
  if (!subscriptionId) return ignored("invoice has no subscription");
  const customerId = idOf(invoice.customer);
  const userId = await resolveUser(metaUser, customerId);
  if (!userId || !customerId) return ignored("invoice for an unknown customer");
  // The final failed dunning attempt and the deletion race each other; canceled wins.
  const stored = await storedLink(userId);
  const order = eventOrder(stored, subscriptionId, eventAt);
  if (!invoiceMayWrite(stored, subscriptionId) || order.older || (await subscriptionEnded(userId, subscriptionId))) {
    return ignored(`stale payment_failed for ${subscriptionId}`);
  }
  await saveLink({ userId, customerId, subscriptionId, status: "past_due", livemode, eventAt: order.stamp });
  return { handled: true, note: `${userId} past_due` };
}

async function onSubscriptionChanged(
  sub: Obj,
  deleted: boolean,
  livemode: boolean | null,
  eventAt: number | null,
): Promise<WebhookOutcome> {
  const subscriptionId = str(sub.id);
  const customerId = idOf(sub.customer);
  const userId = await resolveUser(obj(sub.metadata)?.aisle_user_id, customerId);
  if (!subscriptionId || !customerId || !userId) return ignored("subscription for an unknown customer");

  // A canceled subscription is final in Stripe: a late snapshot of it cannot
  // take the link back from the subscription that replaced it.
  if (!deleted && (await subscriptionEnded(userId, subscriptionId))) return ignored(`${subscriptionId} already ended`);
  const status = deleted ? "canceled" : (str(sub.status) ?? "active");
  const stored = await storedLink(userId);
  const sameSub = !stored?.stripe_subscription_id || stored.stripe_subscription_id === subscriptionId;
  // An old subscription's late event must not overwrite a newer one.
  if (!sameSub && !CURRENT.has(status)) return ignored(`stale event for ${subscriptionId}`);
  if (sameSub && stored?.status === "canceled" && !deleted) return ignored(`${subscriptionId} already canceled`);
  // A late snapshot from checkout time cannot step a live subscription back to "incomplete".
  // (incomplete_expired is final, so it always applies.)
  if (sameSub && !deleted && status === "incomplete" && stored?.status && stored.status !== "incomplete") {
    return ignored(`stale ${status} snapshot for ${subscriptionId}`);
  }
  // Any other status snapshot older than the last one applied is stale; a deletion is always final.
  const order = eventOrder(stored, subscriptionId, eventAt);
  if (!deleted && order.older) return ignored(`older ${status} snapshot for ${subscriptionId}`);

  const items = obj(sub.items)?.data;
  const item = Array.isArray(items) ? obj(items[0]) : null;
  await saveLink({
    userId,
    customerId,
    subscriptionId,
    status,
    // Flexible billing sets cancel_at; classic sets cancel_at_period_end.
    cancelPending: !deleted && (sub.cancel_at_period_end === true || sub.cancel_at != null),
    currentPeriodEnd: isoFromUnix(item?.current_period_end),
    livemode,
    eventAt: order.stamp,
  });
  if (deleted) {
    await expireCredits(userId, subscriptionId, "Subscription ended; monthly credits expired");
  }
  return { handled: true, note: `${userId} ${status}` };
}

/** A customer deleted in the Dashboard: forget the link so the next Subscribe makes a new one. */
async function onCustomerDeleted(customer: Obj): Promise<WebhookOutcome> {
  const customerId = str(customer.id);
  if (!customerId) return ignored("customer without an id");
  const db = await getDatabase();
  const rows = await db.query("delete from billing_customers where stripe_customer_id = $1 returning user_id", [customerId]);
  return rows.length ? { handled: true, note: `forgot ${customerId}` } : ignored(`unknown customer ${customerId}`);
}

/**
 * A fully refunded or disputed payment takes back the credits it bought, once
 * per charge. A partial refund is the owner's goodwill and changes nothing.
 */
async function onPaymentReversed(object: Obj, kind: "refund" | "dispute"): Promise<WebhookOutcome> {
  let charge = object;
  if (kind === "dispute") {
    const chargeId = idOf(object.charge);
    if (!chargeId) return ignored("dispute without a charge");
    // A dispute does not carry the customer; the charge it is about does.
    charge = obj(object.charge) ?? (await stripeRequest<Obj>("GET", `/v1/charges/${chargeId}`));
  } else if (charge.refunded !== true) {
    return ignored(`partial refund on ${str(charge.id) ?? "a charge"}`);
  }
  const chargeId = str(charge.id);
  const userId = await userForCustomer(idOf(charge.customer));
  if (!chargeId || !userId) return ignored(`${kind} for a payment Aisle did not take`);
  const expired = await expireCredits(
    userId,
    `${kind}:${chargeId}`,
    kind === "refund" ? "Payment refunded; its credits were taken back" : "Payment disputed; its credits were taken back",
  );
  return expired ? { handled: true, note: `${userId} credits expired after ${kind}` } : ignored(`${kind} for ${chargeId} already applied`);
}

async function processStripeEvent(event: StripeEvent): Promise<WebhookOutcome> {
  const object = obj(event.data?.object) ?? {};
  const livemode = typeof event.livemode === "boolean" ? event.livemode : null;
  const eventAt = typeof event.created === "number" && Number.isFinite(event.created) ? Math.floor(event.created) : null;
  switch (event.type) {
    case "checkout.session.completed":
      return onCheckoutCompleted(object, livemode, eventAt);
    case "invoice.paid":
      return onInvoicePaid(object, livemode, eventAt);
    case "invoice.payment_failed":
      return onInvoiceFailed(object, livemode, eventAt);
    // customer.subscription.created is deliberately not handled: checkout and
    // invoice.paid already link the subscription, and its "incomplete"
    // snapshot arriving late would step an active one back.
    case "customer.subscription.updated":
      return onSubscriptionChanged(object, false, livemode, eventAt);
    case "customer.subscription.deleted":
      return onSubscriptionChanged(object, true, livemode, eventAt);
    case "customer.deleted":
      return onCustomerDeleted(object);
    case "charge.refunded":
      return onPaymentReversed(object, "refund");
    case "charge.dispute.created":
      return onPaymentReversed(object, "dispute");
    default:
      return ignored(`unhandled ${event.type}`);
  }
}

/**
 * Handle one delivery. An event id already recorded is acknowledged without
 * work; a new one is recorded only after it was processed, so a crash midway
 * makes Stripe retry rather than lose it.
 */
export async function handleStripeEvent(event: StripeEvent): Promise<WebhookOutcome & { duplicate: boolean }> {
  const db = await getDatabase();
  const seen = await db.query("select id from stripe_events where id = $1", [event.id]);
  if (seen.length) return { handled: false, duplicate: true, note: `${event.id} already processed` };
  const outcome = await processStripeEvent(event);
  await db.execute(
    "insert into stripe_events (id, type, received_at) values ($1, $2, $3) on conflict (id) do nothing",
    [event.id, event.type, new Date().toISOString()],
  );
  return { ...outcome, duplicate: false };
}
