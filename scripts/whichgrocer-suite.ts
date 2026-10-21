/**
 * Shelf-price shaping and the disconnected WhichGrocer path.
 *
 * No network. Catalogue calls are exercised with a fake fetch and WHICHGROCER_API_KEY.
 *
 *   npm run test:whichgrocer
 */

import assert from "node:assert/strict";
import { recommendClearance } from "../src/lib/retail/whichgrocer/clearance";
import {
  comparisonOffers,
  describeShelf,
  offersFromPayload,
  shelfQuery,
  type ShelfOffer,
} from "../src/lib/retail/whichgrocer/query";
import { lookupShelfPrices } from "../src/lib/retail/whichgrocer/connection";
import { equivalentArguments, searchArguments } from "../src/lib/retail/whichgrocer/mcp";
import { runEngine } from "../src/lib/runtime/engine";
import { shelfPriceTool } from "../src/lib/runtime/tools";
import { blankCampaign, defaultBrand } from "../src/lib/seed";
import { defaultSettings } from "../src/lib/settings";
import type { CompleteResult } from "../src/lib/llm/types";
import type { BrandProfile, Campaign } from "../src/lib/types";

let checks = 0;
const pass = (label: string) => {
  checks += 1;
  console.log(`PASS ${label}`);
};

assert.equal(shelfQuery("I want to sell apple juice", "Grocery"), "apple juice");
assert.equal(shelfQuery("Apple juice 2L", "Grocery"), "Apple juice 2L");
assert.equal(shelfQuery("", "Grocery"), "Grocery");
pass("a founder sentence becomes a catalogue query");

const payload = {
  content: [
    {
      type: "text",
      text: JSON.stringify({
        data: [
          {
            id: "bunnings_1",
            name: "Apple juice 2L",
            store: "bunnings",
            price: 9.5,
            currency: "AUD",
            url: "https://www.bunnings.com.au/apple-juice",
          },
          {
            id: "coles_9",
            name: "Just Juice Apple Juice 2L",
            store: "coles",
            price: 3.5,
            currency: "AUD",
            cup_price: "$0.18/100ml",
            url: "https://www.coles.com.au/product/apple-juice",
            is_special: true,
            price_stats: { discount_pct: 12, is_below_average: true },
            last_seen_at: "2026-10-16T01:00:00.000Z",
          },
          {
            id: "woolworths_8",
            name: "Just Juice Apple Juice 2L",
            store: "woolworths",
            price: 3.2,
            currency: "AUD",
            url: "https://www.woolworths.com.au/shop/productdetails/8",
            last_seen_at: "2026-10-16T01:00:00.000Z",
          },
          {
            id: "woolworths_9",
            name: "Apple juice drink 250ml",
            store: "woolworths",
            price: 2.4,
            out_of_stock: true,
          },
          {
            id: "aldi_3",
            name: "Apple juice 2L",
            store: "aldi",
            price: 2.49,
            currency: "AUD",
          },
        ],
      }),
    },
  ],
};

const offers = offersFromPayload(payload);
assert.equal(offers.length, 5);
const compared = comparisonOffers(offers, "apple juice");
assert.deepEqual(
  compared.map((offer) => offer.store),
  ["aldi", "woolworths", "coles"],
);
assert.equal(compared.find((offer) => offer.store === "woolworths")?.id, "woolworths_8");
const described = describeShelf("apple juice", compared, "2026-10-17T00:00:00.000Z");
assert.match(described.claim, /ALDI \$2\.49/);
assert.match(described.claim, /Woolworths \$3\.20/);
assert.match(described.claim, /Coles \$3\.50/);
assert.match(described.detail, /on special/);
assert.equal(described.observedAt, null, "mixed/missing dates cannot be presented as one common observation date");
assert.equal(described.sourceRef, "https://www.woolworths.com.au/shop/productdetails/8");
pass("catalogue rows become one grocery price per retailer, cheapest first");

assert.deepEqual(searchArguments(undefined, "apple juice"), { q: "apple juice" });
assert.deepEqual(
  searchArguments({ properties: { query: { type: "string" }, page_size: { type: "integer" } } }, "milk"),
  { query: "milk", page_size: 15 },
);
assert.deepEqual(equivalentArguments({ properties: { product_id: { type: "string" }, stores: { type: "string" } } }, "coles_9"), {
  product_id: "coles_9",
  stores: "coles,woolworths,aldi",
});
pass("MCP arguments follow the tool schema");

