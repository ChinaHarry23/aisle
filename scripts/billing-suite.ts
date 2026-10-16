/**
 * Billing suite: Stripe checkout, webhooks and credits, fully offline.
 *
 * A fake Stripe answers on 127.0.0.1 (STRIPE_API_BASE) and a throwaway SQLite
 * file holds the accounts, so nothing here reaches Stripe or data/aisle.db.
 *
 *   node --import ./scripts/service-loader.mjs --experimental-strip-types scripts/billing-suite.ts
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { register } from "node:module";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";

// The webhook route and the proxy import "next/server", which Next resolves in
// its bundler; plain Node ESM needs the file name.
register(
  `data:text/javascript,${encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === "next/server" ? "next/server.js" : s, c); }`,
  )}`,
  import.meta.url,
);

const dir = mkdtempSync(path.join(os.tmpdir(), "aisle-billing-test-"));
for (const name of ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "AISLE_DATABASE_URL", "NEON_DATABASE_URL", "STORAGE_URL"]) {
  delete process.env[name];
}
process.env.AISLE_DB = "sqlite";
process.env.AISLE_DB_FILE = path.join(dir, "billing.db");
process.env.AUTH_SECRET = "billing-suite-secret-that-is-long-enough-123";
delete process.env.AUTH_URL;
delete process.env.STRIPE_PORTAL_CONFIGURATION;
delete process.env.STRIPE_API_VERSION;

let checks = 0;
const pass = (label: string) => {
  checks++;
  console.log(`PASS ${label}`);
};

/* ---------- Fake Stripe ---------- */

type Seen = { method: string; path: string; headers: IncomingMessage["headers"]; form: URLSearchParams; query: URLSearchParams };
const seen: Seen[] = [];
const idempotent = new Map<string, unknown>();
let counter = 0;
/** Customers the fake Stripe no longer has (deleted in the Dashboard, or from the other mode). */
const gone = new Set<string>();
const endpoints: { id: string; url: string; enabled_events: string[] }[] = [];
/** Charges a dispute points at; disputes do not carry the customer themselves. */
const charges = new Map<string, { id: string; customer: string }>();

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const url = new URL(req.url ?? "/", "http://fake");
  const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  seen.push({ method: req.method ?? "", path: url.pathname, headers: req.headers, form, query: url.searchParams });
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.headers.authorization !== "Bearer sk_test_fake") {
    return send(401, { error: { type: "invalid_request_error", message: "Invalid API Key provided" } });
  }
  const key = req.headers["idempotency-key"];
  if (typeof key === "string" && idempotent.has(key)) return send(200, idempotent.get(key));
  let body: unknown;
  const route = `${req.method} ${url.pathname}`;
  if (route === "POST /v1/customers") {
    if (form.get("email")?.startsWith("declined")) {
      return send(402, { error: { type: "card_error", code: "card_declined", message: "Your card was declined." } });
    }
    body = { id: `cus_fake${++counter}`, email: form.get("email") };
  } else if ((route === "POST /v1/checkout/sessions" || route === "POST /v1/billing_portal/sessions") && gone.has(form.get("customer") ?? "")) {
    return send(400, { error: { type: "invalid_request_error", code: "resource_missing", param: "customer", message: `No such customer: '${form.get("customer")}'` } });
  } else if (route === "POST /v1/checkout/sessions") {
    body = { id: `cs_fake${++counter}`, url: `https://checkout.stripe.test/c/${counter}` };
  } else if (route === "POST /v1/billing_portal/sessions") {
    body = { id: `bps_${++counter}`, url: `https://billing.stripe.test/p/${counter}` };
  } else if (route === "GET /v1/webhook_endpoints") {
    body = { data: endpoints };
  } else if (route === "POST /v1/webhook_endpoints") {
    const endpoint = { id: `we_${++counter}`, url: form.get("url") ?? "", enabled_events: [...form].filter(([k]) => k.startsWith("enabled_events[")).map(([, v]) => v) };
    endpoints.push(endpoint);
    body = { ...endpoint, secret: "whsec_created_once" };
  } else if (req.method === "POST" && url.pathname.startsWith("/v1/webhook_endpoints/")) {
    const endpoint = endpoints.find((e) => url.pathname.endsWith(`/${e.id}`));
    if (!endpoint) return send(404, { error: { type: "invalid_request_error", code: "resource_missing", message: "No such webhook endpoint" } });
    body = endpoint;
  } else if (req.method === "GET" && url.pathname.startsWith("/v1/charges/")) {
    const charge = charges.get(url.pathname.slice("/v1/charges/".length));
    if (!charge) return send(404, { error: { type: "invalid_request_error", code: "resource_missing", message: "No such charge" } });
    body = charge;
  } else if (route === "GET /v1/prices") {
    body = { data: [] };
  } else if (route === "POST /v1/products") {
    body = { id: "prod_fake" };
  } else if (route === "POST /v1/prices") {
    body = { id: "price_fake", product: form.get("product"), unit_amount: Number(form.get("unit_amount")), currency: form.get("currency"), active: true };
  } else if (route === "GET /v1/billing_portal/configurations") {
    body = { data: [] };
  } else if (route === "POST /v1/billing_portal/configurations") {
    body = { id: "bpc_fake", active: true };
  } else {
    return send(404, { error: { type: "invalid_request_error", message: `No such route ${route}` } });
  }
  if (typeof key === "string") idempotent.set(key, body);
  send(200, body);
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = (server.address() as { port: number }).port;
process.env.STRIPE_API_BASE = `http://127.0.0.1:${port}`;
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_PRICE_ID = "price_monthly";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_primary";

