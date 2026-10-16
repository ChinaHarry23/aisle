/**
 * One-time Stripe setup, run by the owner.
 *
 *   npm run stripe:setup                         # explains, changes nothing
 *   npm run stripe:setup -- --create             # sandbox (sk_test_ / rk_test_) key
 *   npm run stripe:setup -- --create --webhook-url https://www.aisle.website/api/stripe/webhook
 *   npm run stripe:setup -- --create --live      # required for a live key
 *
 * Creates, or finds from an earlier run:
 *   - the "Aisle Credits" product and its USD $10/month price (lookup key aisle_monthly_1000)
 *   - a Customer Portal configuration: cancel at period end, update card, invoice
 *     history, no plan switching
 *   - optionally a webhook endpoint pinned to the same API version (an endpoint
 *     already registered for the same URL is reused, never duplicated)
 * and prints the ids to put in the environment. STRIPE_SECRET_KEY is read from
 * the environment (.env.local) and never printed.
 */

import "./service-loader.mjs";

const { PRICE_LOOKUP_KEY, stripeEnv, stripeRequest } = await import("../src/lib/billing/stripe");
const { PLAN } = await import("../src/lib/billing/plan");

const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.deleted",
  "charge.refunded",
  "charge.dispute.created",
];

type List<T> = { data: T[] };
type Price = { id: string; product: string | { id: string }; unit_amount: number; currency: string; active: boolean };
type PortalConfig = { id: string; active: boolean; metadata?: Record<string, string> };
type WebhookEndpoint = { id: string; url: string; status?: string; enabled_events?: string[]; secret?: string };

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function findPrice(): Promise<Price | null> {
  const list = await stripeRequest<List<Price>>("GET", "/v1/prices", {
    lookup_keys: [PRICE_LOOKUP_KEY],
    active: true,
    limit: 1,
  });
  return list.data[0] ?? null;
}

/** Fixed idempotency keys: a re-run within Stripe's 24 h window gets the same product and price back. */
async function createPrice(): Promise<Price> {
  const product = await stripeRequest<{ id: string }>(
    "POST",
    "/v1/products",
    {
      name: `${PLAN.name} (${PLAN.monthlyCredits.toLocaleString("en-US")} / month)`,
      description: `${PLAN.monthlyCredits.toLocaleString("en-US")} Aisle credits every month for cloud agents, posters and ad videos. Resets on each payment.`,
      metadata: { aisle: "credits", credits: PLAN.monthlyCredits },
    },
    { idempotencyKey: "aisle-product-v1" },
  );
  return stripeRequest<Price>(
    "POST",
    "/v1/prices",
    {
      product: product.id,
      currency: "usd",
      unit_amount: PLAN.priceUsd * 100,
      recurring: { interval: "month" },
      lookup_key: PRICE_LOOKUP_KEY,
      nickname: "Aisle monthly",
      metadata: { credits: PLAN.monthlyCredits },
    },
    { idempotencyKey: "aisle-price-v1" },
  );
}

async function findWebhookEndpoint(url: string): Promise<WebhookEndpoint | null> {
  const list = await stripeRequest<List<WebhookEndpoint>>("GET", "/v1/webhook_endpoints", { limit: 100 });
  return list.data.find((e) => e.url === url) ?? null;
}

async function findPortalConfig(): Promise<PortalConfig | null> {
  const list = await stripeRequest<List<PortalConfig>>("GET", "/v1/billing_portal/configurations", {
    active: true,
    limit: 100,
  });
  return list.data.find((c) => c.metadata?.aisle === "portal") ?? null;
}

async function createPortalConfig(productId: string, priceId: string): Promise<PortalConfig> {
  return stripeRequest<PortalConfig>("POST", "/v1/billing_portal/configurations", {
    name: "Aisle credits",
    business_profile: { headline: "Manage your Aisle credits subscription" },
    features: {
      subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ["email", "address"] },
      // One plan, so nothing to switch to.
      subscription_update: { enabled: false },
    },
    metadata: { aisle: "portal", product: productId, price: priceId },
  });
}