const campaign = { product: "I want to sell apple juice", category: "Grocery", country: "AU" } as Campaign;
const disconnected = await shelfPriceTool.run({
  campaign,
  brand: {} as BrandProfile,
  at: "2026-10-17T00:00:00.000Z",
  args: { query: "apple juice" },
});
assert.equal(disconnected.status, "empty");
assert.equal(disconnected.evidence[0]?.status, "unavailable");
assert.equal(disconnected.evidence[0]?.sourceName, "WhichGrocer");
assert.match(disconnected.gap?.detail ?? "", /not connected/);
pass("a run without a WhichGrocer sign-in records the price as unavailable");

const overseas = await shelfPriceTool.run({
  campaign: { ...campaign, country: "UK" },
  brand: {} as BrandProfile,
  at: "2026-10-17T00:00:00.000Z",
  args: { query: "apple juice" },
});
assert.equal(overseas.status, "skipped");
assert.match(overseas.summary, /Australian retailers/);
pass("campaigns outside Australia do not call WhichGrocer");

const settings = defaultSettings();
const drafted = blankCampaign(
  {
    name: "Apple juice",
    product: "I want to sell apple juice",
    category: "Grocery",
    targetAudience: "Weekday grocery shoppers",
    objective: "Sell more apple juice",
    budget: 500,
    channels: ["web"],
    startDate: "2026-10-20",
    endDate: "2026-11-02",
    country: "AU",
    notes: "",
  },
  defaultBrand,
  null,
  settings,
);
const offline = {
  request: async (): Promise<CompleteResult> => ({
    provider: "Offline",
    providerId: "openai",
    modelId: "openai:gpt-6-luna",
    modelName: "Offline",
    status: "unconfigured",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, billedAs: "none", estimate: true, latencyMs: 0 },
    text: null,
    note: "suite",
    at: "2026-10-17T00:00:00.000Z",
  }),
};
const poster = async () => ({
  kind: "image" as const,
  modelId: "stub",
  provider: "stub",
  modelName: "stub",
  status: "stubbed" as const,
  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, units: 1, unitLabel: "image", costUsd: 0, billedAs: "stub", latencyMs: 1, estimate: true },
  url: null,
  note: "suite",
  at: "2026-10-17T00:00:00.000Z",
});
const now = "2026-10-17T00:00:00.000Z";
const launched = await runEngine(
  { campaigns: [drafted], now },
  drafted,
  { type: "START", actor: "founder" },
  settings,
  defaultBrand,
  { llm: offline, maxSteps: 1, renderPoster: poster },
);
const shelfCall = launched.campaign.toolCalls.find((call) => call.tool === "web.shelf_prices");
assert.ok(shelfCall, "trend research must call WhichGrocer");
assert.equal(shelfCall.args.query, "apple juice");
assert.equal(shelfCall.status, "empty");
assert.ok(
  launched.campaign.evidence.some((row) => row.sourceName === "WhichGrocer" && row.status === "unavailable"),
  "the ledger records that WhichGrocer was not connected",
);
pass("trend research asks WhichGrocer for apple juice and records the gap");

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const catalogueInput = {
  product: "apple juice",
  category: "Grocery",
  country: "AU",
  at: "2026-10-17T00:00:00.000Z",
  query: "apple juice",
};
const previousKey = process.env.WHICHGROCER_API_KEY;
delete process.env.WHICHGROCER_API_KEY;
const missingKey = await lookupShelfPrices(catalogueInput, async () => {
  throw new Error("WhichGrocer was called without a key");
});
assert.equal(missingKey.ok, false);
if (!missingKey.ok) assert.match(missingKey.reason, /API key is not set/);
pass("a missing API key does not call WhichGrocer");

