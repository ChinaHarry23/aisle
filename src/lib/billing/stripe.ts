/**
 * Stripe, over plain fetch.
 *
 * Aisle sells one subscription, so it needs four calls — create a customer, a
 * Checkout Session, a Customer Portal session, and (in the owner's setup
 * script) the product and price — plus webhook signature checks. That is small
 * enough to speak the REST API directly: form-encoded bodies, a pinned
 * `Stripe-Version`, and an `Idempotency-Key` on every write that could be
 * retried. Credits are never granted here; only a verified `invoice.paid`
 * webhook does that (see ./webhook.ts).
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getDatabase } from "@/lib/db";
import { CREDIT_PACK } from "./plan";

const DEFAULT_STRIPE_API_VERSION = "2026-08-26.dahlia";
export const PRICE_LOOKUP_KEY = "aisle_monthly_1000";

/** Read at call time so tests and scripts can point it at a fake server. */
export function stripeEnv() {
  return {
    base: (process.env.STRIPE_API_BASE?.trim() || "https://api.stripe.com").replace(/\/$/, ""),
    secretKey: process.env.STRIPE_SECRET_KEY?.trim() || "",
    priceId: process.env.STRIPE_PRICE_ID?.trim() || "",
    webhookSecrets: (process.env.STRIPE_WEBHOOK_SECRET ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    portalConfiguration: process.env.STRIPE_PORTAL_CONFIGURATION?.trim() || "",
    apiVersion: process.env.STRIPE_API_VERSION?.trim() || DEFAULT_STRIPE_API_VERSION,
  };
}

/** Checkout can start: a secret key and the monthly price are both set. */
export function checkoutConfigured() {
  const env = stripeEnv();
  return Boolean(env.secretKey && env.priceId);
}

/** A one-time credit pack can be sold and granted: the secret key and the webhook. */
export function topupConfigured() {
  const env = stripeEnv();
  return Boolean(env.secretKey && env.webhookSecrets.length > 0);
}

/** A live-mode key. Test-mode and live-mode objects (customers, subscriptions) never mix. */
export function stripeLiveMode() {
  return /^(sk|rk)_live_/.test(stripeEnv().secretKey);
}

/** Selling works end to end: checkout, plus the webhook that grants the credits. */
export function stripeReady() {
  return checkoutConfigured() && stripeEnv().webhookSecrets.length > 0;
}

export class StripeNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Billing is not set up on this server yet (missing ${missing.join(", ")}).`);
    this.name = "StripeNotConfiguredError";
  }
}

/** A Stripe `{ error: { type, code, message, param } }` response. */
export class StripeApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly code: string | null;
  readonly param: string | null;
  constructor(status: number, body: { type?: string; code?: string; message?: string; param?: string } | undefined) {
    super(body?.message || `Stripe returned HTTP ${status}.`);
    this.name = "StripeApiError";
    this.status = status;
    this.type = body?.type ?? "api_error";
    this.code = body?.code ?? null;
    this.param = body?.param ?? null;
  }
}

type FormValue = string | number | boolean | null | undefined | FormValue[] | { [key: string]: FormValue };

/** `{ line_items: [{ price: "p" }] }` → `line_items[0][price]=p`. Null and undefined are left out. */
function encodeForm(params: Record<string, FormValue>): URLSearchParams {
  const out = new URLSearchParams();
  const walk = (key: string, value: FormValue) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(`${key}[${i}]`, item));
    } else if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(`${key}[${k}]`, v);
    } else {
      out.append(key, String(value));
    }
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return out;
}

export async function stripeRequest<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, FormValue> = {},
  options: { idempotencyKey?: string } = {},
): Promise<T> {
  const env = stripeEnv();
  if (!env.secretKey) throw new StripeNotConfiguredError(["STRIPE_SECRET_KEY"]);
  const form = encodeForm(params).toString();
  const url = `${env.base}${path}${method !== "POST" && form ? `?${form}` : ""}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.secretKey}`,
    "Stripe-Version": env.apiVersion,
  };
  if (method === "POST") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    // Keys only matter on POST; Stripe replays the first result for a reused key.
    if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  }
  const res = await fetch(url, { method, headers, body: method === "POST" ? form : undefined });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // A proxy error page, not Stripe JSON.
  }
  if (!res.ok) {
    throw new StripeApiError(res.status, (json as { error?: Record<string, string> } | null)?.error);
  }
  return json as T;
}

/* ---------- Webhook signatures ---------- */

export class StripeSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeSignatureError";
  }
}

export type StripeEvent = {
  id: string;
  type: string;
  created?: number;
  livemode?: boolean;
  api_version?: string | null;
  data: { object: Record<string, unknown> };
};

/**
 * Check `Stripe-Signature: t=…,v1=…,v1=…` against the raw body and return the
 * parsed event. Every `v1` is tried (Stripe signs with old and new secrets
 * while one is rolled) against every configured secret; other schemes such as
 * `v0` are ignored so they cannot be used to downgrade. The comparison is
 * constant time and the timestamp must be within `toleranceSec` of now.
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string | null | undefined,
  secrets: string | string[],
  toleranceSec = 300,
  nowSec = Math.floor(Date.now() / 1000),
): StripeEvent {
  const keys = (Array.isArray(secrets) ? secrets : [secrets]).filter(Boolean);
  if (!keys.length) throw new StripeSignatureError("STRIPE_WEBHOOK_SECRET is not set.");
  if (!header) throw new StripeSignatureError("Missing Stripe-Signature header.");

  let timestamp = NaN;
  const signatures: Buffer[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key === "t") timestamp = Number(value);
    else if (key === "v1" && /^[0-9a-f]+$/i.test(value)) signatures.push(Buffer.from(value, "hex"));
  }
  if (!Number.isFinite(timestamp) || !signatures.length) {
    throw new StripeSignatureError("Malformed Stripe-Signature header.");
  }

  const payload = `${timestamp}.${rawBody}`;
  let matched = false;
  for (const secret of keys) {
    const expected = createHmac("sha256", secret).update(payload, "utf8").digest();
    for (const sig of signatures) {
      // Evaluate every pair so timing does not reveal which one matched.
      if (sig.length === expected.length && timingSafeEqual(sig, expected)) matched = true;
    }
  }
  if (!matched) throw new StripeSignatureError("Signature does not match.");
  if (Math.abs(nowSec - timestamp) > toleranceSec) {
    throw new StripeSignatureError("Signature timestamp is outside the tolerance.");
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    throw new StripeSignatureError("Body is not JSON.");
  }
  if (!event || typeof event.id !== "string" || typeof event.type !== "string" || !event.data?.object) {
    throw new StripeSignatureError("Body is not a Stripe event.");
  }
  return event;
}

/** Build a header the way Stripe does. Used by the offline tests and local tooling. */
export function signStripePayload(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const sig = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

/* ---------- Customers, Checkout, Portal ---------- */

export type BillingUser = { id: string; email: string; name: string };

type CustomerRow = { stripe_customer_id: string; stripe_livemode: number | string | null };

async function customerRow(userId: string): Promise<CustomerRow | null> {
  const db = await getDatabase();
  const rows = await db.query<CustomerRow>(
    "select stripe_customer_id, stripe_livemode from billing_customers where user_id = $1",
    [userId],
  );
  return rows[0] ?? null;
}

/** A row written under the other Stripe mode (sandbox testing, then a live key) names a customer that does not exist here. */
export function rowFromOtherMode(livemode: number | string | null | undefined) {
  return livemode != null && (Number(livemode) !== 0) !== stripeLiveMode();
}

/** The user's Stripe customer for the current mode, if there is one. */
export async function customerIdFor(userId: string): Promise<string | null> {
  const row = await customerRow(userId);
  if (!row || rowFromOtherMode(row.stripe_livemode)) return null;
  return row.stripe_customer_id;
}

/**
 * Drop a link whose customer Stripe no longer knows (deleted in the Dashboard,
 * or from the other mode). The row only mirrors Stripe; credits live in the ledger.
 */
async function forgetCustomer(userId: string, customerId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("delete from billing_customers where user_id = $1 and stripe_customer_id = $2", [userId, customerId]);
}

/** Stripe answered "No such customer". */
function isMissingCustomer(error: unknown): boolean {
  return (
    error instanceof StripeApiError &&
    error.code === "resource_missing" &&
    (error.param === "customer" || /customer/i.test(error.message))
  );
}

/**
 * The user's Stripe Customer, created on first use. The idempotency key is the
 * user id, so two tabs clicking Subscribe at once still make one customer, and
 * the row is only inserted when missing. `fresh` replaces a customer Stripe no
 * longer has, with a new key so Stripe cannot replay the deleted one.
 */
async function ensureCustomer(user: BillingUser, options: { fresh?: boolean } = {}): Promise<string> {
  const row = await customerRow(user.id);
  if (row && !options.fresh && !rowFromOtherMode(row.stripe_livemode)) return row.stripe_customer_id;
  if (row) await forgetCustomer(user.id, row.stripe_customer_id);
  const live = stripeLiveMode();
  const customer = await stripeRequest<{ id: string }>(
    "POST",
    "/v1/customers",
    { email: user.email, name: user.name, metadata: { aisle_user_id: user.id } },
    { idempotencyKey: options.fresh ? `customer-${user.id}-${live ? "live" : "test"}-${randomUUID()}` : `customer-${user.id}` },
  );
  const db = await getDatabase();
  await db.execute(
    `insert into billing_customers (user_id, stripe_customer_id, stripe_livemode, updated_at)
     values ($1, $2, $3, $4)
     on conflict (user_id) do nothing`,
    [user.id, customer.id, live ? 1 : 0, new Date().toISOString()],
  );
  return (await customerIdFor(user.id)) ?? customer.id;
}

async function checkoutFor(customer: string, user: BillingUser, origin: string, priceId: string) {
  return stripeRequest<{ id: string; url: string | null }>(
    "POST",
    "/v1/checkout/sessions",
    {
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer,
      client_reference_id: user.id,
      metadata: { aisle_user_id: user.id },
      // Copied onto the subscription and snapshotted on every invoice, so
      // invoice.paid can find the user even if it beats checkout.session.completed.
      subscription_data: { metadata: { aisle_user_id: user.id } },
      success_url: `${origin}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/billing?checkout=cancel`,
    },
    { idempotencyKey: `checkout-${user.id}-${randomUUID()}` },
  );
}

/**
 * A one-time Checkout for CREDIT_PACK. Credits are not granted here: the
 * webhook grants them when Stripe reports the session paid.
 */
export async function createTopupCheckoutSession(user: BillingUser, origin: string): Promise<{ id: string; url: string }> {
  const env = stripeEnv();
  if (!env.secretKey) throw new StripeNotConfiguredError(["STRIPE_SECRET_KEY"]);
  let customer = await ensureCustomer(user);
  const params = {
    mode: "payment" as const,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: CREDIT_PACK.priceUsd * 100,
          product_data: {
            name: `${CREDIT_PACK.credits.toLocaleString("en-US")} Aisle credits`,
            description: `${CREDIT_PACK.credits.toLocaleString("en-US")} credits added to your Aisle balance.`,
          },
        },
      },
    ],
    customer,
    client_reference_id: user.id,
    metadata: { aisle_user_id: user.id, aisle_pack: CREDIT_PACK.id },
    payment_intent_data: { metadata: { aisle_user_id: user.id, aisle_pack: CREDIT_PACK.id } },
    success_url: `${origin}/account/usage?checkout=success`,
    cancel_url: `${origin}/account/usage?checkout=cancel`,
  };
  let session: { id: string; url: string | null };
  try {
    session = await stripeRequest<{ id: string; url: string | null }>("POST", "/v1/checkout/sessions", params, {
      idempotencyKey: `topup-${user.id}-${randomUUID()}`,
    });
  } catch (error) {
    if (!isMissingCustomer(error)) throw error;
    await forgetCustomer(user.id, customer);
    customer = await ensureCustomer(user, { fresh: true });
    session = await stripeRequest<{ id: string; url: string | null }>(
      "POST",
      "/v1/checkout/sessions",
      { ...params, customer },
      { idempotencyKey: `topup-${user.id}-${randomUUID()}` },
    );
  }
  if (!session.url) throw new StripeApiError(502, { message: "Stripe did not return a Checkout URL." });
  return { id: session.id, url: session.url };
}

export async function createCheckoutSession(user: BillingUser, origin: string): Promise<{ id: string; url: string }> {
  const env = stripeEnv();
  const missing = [!env.secretKey && "STRIPE_SECRET_KEY", !env.priceId && "STRIPE_PRICE_ID"].filter(
    (m): m is string => Boolean(m),
  );
  if (missing.length) throw new StripeNotConfiguredError(missing);
  let customer = await ensureCustomer(user);
  let session: { id: string; url: string | null };
  try {
    session = await checkoutFor(customer, user, origin, env.priceId);
  } catch (error) {
    if (!isMissingCustomer(error)) throw error;
    // The stored customer is gone (deleted, or from the other mode): replace it once.
    await forgetCustomer(user.id, customer);
    customer = await ensureCustomer(user, { fresh: true });
    session = await checkoutFor(customer, user, origin, env.priceId);
  }
  if (!session.url) throw new StripeApiError(502, { message: "Stripe did not return a Checkout URL." });
  return { id: session.id, url: session.url };
}

/**
 * A portal session for the user's customer, or null when there is no usable
 * customer (none yet, or Stripe no longer has it — the stale link is dropped).
 */
export async function openPortal(userId: string, origin: string): Promise<{ url: string } | null> {
  const customerId = await customerIdFor(userId);
  if (!customerId) return null;
  try {
    return await createPortalSession(customerId, origin);
  } catch (error) {
    if (!isMissingCustomer(error)) throw error;
    await forgetCustomer(userId, customerId);
    return null;
  }
}

async function createPortalSession(customerId: string, origin: string): Promise<{ url: string }> {
  const env = stripeEnv();
  const session = await stripeRequest<{ url: string }>(
    "POST",
    "/v1/billing_portal/sessions",
    {
      customer: customerId,
      return_url: `${origin}/billing`,
      configuration: env.portalConfiguration || undefined,
    },
    { idempotencyKey: `portal-${randomUUID()}` },
  );
  return { url: session.url };
}