try {
  const stripe = await import("../src/lib/billing/stripe");
  const summary = await import("../src/lib/billing/summary");
  const ledger = await import("../src/lib/billing/ledger");
  const { MILLI, milliForCost } = await import("../src/lib/billing/plan");
  const meter = await import("../src/lib/billing/meter");
  const seeds = await import("../src/lib/auth/seed-accounts");
  const { verifyPassword } = await import("../src/lib/auth/password");
  const signupRoute = await import("../src/app/api/auth/signup/route");
  const users = await import("../src/lib/auth/users");
  const oauthUsers = await import("../src/lib/auth/oauth-users");
  const { getDatabase, closeDatabase } = await import("../src/lib/db/index");
  const route = await import("../src/app/api/stripe/webhook/route");
  const { proxy } = await import("../src/proxy");
  const { NextRequest } = await import("next/server.js");

  /* ---------- Signatures ---------- */
  {
    const body = JSON.stringify({ id: "evt_sig", type: "ping", data: { object: {} } });
    const now = 1_800_000_000;
    const header = stripe.signStripePayload(body, "whsec_primary", now);
    assert.equal(stripe.verifyStripeSignature(body, header, "whsec_primary", 300, now).id, "evt_sig");
    assert.throws(() => stripe.verifyStripeSignature(body.replace("ping", "pong"), header, "whsec_primary", 300, now), /does not match/);
    assert.throws(() => stripe.verifyStripeSignature(body, header, "whsec_other", 300, now), /does not match/);
    assert.throws(() => stripe.verifyStripeSignature(body, header, "whsec_primary", 300, now + 301), /tolerance/);
    assert.doesNotThrow(() => stripe.verifyStripeSignature(body, header, "whsec_primary", 300, now + 299));
    assert.throws(() => stripe.verifyStripeSignature(body, null, "whsec_primary", 300, now), /Missing/);
    assert.throws(() => stripe.verifyStripeSignature(body, "t=abc,v1=00", "whsec_primary", 300, now), /Malformed/);
    // v0 must never be accepted, even when it carries a valid HMAC.
    const v0 = header.replace("v1=", "v0=");
    assert.throws(() => stripe.verifyStripeSignature(body, v0, "whsec_primary", 300, now), /Malformed/);
    // During a roll Stripe sends one v1 per secret; either configured secret passes.
    const oldSig = stripe.signStripePayload(body, "whsec_old", now).split(",")[1];
    const rolled = `${header},${oldSig}`;
    assert.doesNotThrow(() => stripe.verifyStripeSignature(body, rolled, "whsec_primary", 300, now));
    assert.doesNotThrow(() => stripe.verifyStripeSignature(body, rolled, "whsec_old", 300, now));
    assert.doesNotThrow(() => stripe.verifyStripeSignature(body, header, ["whsec_cli", "whsec_primary"], 300, now));
    assert.throws(() => stripe.verifyStripeSignature(body, rolled, "whsec_new", 300, now), /does not match/);
    assert.throws(() => stripe.verifyStripeSignature(body, header, [], 300, now), /not set/);
    pass("signatures: valid, tampered, wrong secret, stale, v0 downgrade, rotated secrets");
  }

  /* ---------- Accounts ---------- */
  await users.ensureSeedAccounts();
  const beta = await users.createUser({ name: "Beta Shop", email: "beta@shop.test", password: "password-123" });
  const early = await users.createUser({ name: "Early Invoice", email: "early@shop.test", password: "password-123" });
  const declined = await users.createUser({ name: "Declined", email: "declined@shop.test", password: "password-123" });
  const dev = await users.findUserByEmail("alex@aisle.website");
  assert.ok(dev && dev.role === "dev");
  const balance = (id: string) => ledger.balanceMilli(id);
  assert.equal(await balance(beta.id), 50 * MILLI);

  /* ---------- Checkout ---------- */
  {
    seen.length = 0;
    const first = await summary.checkoutOrPortal(beta, "https://aisle.test");
    assert.equal(first.portal, false);
    assert.match(first.url, /^https:\/\/checkout\.stripe\.test\//);
    const second = await summary.checkoutOrPortal(beta, "https://aisle.test");
    assert.equal(second.portal, false);
    const customers = seen.filter((r) => r.path === "/v1/customers");
    assert.equal(customers.length, 1, "customer created once");
    assert.equal(customers[0].headers["idempotency-key"], `customer-${beta.id}`);
    assert.equal(customers[0].form.get("metadata[aisle_user_id]"), beta.id);
    assert.equal(customers[0].form.get("email"), "beta@shop.test");
    const sessions = seen.filter((r) => r.path === "/v1/checkout/sessions");
    assert.equal(sessions.length, 2);
    const f = sessions[0].form;
    assert.equal(f.get("mode"), "subscription");
    assert.equal(f.get("line_items[0][price]"), "price_monthly");
    assert.equal(f.get("line_items[0][quantity]"), "1");
    assert.equal(f.get("customer"), "cus_fake1");
    assert.equal(f.get("client_reference_id"), beta.id);
    assert.equal(f.get("subscription_data[metadata][aisle_user_id]"), beta.id);
    assert.equal(f.get("success_url"), "https://aisle.test/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}");
    assert.equal(f.get("cancel_url"), "https://aisle.test/billing?checkout=cancel");
    assert.equal(f.get("customer_creation"), null);
    assert.equal(sessions[0].headers["stripe-version"], "2026-08-26.dahlia");
    assert.equal(sessions[0].headers["content-type"], "application/x-www-form-urlencoded");
    assert.ok(String(sessions[0].headers["idempotency-key"]).startsWith(`checkout-${beta.id}-`));
    assert.notEqual(sessions[0].headers["idempotency-key"], sessions[1].headers["idempotency-key"]);
    // No credits for starting a checkout.
    assert.equal(await balance(beta.id), 50 * MILLI);
    await assert.rejects(summary.checkoutOrPortal(declined, "https://aisle.test"), (e: unknown) => {
      assert.ok(e instanceof stripe.StripeApiError);
      assert.equal(e.status, 402);
      assert.equal(e.code, "card_declined");
      return true;
    });
    const price = process.env.STRIPE_PRICE_ID;
    delete process.env.STRIPE_PRICE_ID;
    await assert.rejects(stripe.createCheckoutSession(beta, "https://aisle.test"), stripe.StripeNotConfiguredError);
    process.env.STRIPE_PRICE_ID = price;
    pass("checkout: one customer per user, subscription params, fresh idempotency per click, typed errors");
  }

  /* ---------- Webhooks ---------- */
  let n = 0;
  const event = (type: string, object: Record<string, unknown>, id = `evt_${++n}`) => ({ id, type, data: { object } });
  const deliver = async (evt: { id: string; type: string; data: unknown }, secret = "whsec_primary", tamper = false) => {
    const raw = JSON.stringify(evt);
    const header = stripe.signStripePayload(raw, secret);
    const res = await route.POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": header, "content-type": "application/json" },
        body: tamper ? raw.replace(evt.id, `${evt.id}x`) : raw,
      }),
    );
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  const invoice = (id: string, opts: { user?: string; customer: string; sub?: string | null; reason: string; end?: number }) => ({
    id,
    object: "invoice",
    customer: opts.customer,
    billing_reason: opts.reason,
    status: "paid",
    parent:
      opts.sub === null
        ? null
        : {
            type: "subscription_details",
            subscription_details: { subscription: opts.sub ?? "sub_beta", metadata: opts.user ? { aisle_user_id: opts.user } : {} },
          },
    lines: { data: [{ period: { start: (opts.end ?? 1_790_000_000) - 2_592_000, end: opts.end ?? 1_790_000_000 } }] },
  });
  const link = async (userId: string) =>
    (
      await (await getDatabase()).query<{ stripe_customer_id: string; stripe_subscription_id: string | null; status: string | null }>(
        "select stripe_customer_id, stripe_subscription_id, status from billing_customers where user_id = $1",
        [userId],
      )
    )[0];

  {
    // Route: bad signature → 400, and nothing is processed.
    const bad = await deliver(event("invoice.paid", invoice("in_bad", { user: beta.id, customer: "cus_fake1", reason: "subscription_create" })), "whsec_wrong");
    assert.equal(bad.status, 400);
    const tampered = await deliver(event("invoice.paid", invoice("in_bad", { user: beta.id, customer: "cus_fake1", reason: "subscription_create" })), "whsec_primary", true);
    assert.equal(tampered.status, 400);
    assert.equal(await balance(beta.id), 50 * MILLI);
    pass("webhook route: bad or tampered signature → 400, no credits");
  }

  {
    // invoice.paid (subscription_create) arrives BEFORE checkout.session.completed:
    // the user is found from the invoice's subscription metadata.
    const paid = await deliver(event("invoice.paid", invoice("in_early_1", { user: early.id, customer: "cus_early", sub: "sub_early", reason: "subscription_create" })));
    assert.equal(paid.status, 200);
    assert.equal(paid.json.handled, true);
    assert.equal(await balance(early.id), 1000 * MILLI);
    let row = await link(early.id);
    assert.equal(row.stripe_customer_id, "cus_early");
    assert.equal(row.stripe_subscription_id, "sub_early");
    assert.equal(row.status, "active");
    const done = await deliver(event("checkout.session.completed", { id: "cs_early", mode: "subscription", status: "complete", payment_status: "paid", client_reference_id: early.id, customer: "cus_early", subscription: "sub_early" }));
    assert.equal(done.status, 200);
    row = await link(early.id);
    assert.equal(row.status, "active", "checkout never steps an active status back");
    assert.equal(await balance(early.id), 1000 * MILLI, "checkout grants nothing");
    pass("invoice before checkout.session.completed: resolved by metadata, credited once, link kept");
  }

  {
    // Normal order for the beta user: checkout completes, then the first invoice.
    const done = await deliver(event("checkout.session.completed", { id: "cs_beta", mode: "subscription", status: "complete", payment_status: "paid", client_reference_id: beta.id, customer: "cus_fake1", subscription: "sub_beta" }));
    assert.equal(done.status, 200);
    assert.equal(await balance(beta.id), 50 * MILLI, "no credits on checkout");
    assert.equal((await link(beta.id)).stripe_subscription_id, "sub_beta");

    // First invoice, resolved by customer only (no metadata on the invoice).
    const create = event("invoice.paid", invoice("in_beta_1", { customer: "cus_fake1", reason: "subscription_create" }));
    assert.equal((await deliver(create)).status, 200);
    assert.equal(await balance(beta.id), 1000 * MILLI);

    // Spend, then a replay of the same event does nothing.
    await ledger.adjustCredits(beta.id, -300 * MILLI, "test spend");
    const replay = await deliver(create);
    assert.equal(replay.status, 200);
    assert.equal(replay.json.duplicate, true);
    assert.equal(await balance(beta.id), 700 * MILLI);
    // A different event for the same invoice (Stripe resends with a new id on some paths) is still one grant.
    await deliver(event("invoice.paid", invoice("in_beta_1", { user: beta.id, customer: "cus_fake1", reason: "subscription_create" })));
    assert.equal(await balance(beta.id), 700 * MILLI);

    // Renewal resets to the allowance (no rollover), once.
    const cycle = event("invoice.paid", invoice("in_beta_2", { user: beta.id, customer: "cus_fake1", reason: "subscription_cycle", end: 1_792_600_000 }));
    await deliver(cycle);
    assert.equal(await balance(beta.id), 1000 * MILLI);
    await ledger.adjustCredits(beta.id, -10 * MILLI, "test spend");
    await deliver(cycle);
    assert.equal(await balance(beta.id), 990 * MILLI);
    const resets = (await ledger.recentLedger(beta.id, 50)).filter((e) => e.reason === "monthly_reset");
    assert.equal(resets.length, 2);
    assert.equal(resets.find((e) => e.ref === "in_beta_1")?.deltaMilli, 950 * MILLI);

    // Proration and manual invoices never grant.
    await deliver(event("invoice.paid", invoice("in_beta_upd", { user: beta.id, customer: "cus_fake1", reason: "subscription_update" })));
    await deliver(event("invoice.paid", invoice("in_beta_man", { user: beta.id, customer: "cus_fake1", reason: "manual" })));
    assert.equal(await balance(beta.id), 990 * MILLI);
    pass("subscription_create then subscription_cycle: reset once per invoice, replays and other reasons ignored");
  }

  {
    // Fixture objects from `stripe trigger`: unknown customers and one-off invoices.
    const fixture = await deliver(event("invoice.paid", invoice("in_fixture", { customer: "cus_unknown", sub: null, reason: "manual" })));
    assert.equal(fixture.status, 200);
    assert.equal(fixture.json.handled, false);
    const fixtureSub = await deliver(event("invoice.paid", invoice("in_fixture2", { customer: "cus_unknown", sub: "sub_x", reason: "subscription_create" })));
    assert.equal(fixtureSub.status, 200);
    assert.equal(fixtureSub.json.handled, false);
    const ghost = await deliver(event("invoice.paid", invoice("in_fixture3", { user: "usr_ghost", customer: "cus_unknown", sub: "sub_x", reason: "subscription_create" })));
    assert.equal(ghost.json.handled, false);
    const checkoutFixture = await deliver(event("checkout.session.completed", { id: "cs_fx", mode: "subscription", customer: "cus_unknown", client_reference_id: null }));
    assert.equal(checkoutFixture.status, 200);
    assert.equal(checkoutFixture.json.handled, false);
    const paymentMode = await deliver(event("checkout.session.completed", { id: "cs_pay", mode: "payment", customer: "cus_fake1", client_reference_id: beta.id }));
    assert.equal(paymentMode.json.handled, false);
    const other = await deliver(event("charge.succeeded", { id: "ch_1" }));
    assert.equal(other.status, 200);
    const count = await (await getDatabase()).query<{ n: number }>("select count(*) as n from billing_customers where stripe_customer_id = 'cus_unknown'");
    assert.equal(Number(count[0].n), 0);
    pass("unlinked fixture events acknowledged with 200 and ignored");
  }

  {
    // Payment failure → past_due; Subscribe now sends the user to the portal.
    await deliver(event("invoice.payment_failed", invoice("in_beta_3", { user: beta.id, customer: "cus_fake1", reason: "subscription_cycle" })));
    assert.equal((await link(beta.id)).status, "past_due");
    seen.length = 0;
    const next = await summary.checkoutOrPortal(beta, "https://aisle.test");
    assert.equal(next.portal, true);
    assert.equal(seen.filter((r) => r.path === "/v1/checkout/sessions").length, 0);
    const portalReq = seen.find((r) => r.path === "/v1/billing_portal/sessions");
    assert.equal(portalReq?.form.get("customer"), "cus_fake1");
    assert.equal(portalReq?.form.get("return_url"), "https://aisle.test/billing");
    pass("invoice.payment_failed → past_due, and a live subscription gets the portal instead of a second checkout");
  }

  {
    const sub = (overrides: Record<string, unknown>) => ({
      id: "sub_beta",
      object: "subscription",
      customer: "cus_fake1",
      status: "active",
      cancel_at_period_end: false,
      cancel_at: null,
      metadata: { aisle_user_id: beta.id },
      items: { data: [{ current_period_start: 1_792_600_000, current_period_end: 1_795_200_000 }] },
      ...overrides,
    });
    await deliver(event("customer.subscription.updated", sub({})));
    let s = await summary.subscriptionFor(beta.id);
    assert.equal(s?.status, "active");
    assert.equal(s?.cancelPending, false);
    assert.equal(s?.currentPeriodEnd, new Date(1_795_200_000 * 1000).toISOString());
    // Flexible billing mode: cancel_at set, cancel_at_period_end false.
    await deliver(event("customer.subscription.updated", sub({ cancel_at: 1_795_200_000 })));
    assert.equal((await summary.subscriptionFor(beta.id))?.cancelPending, true);
    await deliver(event("customer.subscription.updated", sub({})));
    assert.equal((await summary.subscriptionFor(beta.id))?.cancelPending, false);
    // Classic: cancel_at_period_end.
    await deliver(event("customer.subscription.updated", sub({ cancel_at_period_end: true })));
    assert.equal((await summary.subscriptionFor(beta.id))?.cancelPending, true);
    // Resolved by customer when metadata is missing.
    await deliver(event("customer.subscription.updated", sub({ metadata: {}, status: "past_due" })));
    assert.equal((await summary.subscriptionFor(beta.id))?.status, "past_due");

    const before = await balance(beta.id);
    assert.ok(before > 0);
    const deleted = event("customer.subscription.deleted", sub({ status: "canceled" }));
    assert.equal((await deliver(deleted)).status, 200);
    s = await summary.subscriptionFor(beta.id);
    assert.equal(s?.status, "canceled");
    assert.equal(s?.cancelPending, false);
    assert.equal(await balance(beta.id), 0, "no rollover past the subscription");
    await ledger.adjustCredits(beta.id, 5 * MILLI, "goodwill");
    await deliver(event("customer.subscription.deleted", sub({ status: "canceled" })));
    assert.equal(await balance(beta.id), 5 * MILLI, "a second delete event does not expire again");
    const expired = (await ledger.recentLedger(beta.id, 50)).filter((e) => e.reason === "expired");
    assert.equal(expired.length, 1);
    assert.equal(expired[0].deltaMilli, -before);
    // A late 'updated' for the canceled subscription cannot revive it.
    await deliver(event("customer.subscription.updated", sub({ status: "active" })));
    assert.equal((await summary.subscriptionFor(beta.id))?.status, "canceled");
    // After cancel, Subscribe starts a fresh checkout again.
    assert.equal((await summary.checkoutOrPortal(beta, "https://aisle.test")).portal, false);
    // A new subscription replaces the old one, and the old one's late events are ignored.
    await deliver(event("invoice.paid", invoice("in_beta_new", { user: beta.id, customer: "cus_fake1", sub: "sub_beta2", reason: "subscription_create" })));
    assert.equal(await balance(beta.id), 1000 * MILLI);
    assert.equal((await link(beta.id)).stripe_subscription_id, "sub_beta2");
    await deliver(event("customer.subscription.deleted", sub({ status: "canceled" })));
    assert.equal(await balance(beta.id), 1000 * MILLI, "old subscription's delete does not touch the new one");
    assert.equal((await summary.subscriptionFor(beta.id))?.status, "active");
    pass("subscription updated/deleted: status, cancel pending (both modes), period end, expiry once, stale events ignored");
  }

  {
    // Processing failure → 500 so Stripe retries, and the event is not recorded as done.
    // (A user with no link yet, on a customer id that belongs to someone else: the unique index refuses it.)
    const clashUser = await users.createUser({ name: "Clash", email: "clash@shop.test", password: "password-123" });
    const clash = event("invoice.paid", invoice("in_clash", { user: clashUser.id, customer: "cus_fake1", sub: "sub_clash", reason: "subscription_create" }));
    const original = console.error;
    console.error = () => {};
    const res = await deliver(clash);
    console.error = original;
    assert.equal(res.status, 500);
    const recorded = await (await getDatabase()).query("select id from stripe_events where id = $1", [clash.id]);
    assert.equal(recorded.length, 0);
    pass("processing error → 500 and the event stays unrecorded for the retry");
  }

  /* ---------- Summary ---------- */
  {
    const b = await summary.billingSummary({ id: beta.id, role: "beta" });
    assert.equal(b.unlimited, false);
    assert.equal(b.balanceMilli, 1000 * MILLI);
    assert.equal(b.subscription?.status, "active");
    assert.equal(b.stripeReady, true);
    assert.ok(b.ledger.length > 0);
    assert.equal(b.plan.priceUsd, 10);
    const briefSummary = await summary.billingSummary({ id: beta.id, role: "beta" }, { ledger: false });
    assert.equal(briefSummary.ledger.length, 0);
    const d = await summary.billingSummary({ id: dev!.id, role: "dev" });
    assert.equal(d.unlimited, true);
    assert.equal(d.subscription, null);
    const fresh = await users.createUser({ name: "Fresh", email: "fresh@shop.test", password: "password-123" });
    const f = await summary.billingSummary({ id: fresh.id, role: "beta" });
    assert.equal(f.balanceMilli, 50 * MILLI);
    assert.equal(f.ledger[0]?.reason, "free_grant");
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    assert.equal((await summary.billingSummary({ id: beta.id, role: "beta" })).stripeReady, false);
    const quiet = console.error;
    console.error = () => {};
    const noSecret = await deliver(event("invoice.paid", invoice("in_x", { customer: "cus_fake1", reason: "manual" })));
    console.error = quiet;
    assert.equal(noSecret.status, 500, "missing secret is retried, not rejected");
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    pass("summary: beta balance and subscription, dev unlimited, new account's free grant, stripeReady");
  }

  /* ---------- Proxy ---------- */
  {
    const hook = await proxy(new NextRequest("http://localhost:3000/api/stripe/webhook", { method: "POST" }));
    // Cindy's proxy.ts is restored exactly: only `/`, login/signup, `/api/auth/*`
    // and `/api/health` are public. Stripe webhook is a PR #2 route and is
    // session-gated here the same as other APIs.
    assert.equal(hook.status, 307);
    const billing = await proxy(new NextRequest("http://localhost:3000/api/billing"));
    assert.equal(billing.status, 307);
    assert.match(billing.headers.get("location") ?? "", /\/login/);
    const page = await proxy(new NextRequest("http://localhost:3000/billing"));
    assert.equal(page.status, 307);
    pass("proxy: webhook is public, billing routes still need a session");
  }

  /* ---------- Owner setup script ---------- */
  {
    const run = (args: string[], env: Record<string, string>) =>
      new Promise<{ code: number; out: string }>((resolve) => {
        execFile(
          process.execPath,
          ["--no-warnings", "--experimental-strip-types", "scripts/stripe-setup.ts", ...args],
          { env: { ...process.env, ...env }, cwd: process.cwd() },
          (error, stdout, stderr) => resolve({ code: error ? Number(error.code ?? 1) : 0, out: `${stdout}${stderr}` }),
        );
      });
    seen.length = 0;
    const dry = await run([], {});
    assert.equal(dry.code, 0);
    assert.match(dry.out, /Nothing was changed/);
    assert.equal(seen.length, 0);
    const live = await run(["--create"], { STRIPE_SECRET_KEY: "sk_live_should_refuse" });
    assert.notEqual(live.code, 0);
    assert.doesNotMatch(live.out, /sk_live_should_refuse/);
    assert.equal(seen.length, 0);
    const made = await run(["--create"], {});
    assert.equal(made.code, 0, made.out);
    assert.match(made.out, /STRIPE_PRICE_ID=price_fake/);
    assert.match(made.out, /STRIPE_PORTAL_CONFIGURATION=bpc_fake/);
    assert.doesNotMatch(made.out, /sk_test_fake/);
    const priceReq = seen.find((r) => r.method === "POST" && r.path === "/v1/prices");
    assert.equal(priceReq?.form.get("unit_amount"), "1000");
    assert.equal(priceReq?.form.get("currency"), "usd");
    assert.equal(priceReq?.form.get("recurring[interval]"), "month");
    assert.equal(priceReq?.form.get("lookup_key"), "aisle_monthly_1000");
    const portalReq = seen.find((r) => r.method === "POST" && r.path === "/v1/billing_portal/configurations");
    assert.equal(portalReq?.form.get("features[subscription_cancel][mode]"), "at_period_end");
    assert.equal(portalReq?.form.get("features[subscription_update][enabled]"), "false");
    assert.equal(portalReq?.form.get("features[payment_method_update][enabled]"), "true");
    assert.equal(portalReq?.form.get("features[invoice_history][enabled]"), "true");
    pass("stripe-setup: refuses without --create or with a live key, creates price + portal, never prints the key");
  }

  /* ---------- Owner setup script: re-runs reuse, never duplicate ---------- */
  {
    const run = (args: string[]) =>
      new Promise<{ code: number; out: string }>((resolve) => {
        execFile(
          process.execPath,
          ["--no-warnings", "--experimental-strip-types", "scripts/stripe-setup.ts", ...args],
          { env: process.env, cwd: process.cwd() },
          (error, stdout, stderr) => resolve({ code: error ? Number(error.code ?? 1) : 0, out: `${stdout}${stderr}` }),
        );
      });
    seen.length = 0;
    const hook = "https://aisle.test/api/stripe/webhook";
    const first = await run(["--create", "--webhook-url", hook]);
    assert.equal(first.code, 0, first.out);
    assert.match(first.out, /STRIPE_WEBHOOK_SECRET=whsec_created_once/);
    const again = await run(["--create", "--webhook-url", hook]);
    assert.equal(again.code, 0, again.out);
    assert.match(again.out, /already exists/);
    assert.doesNotMatch(again.out, /STRIPE_WEBHOOK_SECRET=whsec/);
    assert.equal(seen.filter((r) => r.method === "POST" && r.path === "/v1/webhook_endpoints").length, 1, "one endpoint per URL");
    assert.equal(endpoints.length, 1);
    assert.ok(endpoints[0].enabled_events.includes("customer.deleted"));
    assert.ok(!endpoints[0].enabled_events.includes("customer.subscription.created"));
    const creates = seen.filter((r) => r.method === "POST" && (r.path === "/v1/products" || r.path === "/v1/prices"));
    assert.ok(creates.length >= 2);
    for (const r of creates) assert.match(String(r.headers["idempotency-key"]), /^aisle-(product|price)-v1$/);
    pass("stripe-setup re-run: reuses the webhook endpoint for the same URL; product and price carry fixed idempotency keys");
  }

  const db = await getDatabase();
  const usd = (credits: number) => (credits * 0.01) / 2; // provider cost that charges `credits`
  const holdStatus = async (ref: string) =>
    (await db.query<{ status: string }>("select status from credit_holds where ref = $1", [ref]))[0]?.status;

  /* ---------- C2 / C19: holds across a reset or an expiry ---------- */
  {
    const u = await users.createUser({ name: "Holdy", email: "holdy@shop.test", password: "password-123" });
    const ctx = meter.billingFor(u);
    assert.equal(await ledger.resetForInvoice(u.id, "in_h1"), true);
    await ledger.adjustCredits(u.id, -300 * MILLI, "spend");
    assert.equal(milliForCost(usd(640)), 640 * MILLI);
    // Case A: 700 credits, a 640-credit video hold, then the renewal invoice, then the render fails.
    const video = await meter.holdCredits(ctx, usd(640));
    assert.ok(video);
    assert.equal(await balance(u.id), 60 * MILLI);
    assert.equal(await ledger.resetForInvoice(u.id, "in_h2"), true);
    assert.equal(await balance(u.id), 1000 * MILLI);
    await meter.releaseHold(video);
    assert.equal(await balance(u.id), 1000 * MILLI, "hold → reset → release ends at 1,000 (not 1,640)");
    // Same, but the render finishes below its hold: nothing comes back, nothing extra is charged.
    const under = await meter.holdCredits(ctx, usd(300));
    await ledger.resetForInvoice(u.id, "in_h3");
    await meter.settleHold(under!, usd(100), { modelId: "m" });
    assert.equal(await balance(u.id), 1000 * MILLI);

    // Case B: hold, the subscription is deleted (credits expire), then the call settles.
    const clip = await meter.holdCredits(ctx, usd(640));
    await ledger.expireCredits(u.id, "sub_holdy", "ended");
    assert.equal(await balance(u.id), 0);
    await meter.settleHold(clip!, usd(200), { modelId: "m" });
    assert.ok((await balance(u.id)) <= 0, "hold → expire → settle stays at or below 0");
    assert.equal(await balance(u.id), 0);
    // An overrun beyond the hold is still charged after the expiry...
    await ledger.adjustCredits(u.id, 100 * MILLI, "top-up");
    const small = await meter.holdCredits(ctx, usd(100));
    await ledger.expireCredits(u.id, "sub_holdy2", "ended");
    await meter.settleHold(small!, usd(250), { modelId: "m" });
    assert.equal(await balance(u.id), -150 * MILLI, "only the overrun (250 - 100) lands");
    // ...and that debt is carried into the next month instead of forgiven.
    assert.equal(await ledger.resetForInvoice(u.id, "in_h4"), true);
    assert.equal(await balance(u.id), 850 * MILLI, "debt carries across a reset");
    const reset = (await ledger.recentLedger(u.id, 50)).find((e) => e.ref === "in_h4");
    assert.equal(reset?.balanceAfterMilli, 850 * MILLI);
    assert.equal(reset?.deltaMilli, 1000 * MILLI);
    pass("C2/C19: grant epochs — a hold straddling a reset or expiry returns nothing, overruns still charge, debt carries over");
  }

  /* ---------- C5: holds are stored; double settle harmless; the sweeper returns stranded holds once ---------- */
  {
    const u = await users.createUser({ name: "Sweep", email: "sweep@shop.test", password: "password-123" });
    const ctx = meter.billingFor(u);
    assert.equal(await balance(u.id), 50 * MILLI);
    const once = await meter.holdCredits(ctx, usd(20));
    assert.equal(await holdStatus(once!.ref), "open");
    await meter.settleHold(once!, usd(5), { modelId: "m" });
    assert.equal(await balance(u.id), 45 * MILLI);
    await meter.settleHold(once!, usd(5), { modelId: "m" });
    await meter.releaseHold(once!);
    assert.equal(await balance(u.id), 45 * MILLI, "a second settle or a release after settling changes nothing");
    const released = await meter.holdCredits(ctx, usd(10));
    await meter.releaseHold(released!);
    await meter.releaseHold(released!);
    assert.equal(await balance(u.id), 45 * MILLI, "double release returns the hold once");

    // A process that died mid-call: the hold is still open 21 minutes later.
    const stranded = await meter.holdCredits(ctx, usd(30));
    assert.equal(await balance(u.id), 15 * MILLI);
    await db.execute("update credit_holds set created_at = $1 where ref = $2", [new Date(Date.now() - 21 * 60_000).toISOString(), stranded!.ref]);
    assert.equal(await balance(u.id), 45 * MILLI, "the sweeper returned the stranded hold");
    assert.equal(await balance(u.id), 45 * MILLI, "and only once");
    assert.equal(await holdStatus(stranded!.ref), "swept");
    const swept = (await ledger.recentLedger(u.id, 50)).filter((e) => e.ref === `hold:${stranded!.ref}`);
    assert.equal(swept.length, 1);
    assert.equal(swept[0].reason, "adjust");
    assert.equal(swept[0].deltaMilli, 30 * MILLI);
    // The call did finish after all: its real cost lands as a fresh debit, once.
    await meter.settleHold(stranded!, usd(8), { modelId: "m" });
    await meter.settleHold(stranded!, usd(8), { modelId: "m" });
    assert.equal(await balance(u.id), 37 * MILLI, "a swept hold that settles late is charged its real cost");
    // A stranded hold from before a reset is forfeited, not returned on top of the new month.
    const lapsing = await meter.holdCredits(ctx, usd(20));
    await ledger.resetForInvoice(u.id, "in_sweep_1");
    await db.execute("update credit_holds set created_at = $1 where ref = $2", [new Date(Date.now() - 21 * 60_000).toISOString(), lapsing!.ref]);
    assert.equal(await balance(u.id), 1000 * MILLI);
    assert.equal(await holdStatus(lapsing!.ref), "lapsed");
    pass("C5: holds persist in credit_holds; double settle/release is harmless; the sweeper returns a stranded hold once (with an adjust row)");
  }

  /* ---------- LOW: settle retries once; a failed reset can be retried by Stripe ---------- */
  {
    const u = await users.createUser({ name: "Retry", email: "retry@shop.test", password: "password-123" });
    const ctx = meter.billingFor(u);
    const hold = await meter.holdCredits(ctx, usd(20));
    const realQuery = db.query;
    let failures = 0;
    db.query = (async (text: string, params?: unknown[]) => {
      if (failures === 0 && /update credit_accounts\s+set balance_milli = balance_milli \+ case/.test(text)) {
        failures++;
        throw new Error("database blip");
      }
      return realQuery(text, params);
    }) as typeof db.query;
    try {
      await meter.settleHold(hold!, usd(5), { modelId: "m" });
    } finally {
      db.query = realQuery;
    }
    assert.equal(failures, 1);
    assert.equal(await balance(u.id), 45 * MILLI, "the retry settled it");

    await db.execute(
      "create trigger fail_reset before update on credit_accounts when new.last_grant_ref = 'in_fail' begin select raise(abort, 'reset blocked'); end",
    );
    await assert.rejects(ledger.resetForInvoice(u.id, "in_fail"), /reset blocked/);
    assert.equal((await ledger.recentLedger(u.id, 50)).filter((e) => e.ref === "in_fail").length, 0, "no ledger row claims a grant that did not land");
    await db.execute("drop trigger fail_reset");
    assert.equal(await ledger.resetForInvoice(u.id, "in_fail"), true, "Stripe's retry grants it");
    assert.equal(await ledger.resetForInvoice(u.id, "in_fail"), false);
    assert.equal(await balance(u.id), 1000 * MILLI);
    pass("LOW: settlement retries once; a reset whose balance update fails removes its ledger row so the retry grants");
  }

  /* ---------- N8 / N10 / N11: sweeper races, parked settles, pruning ---------- */
  {
    const realQuery = db.query;
    /** Run `before` ahead of each query, then the query itself: lets a test land between two sweeper steps. */
    const intercept = (before: (text: string) => Promise<void>) => {
      db.query = (async (text: string, params?: unknown[]) => {
        await before(text);
        return realQuery(text, params);
      }) as typeof db.query;
    };
    const restore = () => {
      db.query = realQuery;
    };
    const age = (ref: string) =>
      db.execute("update credit_holds set created_at = $1 where ref = $2", [new Date(Date.now() - 21 * 60_000).toISOString(), ref]);
    const sweeperRefund = /set balance_milli = balance_milli \+ case when grant_epoch = cast\(\$1 as integer\) then cast\(\$2 as integer\) else 0 end/;

    // N8: the sweeper flips a hold to swept, a reset lands before its refund, then the late settle arrives.
    const u = await users.createUser({ name: "Race", email: "race@shop.test", password: "password-123" });
    const ctx = meter.billingFor(u);
    await ledger.resetForInvoice(u.id, "in_race_1");
    const hold = await meter.holdCredits(ctx, usd(30));
    await age(hold!.ref);
    let armed = true;
    intercept(async (text) => {
      if (armed && sweeperRefund.test(text)) {
        armed = false;
        await ledger.resetForInvoice(u.id, "in_race_2");
        await meter.settleHold(hold!, usd(30), { modelId: "m" });
      }
    });
    try {
      await ledger.sweepStaleHolds(u.id);
    } finally {
      restore();
    }
    assert.equal(armed, false);
    assert.equal(await balance(u.id), 1000 * MILLI, "a hold forfeited at the reset is not charged again by a late settle");
    // Same race with an overrun: only the part above the hold is owed.
    const over = await meter.holdCredits(ctx, usd(30));
    await age(over!.ref);
    armed = true;
    intercept(async (text) => {
      if (armed && sweeperRefund.test(text)) {
        armed = false;
        await ledger.resetForInvoice(u.id, "in_race_3");
        await meter.settleHold(over!, usd(50), { modelId: "m" });
      }
    });
    try {
      await ledger.sweepStaleHolds(u.id);
    } finally {
      restore();
    }
    assert.equal(await balance(u.id), 980 * MILLI, "only the 20-credit overrun lands");
    // No reset in between: the settle charges in full and the sweeper still returns the hold.
    const same = await meter.holdCredits(ctx, usd(30));
    await age(same!.ref);
    armed = true;
    intercept(async (text) => {
      if (armed && sweeperRefund.test(text)) {
        armed = false;
        await meter.settleHold(same!, usd(8), { modelId: "m" });
      }
    });
    try {
      await ledger.sweepStaleHolds(u.id);
    } finally {
      restore();
    }
    assert.equal(await balance(u.id), 972 * MILLI, "same epoch: the real 8 credits are charged once");

    // N10: settle fails twice; the charge is parked and applied by the sweeper, not refunded.
    const parked = await meter.holdCredits(ctx, usd(40));
    assert.equal(await balance(u.id), 932 * MILLI);
    let failures = 0;
    db.query = (async (text: string, params?: unknown[]) => {
      if (failures < 2 && /update credit_accounts\s+set balance_milli = balance_milli \+ case/.test(text)) {
        failures++;
        throw new Error("database down");
      }
      return realQuery(text, params);
    }) as typeof db.query;
    try {
      await assert.rejects(meter.settleHold(parked!, usd(12), { modelId: "m" }), /database down/);
    } finally {
      restore();
    }
    assert.equal(failures, 2);
    const row = (await db.query<{ status: string; charged_milli: number }>("select status, charged_milli from credit_holds where ref = $1", [parked!.ref]))[0];
    assert.deepEqual([row.status, Number(row.charged_milli)], ["pending_settle", 12 * MILLI]);
    assert.equal(await balance(u.id), 960 * MILLI, "the sweeper applied the parked 12-credit charge (40 held, 28 back)");
    assert.equal(await holdStatus(parked!.ref), "settled");
    await age(parked!.ref);
    assert.equal(await balance(u.id), 960 * MILLI, "and never refunds it later");
    const usage = (await ledger.recentLedger(u.id, 50)).filter((e) => e.ref === parked!.ref && e.reason === "usage");
    assert.equal(usage.length, 1);
    assert.equal(usage[0].deltaMilli, -12 * MILLI);

    // N11: closed holds older than 30 days are pruned by the sweeper; recent and open ones stay.
    const pruneUser = "usr_prune_only";
    const old = new Date(Date.now() - 31 * 86_400_000).toISOString();
    const recent = new Date(Date.now() - 29 * 86_400_000).toISOString();
    for (const [ref, status, created] of [
      ["p_settled", "settled", old],
      ["p_lapsed", "lapsed", old],
      ["p_swept", "swept", old],
      ["p_recent", "settled", recent],
      ["p_open", "open", new Date().toISOString()],
    ]) {
      await db.execute("insert into credit_holds (ref, user_id, milli, epoch, status, created_at) values ($1, $2, 1000, 0, $3, $4)", [ref, pruneUser, status, created]);
    }
    await ledger.sweepStaleHolds(pruneUser);
    const left = (await db.query<{ ref: string }>("select ref from credit_holds where user_id = $1 order by ref", [pruneUser])).map((r) => r.ref);
    assert.deepEqual(left, ["p_open", "p_recent"]);
    pass("N8/N10/N11: a swept hold forfeited by a reset is charged only its overrun; a twice-failed settle is parked and applied, never refunded; old closed holds are pruned");
  }

  /* ---------- N5: a free grant blocked by the daily cap is retried ---------- */
  {
    process.env.FREE_GRANTS_PER_DAY = "0";
    const blocked = await users.createUser({ name: "Blocked", email: "blocked@shop.test", password: "password-123" });
    const stale = await users.createUser({ name: "Stale", email: "stale@shop.test", password: "password-123" });
    assert.equal(await balance(blocked.id), 0, "no grant while the cap is exhausted");
    assert.equal(await balance(stale.id), 0);
    await db.execute("update users set created_at = $1 where id = $2", [new Date(Date.now() - 8 * 86_400_000).toISOString(), stale.id]);
    delete process.env.FREE_GRANTS_PER_DAY;
    assert.equal(await balance(blocked.id), 50 * MILLI, "granted on a later visit once the cap allows");
    assert.equal(await balance(blocked.id), 50 * MILLI, "and only once");
    assert.equal(await balance(stale.id), 0, "not after the 7-day window");
    const twin = await users.createUser({ name: "Twin", email: "blocked+2@shop.test", password: "password-123" });
    assert.equal(await balance(twin.id), 0);
    assert.equal(await balance(twin.id), 0, "the retry still honours one grant per person");
    assert.equal(await balance(dev!.id), 0, "dev desks never get one");
    assert.equal((await ledger.recentLedger(blocked.id)).filter((e) => e.reason === "free_grant").length, 1);
    pass("N5: a free grant blocked by FREE_GRANTS_PER_DAY is retried for 7 days, once per person, never for desks");
  }

  /* ---------- C3 / C8 / C9: webhook ordering ---------- */
  {
    const u = await users.createUser({ name: "Late", email: "late@shop.test", password: "password-123" });
    const subObj = (id: string, status: string) => ({
      id,
      object: "subscription",
      customer: "cus_late",
      status,
      cancel_at_period_end: false,
      cancel_at: null,
      metadata: { aisle_user_id: u.id },
      items: { data: [{ current_period_start: 1_790_000_000, current_period_end: 1_792_600_000 }] },
    });
    await deliver(event("invoice.paid", invoice("in_late_1", { user: u.id, customer: "cus_late", sub: "sub_late", reason: "subscription_create", end: 1_792_600_000 })));
    assert.equal(await balance(u.id), 1000 * MILLI);
    // Dunning ends: deletion is processed before the renewal's retried invoice.paid and the final payment_failed.
    await deliver(event("customer.subscription.deleted", subObj("sub_late", "canceled")));
    assert.equal(await balance(u.id), 0);
    const late = await deliver(event("invoice.paid", invoice("in_late_2", { user: u.id, customer: "cus_late", sub: "sub_late", reason: "subscription_cycle", end: 1_795_200_000 })));
    assert.equal(late.json.handled, false);
    assert.equal(await balance(u.id), 0, "a late invoice after deletion grants nothing");
    assert.equal((await link(u.id)).status, "canceled", "and does not revive the subscription");
    await deliver(event("invoice.payment_failed", invoice("in_late_3", { user: u.id, customer: "cus_late", sub: "sub_late", reason: "subscription_cycle" })));
    assert.equal((await link(u.id)).status, "canceled", "payment_failed after deletion stays canceled");
    assert.equal(summary.subscriptionIsLive(await summary.subscriptionFor(u.id)), false);
    assert.equal((await summary.checkoutOrPortal(u, "https://aisle.test")).portal, false, "so the user can subscribe again");

    // Coming back: checkout for a new subscription replaces the dead one's status straight away.
    await deliver(event("checkout.session.completed", { id: "cs_late2", mode: "subscription", status: "complete", payment_status: "paid", client_reference_id: u.id, customer: "cus_late", subscription: "sub_late2" }));
    assert.equal((await link(u.id)).status, "active");
    assert.equal((await link(u.id)).stripe_subscription_id, "sub_late2");
    await deliver(event("invoice.paid", invoice("in_late2_1", { user: u.id, customer: "cus_late", sub: "sub_late2", reason: "subscription_create", end: 1_797_800_000 })));
    assert.equal(await balance(u.id), 1000 * MILLI);
    // customer.subscription.created (incomplete) arriving after the sub is active is not handled at all,
    // and an 'updated' snapshot from checkout time cannot step it back either.
    const created = await deliver(event("customer.subscription.created", { ...subObj("sub_late2", "incomplete") }));
    assert.equal(created.json.handled, false);
    await deliver(event("customer.subscription.updated", { ...subObj("sub_late2", "incomplete") }));
    assert.equal((await link(u.id)).status, "active", "incomplete after active is ignored");
    // A checkout whose first payment is still in flight counts as live: no second checkout.
    const pending = await users.createUser({ name: "Pending", email: "pending@shop.test", password: "password-123" });
    await deliver(event("checkout.session.completed", { id: "cs_pending", mode: "subscription", status: "complete", payment_status: "unpaid", client_reference_id: pending.id, customer: "cus_pending", subscription: "sub_pending" }));
    assert.equal((await link(pending.id)).status, "incomplete");
    seen.length = 0;
    assert.equal((await summary.checkoutOrPortal(pending, "https://aisle.test")).portal, true);
    assert.equal(seen.filter((r) => r.path === "/v1/checkout/sessions").length, 0);
    pass("C3/C8/C9: late invoice.paid and payment_failed never revive a canceled sub or re-grant; incomplete never overwrites active; incomplete is live for checkout");
  }

  /* ---------- N2 / N4 / N7 / N9: more webhook ordering ---------- */
  {
    const at = (type: string, object: Record<string, unknown>, created: number) => ({ ...event(type, object), created });
    const subOf = (userId: string, customer: string) => (id: string, status: string, extra: Record<string, unknown> = {}) => ({
      id,
      object: "subscription",
      customer,
      status,
      cancel_at_period_end: false,
      cancel_at: null,
      metadata: { aisle_user_id: userId },
      items: { data: [{ current_period_start: 1_790_000_000, current_period_end: 1_792_600_000 }] },
      ...extra,
    });
    const checkoutOf = (userId: string, customer: string) => (sub: string, paid = "paid") => ({
      id: `cs_${sub}`,
      mode: "subscription",
      status: "complete",
      payment_status: paid,
      client_reference_id: userId,
      customer,
      subscription: sub,
    });
    const T = 1_800_000_000;

    // N2: sub_g1 ends, the user resubscribes with sub_g2, then late snapshots of sub_g1 arrive.
    const g = await users.createUser({ name: "Gee", email: "gee@shop.test", password: "password-123" });
    const gSub = subOf(g.id, "cus_g");
    const gCheckout = checkoutOf(g.id, "cus_g");
    await deliver(at("checkout.session.completed", gCheckout("sub_g1"), T));
    await deliver(at("invoice.paid", invoice("in_g1", { user: g.id, customer: "cus_g", sub: "sub_g1", reason: "subscription_create", end: T + 2_592_000 }), T + 1));
    await deliver(at("customer.subscription.deleted", gSub("sub_g1", "canceled"), T + 100));
    await deliver(at("checkout.session.completed", gCheckout("sub_g2"), T + 200));
    await deliver(at("invoice.paid", invoice("in_g2", { user: g.id, customer: "cus_g", sub: "sub_g2", reason: "subscription_create", end: T + 2_592_200 }), T + 201));
    assert.equal((await link(g.id)).stripe_subscription_id, "sub_g2");
    const lateUpdate = await deliver(at("customer.subscription.updated", gSub("sub_g1", "active", { cancel_at_period_end: true }), T + 50));
    assert.equal(lateUpdate.json.handled, false);
    const lateCheckout = await deliver(at("checkout.session.completed", gCheckout("sub_g1"), T + 300));
    assert.equal(lateCheckout.json.handled, false);
    assert.deepEqual([(await link(g.id)).stripe_subscription_id, (await link(g.id)).status], ["sub_g2", "active"], "an ended subscription never takes the link back");
    // A checkout for a different subscription while sub_g2 is live does not replace it either.
    await deliver(at("checkout.session.completed", gCheckout("sub_g3", "unpaid"), T + 400));
    assert.deepEqual([(await link(g.id)).stripe_subscription_id, (await link(g.id)).status], ["sub_g2", "active"]);
    // So sub_g2's renewal still grants, and its deletion still expires the credits.
    await ledger.adjustCredits(g.id, -400 * MILLI, "spend");
    const renew = await deliver(at("invoice.paid", invoice("in_g3", { user: g.id, customer: "cus_g", sub: "sub_g2", reason: "subscription_cycle", end: T + 5_184_200 }), T + 2_592_300));
    assert.equal(renew.json.handled, true);
    assert.equal(await balance(g.id), 1000 * MILLI);
    const end = await deliver(at("customer.subscription.deleted", gSub("sub_g2", "canceled"), T + 2_592_400));
    assert.equal(end.json.handled, true);
    assert.equal((await link(g.id)).status, "canceled");
    assert.equal(await balance(g.id), 0);

    // N4: an async first payment fails, then Stripe expires the subscription: the user can subscribe again.
    const a = await users.createUser({ name: "Async", email: "async@shop.test", password: "password-123" });
    await deliver(at("checkout.session.completed", checkoutOf(a.id, "cus_a")("sub_a", "unpaid"), T));
    const firstFail = await deliver(at("invoice.payment_failed", invoice("in_a1", { user: a.id, customer: "cus_a", sub: "sub_a", reason: "subscription_create" }), T + 10));
    assert.equal(firstFail.json.handled, false);
    assert.equal((await link(a.id)).status, "incomplete", "a failed first invoice is not past_due");
    await deliver(at("customer.subscription.updated", subOf(a.id, "cus_a")("sub_a", "incomplete_expired"), T + 86_400));
    assert.equal((await link(a.id)).status, "incomplete_expired", "incomplete_expired is final and always applies");
    assert.equal(summary.subscriptionIsLive(await summary.subscriptionFor(a.id)), false);
    assert.equal((await summary.checkoutOrPortal(a, "https://aisle.test")).portal, false, "a fresh checkout, not the portal");
    // A renewal's failure still means past_due.
    const r = await users.createUser({ name: "Renew", email: "renewfail@shop.test", password: "password-123" });
    await deliver(at("invoice.paid", invoice("in_r1", { user: r.id, customer: "cus_r", sub: "sub_r", reason: "subscription_create" }), T));
    await deliver(at("invoice.payment_failed", invoice("in_r2", { user: r.id, customer: "cus_r", sub: "sub_r", reason: "subscription_cycle" }), T + 10));
    assert.equal((await link(r.id)).status, "past_due");

    // N7: a stale past_due snapshot delivered after the renewal was paid is skipped (event.created).
    const f = await users.createUser({ name: "Eff", email: "eff@shop.test", password: "password-123" });
    const fSub = subOf(f.id, "cus_f");
    await deliver(at("invoice.paid", invoice("in_f1", { user: f.id, customer: "cus_f", sub: "sub_f", reason: "subscription_create", end: T + 2_592_000 }), T));
    await deliver(at("customer.subscription.updated", fSub("sub_f", "past_due"), T + 2_592_100));
    assert.equal((await link(f.id)).status, "past_due");
    await deliver(at("invoice.paid", invoice("in_f2", { user: f.id, customer: "cus_f", sub: "sub_f", reason: "subscription_cycle", end: T + 5_184_000 }), T + 2_592_500));
    assert.equal((await link(f.id)).status, "active");
    const stale = await deliver(at("customer.subscription.updated", fSub("sub_f", "past_due"), T + 2_592_200));
    assert.equal(stale.json.handled, false);
    assert.equal((await link(f.id)).status, "active", "an older snapshot does not undo a newer paid invoice");
    const staleFail = await deliver(at("invoice.payment_failed", invoice("in_f2", { user: f.id, customer: "cus_f", sub: "sub_f", reason: "subscription_cycle" }), T + 2_592_150));
    assert.equal(staleFail.json.handled, false);
    assert.equal((await link(f.id)).status, "active");
    const stamp = await db.query<{ subscription_event_at: number | string }>("select subscription_event_at from billing_customers where user_id = $1", [f.id]);
    assert.equal(Number(stamp[0].subscription_event_at), T + 2_592_500);
    await deliver(at("customer.subscription.updated", fSub("sub_f", "active", { cancel_at_period_end: true }), T + 2_600_000));
    assert.equal((await link(f.id)).status, "active");
    assert.equal((await summary.subscriptionFor(f.id))?.cancelPending, true, "a newer snapshot applies");
    // A deletion is final even if its event is older than the last snapshot.
    await deliver(at("customer.subscription.deleted", fSub("sub_f", "canceled"), T + 2_592_600));
    assert.equal((await link(f.id)).status, "canceled");

    // N9: a paid invoice for a second live subscription still grants; the stored one stays.
    const b = await users.createUser({ name: "Bee", email: "bee@shop.test", password: "password-123" });
    await deliver(at("checkout.session.completed", checkoutOf(b.id, "cus_b")("sub_b1"), T));
    await deliver(at("invoice.paid", invoice("in_b1", { user: b.id, customer: "cus_b", sub: "sub_b1", reason: "subscription_create" }), T + 1));
    await ledger.adjustCredits(b.id, -700 * MILLI, "spend");
    const second = await deliver(at("invoice.paid", invoice("in_b2", { user: b.id, customer: "cus_b", sub: "sub_b2", reason: "subscription_create" }), T + 100));
    assert.equal(second.json.handled, true);
    assert.equal(await balance(b.id), 1000 * MILLI, "the paid invoice granted");
    assert.equal((await link(b.id)).stripe_subscription_id, "sub_b1", "the stored subscription is unchanged");
    const replay = await deliver(at("invoice.paid", invoice("in_b2", { user: b.id, customer: "cus_b", sub: "sub_b2", reason: "subscription_create" }), T + 100));
    assert.equal(replay.json.note, "in_b2 already granted; sub_b1 stays current");
    pass("N2/N4/N7/N9: ended subs never retake the link; first-invoice failure leaves incomplete → incomplete_expired; older snapshots skipped by event.created; a second live sub's invoice still grants");
  }

  /* ---------- LOW: an older invoice replayed later does not re-grant ---------- */
  {
    const u = await users.createUser({ name: "Older", email: "older@shop.test", password: "password-123" });
    const E1 = 1_800_000_000;
    const E2 = E1 + 2_592_000;
    const first = event("invoice.paid", invoice("in_o1", { user: u.id, customer: "cus_older", sub: "sub_older", reason: "subscription_create", end: E1 }));
    await deliver(first);
    await ledger.adjustCredits(u.id, -600 * MILLI, "spend");
    await deliver(event("invoice.paid", invoice("in_o2", { user: u.id, customer: "cus_older", sub: "sub_older", reason: "subscription_cycle", end: E2 })));
    assert.equal(await balance(u.id), 1000 * MILLI);
    await ledger.adjustCredits(u.id, -900 * MILLI, "spend");
    // The first invoice again, under a new event id (a manual resend from the Dashboard).
    const replay = await deliver({ ...first, id: "evt_resend_o1" });
    assert.equal(replay.json.duplicate, false);
    assert.equal(await balance(u.id), 100 * MILLI, "an older invoice replay does not re-grant");
    assert.equal(await ledger.resetForInvoice(u.id, "in_o1"), false, "the ledger row is the once-per-invoice guard");
    // An older period's invoice that was never granted is not granted after a newer one either.
    await deliver(event("invoice.paid", invoice("in_o0", { user: u.id, customer: "cus_older", sub: "sub_older", reason: "subscription_cycle", end: E1 - 2_592_000 })));
    assert.equal(await balance(u.id), 100 * MILLI);
    // customer.deleted forgets the link, so the next Subscribe makes a new customer.
    const forgot = await deliver(event("customer.deleted", { id: "cus_older", object: "customer" }));
    assert.equal(forgot.json.handled, true);
    assert.equal(await link(u.id), undefined);
    pass("LOW: replayed or older invoices never re-grant (ledger row first); customer.deleted drops the link");
  }

  /* ---------- C10: stale customer ids (deleted, or from the other Stripe mode) ---------- */
  {
    const u = await users.createUser({ name: "Gone", email: "gone@shop.test", password: "password-123" });
    await summary.checkoutOrPortal(u, "https://aisle.test");
    const old = (await link(u.id)).stripe_customer_id;
    gone.add(old);
    seen.length = 0;
    const next = await summary.checkoutOrPortal(u, "https://aisle.test");
    assert.equal(next.portal, false);
    assert.match(next.url, /^https:\/\/checkout\.stripe\.test\//);
    const fresh = (await link(u.id)).stripe_customer_id;
    assert.notEqual(fresh, old, "a new customer replaced the missing one");
    const created = seen.filter((r) => r.path === "/v1/customers");
    assert.equal(created.length, 1);
    assert.match(String(created[0].headers["idempotency-key"]), new RegExp(`^customer-${u.id}-test-`), "a fresh key, so Stripe cannot replay the deleted customer");
    // Portal: a live subscription whose customer is gone falls through to a new checkout.
    await db.execute("update billing_customers set status = 'active', stripe_subscription_id = 'sub_gone' where user_id = $1", [u.id]);
    gone.add(fresh);
    assert.equal(await stripe.openPortal(u.id, "https://aisle.test"), null);
    assert.equal(await link(u.id), undefined, "the stale link is dropped");
    await db.execute("insert into billing_customers (user_id, stripe_customer_id, status, updated_at) values ($1, $2, 'active', $3)", [u.id, fresh, new Date().toISOString()]);
    const viaPortal = await summary.checkoutOrPortal(u, "https://aisle.test");
    assert.equal(viaPortal.portal, false);
    assert.notEqual((await link(u.id)).stripe_customer_id, fresh);

    // Sandbox testing, then a live key: a row from the other mode is ignored and replaced.
    const sw = await users.createUser({ name: "Switch", email: "switch@shop.test", password: "password-123" });
    await db.execute("insert into billing_customers (user_id, stripe_customer_id, status, stripe_livemode, updated_at) values ($1, 'cus_livemode', 'active', 1, $2)", [sw.id, new Date().toISOString()]);
    assert.equal(await stripe.customerIdFor(sw.id), null);
    assert.equal(await summary.subscriptionFor(sw.id), null, "a live-mode subscription is not live for a test key");
    const swNext = await summary.checkoutOrPortal(sw, "https://aisle.test");
    assert.equal(swNext.portal, false);
    const swRow = (await db.query<{ stripe_customer_id: string; stripe_livemode: number }>("select stripe_customer_id, stripe_livemode from billing_customers where user_id = $1", [sw.id]))[0];
    assert.notEqual(swRow.stripe_customer_id, "cus_livemode");
    assert.equal(Number(swRow.stripe_livemode), 0);
    pass("C10: resource_missing customers are forgotten and recreated (checkout and portal); rows from the other Stripe mode are ignored");
  }

  /* ---------- C6 / C13: the free grant cannot be farmed ---------- */
  {
    const { canonicalEmail } = ledger;
    assert.equal(canonicalEmail(" Far.Mer+ads@GoogleMail.com "), "farmer@gmail.com");
    assert.equal(canonicalEmail("bob+1@shop.test"), "bob@shop.test");
    assert.equal(canonicalEmail("b.ob@shop.test"), "b.ob@shop.test", "dots only collapse on Gmail");
    const grantOf = async (email: string) => {
      const u = await users.createUser({ name: "Farm", email, password: "password-123" });
      return balance(u.id);
    };
    assert.equal(await grantOf("farmer@gmail.com"), 50 * MILLI);
    assert.equal(await grantOf("far.mer+2@googlemail.com"), 0, "gmail dots and +tags are one person");
    assert.equal(await grantOf("farmer+3@gmail.com"), 0);
    assert.equal(await grantOf("bob@shop.test"), 50 * MILLI);
    assert.equal(await grantOf("bob+1@shop.test"), 0, "+tag farming blocked");
    assert.equal(await grantOf("b.ob@shop.test"), 50 * MILLI);
    // Team desks get none (a hosted desk off the unlimited list starts at 0).
    assert.equal(await balance(dev!.id), 0);
    // FREE_CREDITS overrides the amount; the Billing page shows it.
    process.env.FREE_CREDITS = "10";
    const ten = await users.createUser({ name: "Ten", email: "ten@shop.test", password: "password-123" });
    assert.equal(await balance(ten.id), 10 * MILLI);
    assert.equal((await summary.billingSummary(ten)).plan.freeCredits, 10);
    delete process.env.FREE_CREDITS;
    // The daily cap across the install.
    const today = new Date().toISOString().slice(0, 10);
    const granted = Number((await db.query<{ n: number }>("select count(*) as n from free_grants where granted_at >= $1", [`${today}T00:00:00.000Z`]))[0].n);
    process.env.FREE_GRANTS_PER_DAY = String(granted);
    assert.equal(await grantOf("capped@shop.test"), 0, "no grant once today's cap is reached");
    process.env.FREE_GRANTS_PER_DAY = String(granted + 1);
    assert.equal(await grantOf("uncapped@shop.test"), 50 * MILLI);
    delete process.env.FREE_GRANTS_PER_DAY;

    // Signup is limited per address: the sixth account in an hour gets 429. On Vercel the edge
    // sets x-forwarded-for itself, so it is the client's address there.
    const signup = (email: string, ip: string, header = "x-forwarded-for") =>
      signupRoute.POST(
        new Request("http://localhost/api/auth/signup", {
          method: "POST",
          headers: { "content-type": "application/json", [header]: `${ip}, 10.0.0.1` },
          body: JSON.stringify({ name: "Script", email, password: "password-123" }),
        }),
      );
    const env = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    const savedVercel = process.env.VERCEL;
    const savedIpHeader = process.env.AISLE_CLIENT_IP_HEADER;
    delete process.env.AISLE_CLIENT_IP_HEADER;
    process.env.VERCEL = "1";
    try {
      for (let i = 0; i < 5; i++) assert.equal((await signup(`script${i}@farm.test`, "203.0.113.9")).status, 200);
      const sixth = await signup("script5@farm.test", "203.0.113.9");
      assert.equal(sixth.status, 429);
      assert.equal(sixth.headers.get("retry-after"), "3600");
      assert.equal(await users.findUserByEmail("script5@farm.test"), null, "no account was made");
      assert.equal((await signup("script6@farm.test", "198.51.100.7")).status, 200, "another address is unaffected");
      const stored = await db.query<{ ip_key: string }>("select ip_key from signup_attempts");
      assert.ok(stored.every((r) => !r.ip_key.includes("203.0.113.9")), "only a hash of the address is kept");

      // N3: the attempt is recorded before it is counted, so a parallel burst cannot slip past the limit.
      const burst = await Promise.all(Array.from({ length: 20 }, (_, i) => signup(`burst${i}@farm.test`, "192.0.2.44")));
      const made = burst.filter((r) => r.status === 200).length;
      assert.ok(made <= 5, `a burst of 20 opened ${made} accounts (limit 5)`);
      assert.equal(burst.filter((r) => r.status === 429).length, 20 - made);
      const burstUsers = await db.query<{ n: number }>("select count(*) as n from users where email like 'burst%@farm.test'");
      assert.equal(Number(burstUsers[0].n), made);
      // A signup that fails after claiming (a duplicate email) gives its slot back.
      for (let i = 0; i < 4; i++) assert.equal((await signup(`dup${i}@farm.test`, "192.0.2.77")).status, 200);
      assert.equal((await signup("dup0@farm.test", "192.0.2.77")).status, 409);
      assert.equal((await signup("dup4@farm.test", "192.0.2.77")).status, 200, "the duplicate did not use up the fifth slot");
      assert.equal((await signup("dup5@farm.test", "192.0.2.77")).status, 429);

      // Off Vercel a client can send any x-forwarded-for, so rotating it does not reset the limit.
      delete process.env.VERCEL;
      for (let i = 0; i < 5; i++) assert.equal((await signup(`rot${i}@farm.test`, `198.18.0.${i}`)).status, 200);
      assert.equal((await signup("rot5@farm.test", "198.18.0.5")).status, 429, "one bucket when no proxy header is trusted");
      // A non-Vercel host names the header its own proxy sets.
      process.env.AISLE_CLIENT_IP_HEADER = "X-Real-IP";
      assert.equal((await signup("proxied@farm.test", "198.18.1.1", "x-real-ip")).status, 200);
      assert.equal((await signup("proxied2@farm.test", "198.18.1.2", "x-forwarded-for")).status, 429, "x-forwarded-for is still not trusted");
    } finally {
      env("VERCEL", savedVercel);
      env("AISLE_CLIENT_IP_HEADER", savedIpHeader);
    }
    pass("C6/C13/N3: one free grant per canonical email, FREE_CREDITS and FREE_GRANTS_PER_DAY honoured, dev desks get none, signup 429 after 5/hour per IP, race-free under a burst, x-forwarded-for trusted only on Vercel");
  }

  /* ---------- N6: `npm run start` locally is not a hosted install ---------- */
  {
    const penv = process.env as Record<string, string | undefined>;
    const saved = { NODE_ENV: penv.NODE_ENV, AISLE_HOSTED: penv.AISLE_HOSTED, VERCEL: penv.VERCEL };
    penv.NODE_ENV = "production";
    delete penv.AISLE_HOSTED;
    delete penv.VERCEL;
    try {
      assert.equal(meter.isHosted(), false, "NODE_ENV=production alone is a local production build");
      assert.equal(meter.isUnlimited(meter.billingFor(dev!)), true, "desks stay unlimited");
      assert.equal(seeds.seedPassword(), seeds.DEMO_SEED_PASSWORD);
      oauthUsers.resetSeedCheck();
      await users.ensureSeedAccounts();
      const alex = await users.findUserByEmail("alex@aisle.website");
      assert.equal(await verifyPassword(seeds.DEMO_SEED_PASSWORD, alex!.passwordHash), true, "the desks are not locked");
      assert.equal((await db.query("select 1 from kv where key = 'system/demo-desks-locked'")).length, 0);
      penv.AISLE_HOSTED = "1";
      assert.equal(meter.isHosted(), true, "AISLE_HOSTED=1 marks a non-Vercel host");
      assert.equal(meter.isUnlimited(meter.billingFor(dev!)), false);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete penv[key];
        else penv[key] = value;
      }
      oauthUsers.resetSeedCheck();
    }
    pass("N6: hosted means VERCEL=1 or AISLE_HOSTED=1; NODE_ENV=production locally keeps the desks and their password");
  }

  /* ---------- C1 / C11: hosted installs ---------- */
  {
    const saved = { VERCEL: process.env.VERCEL, seed: process.env.AISLE_SEED_PASSWORD, list: process.env.AISLE_UNLIMITED_USERS };
    process.env.VERCEL = "1";
    delete process.env.AISLE_SEED_PASSWORD;
    delete process.env.AISLE_UNLIMITED_USERS;
    try {
      // A dev desk is not unlimited on a hosted install unless listed.
      const desk = meter.billingFor(dev!);
      assert.equal(meter.isUnlimited(desk), false);
      assert.equal((await summary.billingSummary(dev!)).unlimited, false);
      assert.equal(await meter.holdCredits(desk, usd(5)), null, "it pays like anyone, and has no credits");
      process.env.AISLE_UNLIMITED_USERS = "someone@else.test, ALEX@aisle.website";
      assert.equal(meter.isUnlimited(desk), true);
      assert.equal((await summary.billingSummary(dev!)).unlimited, true);
      assert.equal((await meter.holdCredits(desk, usd(5)))?.charged, false);
      delete process.env.AISLE_UNLIMITED_USERS;

      // PR #2 seedPassword() still reports no default on a hosted install.
      // Cindy's users.ts always seeds with SEED_PASSWORD and never locks desks.
      assert.equal(seeds.seedPassword(), null);
      const alex = await users.findUserByEmail("alex@aisle.website");
      assert.equal(
        await verifyPassword(seeds.DEMO_SEED_PASSWORD, alex!.passwordHash),
        true,
        "Cindy's desks stay on the published password — locking is not in her users.ts",
      );
      assert.equal((await db.query("select 1 from kv where key = 'system/demo-desks-locked'")).length, 0);
      // Login lookups still work when kv is down (Cindy's findUserByEmail does not read the lock row).
      const realQuery = db.query;
      db.query = (async (text: string, params?: unknown[]) => {
        if (/from kv where key/.test(text)) throw new Error("kv unavailable");
        return realQuery(text, params);
      }) as typeof db.query;
      try {
        assert.equal((await users.findUserByEmail("alex@aisle.website"))?.id, alex!.id, "login lookups survive a kv failure");
      } finally {
        db.query = realQuery;
      }
    } finally {
      for (const [key, value] of [["VERCEL", saved.VERCEL], ["AISLE_SEED_PASSWORD", saved.seed], ["AISLE_UNLIMITED_USERS", saved.list]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      oauthUsers.resetSeedCheck();
    }
    assert.equal(seeds.seedPassword(), seeds.DEMO_SEED_PASSWORD, "locally the demo password still applies");
    pass("C1: hosted — desks bill unless in AISLE_UNLIMITED_USERS; Cindy does not lock demo desks; seedPassword() is still null on hosted");
  }

  {
    const db = await getDatabase();
    const at = new Date().toISOString();
    const refunded = await users.createUser({ email: "refund@example.test", name: "Refund", password: "password-123" });
    await db.execute("insert into billing_customers (user_id, stripe_customer_id, updated_at) values ($1, $2, $3)", [refunded.id, "cus_refund", at]);
    await ledger.resetForInvoice(refunded.id, "in_refund_1");
    assert.equal(await ledger.balanceMilli(refunded.id), 1000 * MILLI);
    const charge = (id: string, extra: Record<string, unknown>) => ({ id, customer: "cus_refund", amount: 1000, ...extra });
    let res = await deliver({ id: "evt_refund_partial", type: "charge.refunded", data: { object: charge("ch_r1", { refunded: false, amount_refunded: 500 }) } });
    assert.equal(res.status, 200);
    assert.equal(await ledger.balanceMilli(refunded.id), 1000 * MILLI, "a partial refund changes nothing");
    res = await deliver({ id: "evt_refund_full", type: "charge.refunded", data: { object: charge("ch_r1", { refunded: true, amount_refunded: 1000 }) } });
    assert.equal(res.status, 200);
    assert.equal(await ledger.balanceMilli(refunded.id), 0, "a full refund takes the credits back");
    await ledger.resetForInvoice(refunded.id, "in_refund_2");
    res = await deliver({ id: "evt_refund_replay", type: "charge.refunded", data: { object: charge("ch_r1", { refunded: true, amount_refunded: 1000 }) } });
    assert.equal(await ledger.balanceMilli(refunded.id), 1000 * MILLI, "the same refund never expires a later month");
    charges.set("ch_d1", { id: "ch_d1", customer: "cus_refund" });
    res = await deliver({ id: "evt_dispute", type: "charge.dispute.created", data: { object: { id: "dp_1", charge: "ch_d1", amount: 1000 } } });
    assert.equal(res.status, 200);
    assert.equal(await ledger.balanceMilli(refunded.id), 0, "a dispute takes the credits back");
    charges.set("ch_other", { id: "ch_other", customer: "cus_nobody" });
    res = await deliver({ id: "evt_dispute_other", type: "charge.dispute.created", data: { object: { id: "dp_2", charge: "ch_other" } } });
    assert.equal(res.status, 200, "a dispute on a payment Aisle did not take is acknowledged");
    pass("refunds and disputes: a full refund or a dispute takes the credits back once per charge; partial refunds and unknown customers change nothing");
  }

  {
    const session = await import("../src/lib/auth/session");
    // The owner's design: a verified Google/Apple email joins the password account and keeps its password.
    const member = await users.createUser({ email: "member@example.test", name: "Member", password: "member-pass-1" });
    const before = (await users.findUserById(member.id))!;
    const cookie = await session.signSession({ ...users.publicUser(before), sessionVersion: before.sessionVersion });
    const linked = await oauthUsers.signInWithProvider({ provider: "google", sub: "g-member", email: "member@example.test", emailVerified: true, name: "Member" });
    const after = (await users.findUserById(member.id))!;
    const afterExtras = await oauthUsers.userExtras(member.id);
    assert.equal(linked.id, member.id);
    assert.equal(afterExtras.passwordLogin, true, "linking keeps the password");
    assert.equal(linked.sessionVersion ?? 0, after.sessionVersion ?? afterExtras.sessionVersion, "the new session carries the account's version");
    assert.equal((await session.readSession(cookie))!.sessionVersion ?? 0, afterExtras.sessionVersion, "linking does not end older sessions");
    await assert.rejects(
      oauthUsers.signInWithProvider({ provider: "google", sub: "g-desk", email: "alex@aisle.website", emailVerified: true, name: "Not Alex" }),
      /Team desks sign in with their password/,
    );
    const pw = await users.createUser({ email: "rotate@example.test", name: "Rotate", password: "first-pass-123" });
    const v0 = (await oauthUsers.userExtras(pw.id)).sessionVersion;
    assert.equal(await users.setPassword("rotate@example.test", "second-pass-456"), true);
    assert.equal(
      (await oauthUsers.userExtras(pw.id)).sessionVersion,
      v0,
      "Cindy's setPassword does not bump session_version",
    );
    pass("sign-in linking: Google/Apple joins a password account and keeps its password, never links a team desk");
  }

  {
    const loginRoute = await import("../src/app/api/auth/login/route");
    const penv = process.env as Record<string, string | undefined>;
    const saved = { VERCEL: penv.VERCEL, AISLE_HOSTED: penv.AISLE_HOSTED, NODE_ENV: penv.NODE_ENV, DATABASE_URL: penv.DATABASE_URL, AISLE_SEED_PASSWORD: penv.AISLE_SEED_PASSWORD };
    try {
      delete penv.AISLE_SEED_PASSWORD;
      assert.equal(await users.setPassword("sam@aisle.website", seeds.DEMO_SEED_PASSWORD), true);
      const login = () =>
        loginRoute.POST(new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "sam@aisle.website", password: seeds.DEMO_SEED_PASSWORD }),
        }));
      assert.equal((await login()).status, 200, "locally the demo password opens a desk");
      penv.VERCEL = "1";
      oauthUsers.resetSeedCheck();
      // Pretend the lock check already ran, so only the login backstop stands in the way.
      const db = await getDatabase();
      await db.execute("insert into kv (key, value, updated_at) values ('system/demo-desks-locked', 'true', $1) on conflict (key) do nothing", [new Date().toISOString()]);
      assert.equal((await login()).status, 401, "hosted, the published password never opens a desk");
      delete penv.VERCEL;
      penv.NODE_ENV = "production";
      assert.equal(meter.isHosted(), false, "a production build on local SQLite is a private install");
      penv.DATABASE_URL = "postgres://user:pass@db.example.test/aisle";
      assert.equal(meter.isHosted(), true, "a production build on Postgres is hosted even without AISLE_HOSTED");
      penv.AISLE_HOSTED = "0";
      assert.equal(meter.isHosted(), false, "AISLE_HOSTED=0 forces a private install");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete penv[key];
        else penv[key] = value;
      }
      oauthUsers.resetSeedCheck();
    }
    pass("hosted backstops: the demo password is refused at login on a hosted install; production on Postgres counts as hosted; AISLE_HOSTED=0 overrides");
  }

  await closeDatabase();
  console.log(`\n${checks} billing checks passed.`);
} finally {
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