process.env.WHICHGROCER_API_KEY = "wg_live_test";
const calls: string[] = [];
const priced = await lookupShelfPrices(catalogueInput, async (input, init) => {
  const url = String(input);
  calls.push(url);
  assert.equal(new Headers(init?.headers).get("authorization"), "Bearer wg_live_test");
  if (url.includes("/v2/products/search")) {
    return jsonResponse({
      data: [
        {
          id: "coles_9",
          name: "Just Juice Apple Juice 2L",
          store: "coles",
          price: 3.5,
          currency: "AUD",
          url: "https://www.coles.com.au/product/apple-juice",
          last_seen_at: "2026-10-16T01:00:00.000Z",
        },
      ],
    });
  }
  assert.match(url, /\/v2\/products\/coles_9\/equivalents\?stores=coles%2Cwoolworths%2Caldi/);
  return jsonResponse({
    data: {
      members: [
        {
          id: "coles_9",
          name: "Just Juice Apple Juice 2L",
          store: "coles",
          price: 3.5,
          url: "https://www.coles.com.au/product/apple-juice",
          last_seen_at: "2026-10-16T01:00:00.000Z",
        },
        {
          id: "woolworths_8",
          name: "Just Juice Apple Juice 2L",
          store: "woolworths",
          price: 3.2,
          url: "https://www.woolworths.com.au/shop/productdetails/8",
          last_seen_at: "2026-10-16T01:00:00.000Z",
        },
      ],
    },
  });
});
assert.equal(calls.length, 2);
assert.equal(priced.ok, true);
if (priced.ok) {
  assert.deepEqual(
    priced.offers.map((offer) => offer.store),
    ["woolworths", "coles"],
  );
  assert.match(priced.claim, /Woolworths \$3\.20/);
}
pass("the API key is sent to search, then equivalents when one retailer comes back");

const rejected = await lookupShelfPrices(catalogueInput, async () =>
  jsonResponse({ error: { code: "unauthorized", message: "Invalid API key" } }, 401),
);
assert.equal(rejected.ok, false);
if (!rejected.ok) assert.match(rejected.reason, /rejected the API key/);
pass("a rejected API key is recorded without a catalogue price");

function offer(partial: Pick<ShelfOffer, "id" | "name" | "store" | "storeLabel" | "price">): ShelfOffer {
  return {
    currency: "AUD",
    cupPrice: null,
    url: null,
    special: false,
    discountPct: null,
    outOfStock: false,
    observedAt: "2026-10-16",
    ...partial,
  };
}

const matched = recommendClearance({
  unitCostAud: 2,
  currentPriceAud: 5,
  offers: [
    offer({ id: "woolworths_8", name: "Apple juice 2L", store: "woolworths", storeLabel: "Woolworths", price: 3.2 }),
    offer({ id: "coles_9", name: "Apple juice 2L", store: "coles", storeLabel: "Coles", price: 3.5 }),
  ],
});
assert.equal(matched.ok, true);
if (matched.ok) {
  assert.equal(matched.recommendation.discountPct, 36);
  assert.equal(matched.recommendation.recommendedPriceAud, 3.2);
  assert.equal(matched.recommendation.marketLabel, "Woolworths $3.20");
  assert.equal(matched.recommendation.limitedByCost, false);
}
pass("a clearance discount meets the cheapest similar catalogue price");

const floored = recommendClearance({
  unitCostAud: 2,
  currentPriceAud: 2.5,
  offers: [offer({ id: "aldi_3", name: "Apple juice 2L", store: "aldi", storeLabel: "ALDI", price: 1.8 })],
});
assert.equal(floored.ok, true);
if (floored.ok) {
  assert.equal(floored.recommendation.discountPct, 20);
  assert.equal(floored.recommendation.recommendedPriceAud, 2);
  assert.equal(floored.recommendation.limitedByCost, true);
}
pass("the discount stops at cost when the catalogue is cheaper");

const already = recommendClearance({
  unitCostAud: 2,
  currentPriceAud: 3,
  offers: [offer({ id: "woolworths_8", name: "Apple juice 2L", store: "woolworths", storeLabel: "Woolworths", price: 3.2 })],
});
assert.equal(already.ok, true);
if (already.ok) assert.equal(already.recommendation.discountPct, 0);
pass("no discount when the current price is already under the catalogue");

const noMarket = recommendClearance({ unitCostAud: 2, currentPriceAud: 5, offers: [] });
assert.equal(noMarket.ok, false);
pass("no discount is invented when WhichGrocer has no comparable price");

if (previousKey === undefined) delete process.env.WHICHGROCER_API_KEY;
else process.env.WHICHGROCER_API_KEY = previousKey;

console.log(`\n${checks} checks passed`);
