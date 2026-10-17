/**
 * Shelf-price shaping and the disconnected WhichGrocer path.
 *
 * No network and no WhichGrocer account. The live connector is exercised from
 * Settings → Connect WhichGrocer.
 *
 *   npm run test:whichgrocer
 */

import assert from "node:assert/strict";
import {
  comparisonOffers,
  describeShelf,
  offersFromPayload,
  shelfQuery,
} from "../src/lib/retail/whichgrocer/query";
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
assert.equal(described.observedAt, "2026-10-16");
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

console.log(`\n${checks} checks passed`);
