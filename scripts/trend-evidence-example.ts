import { writeFileSync } from "node:fs";
import { blankCampaign, defaultBrand } from "../src/lib/seed";
import { defaultSettings } from "../src/lib/settings";
import { TOOL_REGISTRY, setShelfPriceLookup } from "../src/lib/runtime/tools";
import { lookupShelfPrices } from "../src/lib/retail/whichgrocer/connection";
if (!process.argv.includes("--live")) throw new Error("Use --live for real public-source requests. No LLM is called.");
const now = new Date();
const startDate = now.toISOString().slice(0, 10);
const endDate = new Date(now.getTime() + 3 * 86400000).toISOString().slice(0, 10);
const campaign = blankCampaign({ name: "TA-03 repeatable research example", product: "Apple juice", category: "Grocery", targetAudience: "Australian adult shoppers", objective: "Product awareness", budget: 1000, channels: ["web"], startDate, endDate, country: "AU", notes: "Source retrieval demonstration; no market trend or complete brief claimed." }, defaultBrand, null, defaultSettings());
setShelfPriceLookup(lookupShelfPrices);
const calls = [];
for (const tool of TOOL_REGISTRY) {
  const args: Record<string, string> = tool.name === "web.market_context" ? { topic: "Apple juice" } : tool.name === "web.competitor_scan" ? { query: "apple juice AU retail promotion" } : tool.name === "web.shelf_prices" ? { query: "apple juice" } : {};
  const outcome = await tool.run({ campaign, brand: defaultBrand, args, at: new Date().toISOString() });
  campaign.evidence.push(...outcome.evidence);
  calls.push({ tool: tool.name, status: outcome.status, summary: outcome.summary, gap: outcome.gap });
  console.log(`${tool.name}: ${outcome.status} — ${outcome.summary}`);
}
const verified = campaign.evidence.filter(e => e.status === "verified" && e.sourceKind === "external_public");
const record = { mode: "LIVE EXTERNAL RETRIEVAL — no LLM, no synthetic evidence", executedAt: now.toISOString(), scope: { product: campaign.product, country: campaign.country, startDate, endDate }, calls, evidence: campaign.evidence, liveSourceCount: new Set(verified.map(e => e.sourceName)).size, completeTrendBrief: false };
const output = process.argv.find(a => a.startsWith("--output="))?.slice(9);
if (output) writeFileSync(output, JSON.stringify(record, null, 2) + "\n");
else console.log(JSON.stringify(record, null, 2));
if (!verified.length) { console.error("No live source returned usable evidence; live acceptance is incomplete."); process.exitCode = 1; }