async function main() {
  const env = stripeEnv();
  if (!env.secretKey) {
    console.error("STRIPE_SECRET_KEY is not set. Put your sandbox key (sk_test_… or rk_test_…) in .env.local first.");
    process.exitCode = 1;
    return;
  }
  const live = /^(sk|rk)_live_/.test(env.secretKey);
  const mode = live ? "LIVE" : /^(sk|rk)_test_/.test(env.secretKey) ? "sandbox" : "unknown-mode";
  console.log(`Stripe ${mode} key found (not shown). API version ${env.apiVersion}.`);

  if (!flag("--create")) {
    console.log(`
This script creates the ${PLAN.name} product and a USD $${PLAN.priceUsd}/month price,
a Customer Portal configuration, and (with --webhook-url) a webhook endpoint.
Nothing was changed. Re-run with --create to do it.`);
    return;
  }
  if (live && !flag("--live")) {
    console.error("That is a LIVE key. Re-run with --create --live if you really mean to set up live mode.");
    process.exitCode = 1;
    return;
  }

  let price = await findPrice();
  if (price) {
    console.log(`Price ${PRICE_LOOKUP_KEY} already exists; reusing it.`);
  } else {
    price = await createPrice();
    console.log(`Created the product and price.`);
  }
  if (price.currency !== "usd" || price.unit_amount !== PLAN.priceUsd * 100) {
    console.warn(`Warning: ${price.id} is ${price.unit_amount} ${price.currency}, not ${PLAN.priceUsd * 100} usd.`);
  }
  const productId = typeof price.product === "string" ? price.product : price.product.id;

  let portal = await findPortalConfig();
  if (portal) {
    console.log("Customer Portal configuration already exists; reusing it.");
  } else {
    portal = await createPortalConfig(productId, price.id);
    console.log("Created the Customer Portal configuration.");
  }

  let webhookSecret: string | null = null;
  const webhookUrl = option("--webhook-url");
  if (webhookUrl) {
    if (!/^https:\/\//.test(webhookUrl)) {
      console.error("--webhook-url must be https. For local testing use `stripe listen` instead.");
      process.exitCode = 1;
      return;
    }
    const existing = await findWebhookEndpoint(webhookUrl);
    if (existing) {
      // A second endpoint for the same URL would deliver every event twice, one copy with a secret Aisle rejects.
      await stripeRequest<WebhookEndpoint>("POST", `/v1/webhook_endpoints/${existing.id}`, {
        enabled_events: WEBHOOK_EVENTS,
        disabled: false,
      });
      console.log(`Webhook endpoint ${existing.id} → ${webhookUrl} already exists; updated its events.
# Stripe shows a signing secret only when the endpoint is created. If you lost it,
# roll it in the Dashboard (Developers → Webhooks → ${existing.id} → Roll secret) rather than adding an endpoint.`);
    } else {
      const endpoint = await stripeRequest<WebhookEndpoint>("POST", "/v1/webhook_endpoints", {
        url: webhookUrl,
        enabled_events: WEBHOOK_EVENTS,
        api_version: env.apiVersion,
        description: "Aisle credits",
      });
      webhookSecret = endpoint.secret ?? null;
      console.log(`Created webhook endpoint ${endpoint.id} → ${webhookUrl}`);
    }
  }

  console.log(`
Add these to .env.local (and the deployment's environment):

STRIPE_PRICE_ID=${price.id}
STRIPE_PORTAL_CONFIGURATION=${portal.id}
STRIPE_API_VERSION=${env.apiVersion}`);
  if (webhookSecret) {
    console.log(`STRIPE_WEBHOOK_SECRET=${webhookSecret}
# Stripe shows this signing secret only once. Store it now.`);
  } else if (!webhookUrl) {
    console.log(`# STRIPE_WEBHOOK_SECRET: from \`stripe listen --forward-to localhost:3000/api/stripe/webhook\`
# locally, or re-run with --webhook-url https://…/api/stripe/webhook for a deployed site.`);
  }
  console.log(`\nWebhook events: ${WEBHOOK_EVENTS.join(", ")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
