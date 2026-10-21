import assert from "node:assert/strict";
import { blankCampaign, defaultBrand } from "../src/lib/seed";
import { defaultSettings } from "../src/lib/settings";
import { TOOL_REGISTRY, marketContextTool, competitorScanTool, seasonWeatherTool, internalRetailTool, shelfPriceTool, setShelfPriceLookup } from "../src/lib/runtime/tools";
import { describeShelf, type ShelfOffer } from "../src/lib/retail/whichgrocer/query";
import { runEngine } from "../src/lib/runtime/engine";
import { stubComplete } from "../src/lib/llm/stub";
const settings = defaultSettings();
const campaign = blankCampaign({ name: "TA-03 offline test", product: "Apple juice", category: "Grocery", targetAudience: "Adult shoppers", objective: "Product awareness", budget: 1000, channels: ["web"], startDate: "2026-10-20", endDate: "2026-10-22", country: "AU", notes: "" }, defaultBrand, null, settings);
const input = { campaign, brand: defaultBrand, at: "2026-10-18T10:00:00Z", args: {} };
let checks = 0;
const pass = (name: string) => { checks++; console.log(`PASS ${name}`); };
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => { throw new Error("Unexpected network call"); };
  for (const tool of TOOL_REGISTRY) {
    const result = await tool.run({ ...input, campaign: { ...campaign, dataAccessPolicy: { externalSources: [] } } });
    assert.equal(result.status, "skipped"); assert.equal(result.evidence.length, 0);
  }
  assert.equal(campaign.internalDataAuthorised, false);
  assert.equal((await internalRetailTool.run({ ...input, campaign: { ...campaign, internalDataAuthorised: true } })).evidence.length, 0);
  pass("policy denies every public adapter before I/O; explicit internal consent never invents POS data");
  globalThis.fetch = async () => Response.json({ title: "Apple juice", extract: "Synthetic product context" });
  const unknown = await marketContextTool.run(input);
  assert.equal(unknown.evidence[0].observedAt, null); assert.equal(unknown.evidence[0].dateBasis, "unknown");
  assert.equal(unknown.evidence[0].fetchedAt, input.at);
  globalThis.fetch = async () => Response.json({ title: "Apple juice", extract: "Synthetic product context", timestamp: "2026-09-04T01:00:00Z" });
  const dated = await marketContextTool.run(input);
  assert.equal(dated.evidence[0].observedAt, "2026-09-04"); assert.equal(dated.evidence[0].dateBasis, "revision");
  pass("unknown information dates stay null and page revision dates are labelled separately from retrieval time");
  globalThis.fetch = async () => Response.json({ RelatedTopics: [], AbstractText: "" });
  const empty = await competitorScanTool.run(input);
  assert.equal(empty.status, "empty"); assert.equal(empty.evidence.length, 0); assert.ok(empty.gap);
  globalThis.fetch = async () => Response.json(null);
  assert.equal((await marketContextTool.run(input)).status, "empty");
  globalThis.fetch = async () => new Response("rate limited", { status: 429 });
  assert.equal((await marketContextTool.run(input)).evidence[0].status, "unavailable");
  globalThis.fetch = async () => { throw new Error("secret-token-must-not-leak"); };
  assert.ok(!JSON.stringify(await marketContextTool.run(input)).includes("secret-token"));
  pass("empty search, malformed payload, HTTP failure and network error produce limitations without fabricated facts or secret errors");
  globalThis.fetch = async () => Response.json({ daily: { time: ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"], temperature_2m_max: [99, 20, null, 22], temperature_2m_min: [90, 10, 11, 12], precipitation_sum: [90, 0, 0, 2] } });
  const weather = await seasonWeatherTool.run(input);
  assert.equal((weather.data as { avgMax: number }).avgMax, 21);
  assert.equal(weather.evidence[0].observedAt, null); assert.equal(weather.evidence[0].coverage?.location, "Sydney"); assert.ok(weather.gap);
  const outside = await seasonWeatherTool.run({ ...input, campaign: { ...campaign, startDate: "2027-01-01", endDate: "2027-01-02" } });
  assert.equal(outside.evidence.length, 0); assert.ok(outside.gap);
  pass("weather intersects campaign dates, rejects null measurements and discloses city/partial coverage");
  const offer: ShelfOffer = { id: "fixture", name: "Apple juice", store: "coles", storeLabel: "Coles", price: 3, currency: "AUD", cupPrice: null, url: "https://example.com/fixture", special: false, discountPct: null, outOfStock: false, observedAt: null };
  let shelfCalls = 0;
  setShelfPriceLookup(async () => { shelfCalls++; const offers = [offer, { ...offer, id: "fixture-2", observedAt: "2026-10-16" }]; return { ok: true, query: "Apple juice", offers, summary: "SYNTHETIC", ...describeShelf("Apple juice", offers, input.at) }; });
  const shelf = await shelfPriceTool.run(input);
  assert.equal(shelf.evidence.length, 2); assert.equal(shelf.evidence[0].observedAt, null); assert.equal(shelf.evidence[1].observedAt, "2026-10-16");
  const beforeShelf = shelfCalls;
  await shelfPriceTool.run({ ...input, campaign: { ...campaign, country: "UK" } });
  await shelfPriceTool.run({ ...input, campaign: { ...campaign, dataAccessPolicy: { externalSources: [] } } });
  assert.equal(shelfCalls, beforeShelf);
  pass("each shelf offer retains its own provenance/date; country and policy gates precede credentialed lookup");
  let decisions = 0; let renders = 0;
  const options = { llm: { request: async (req: Parameters<typeof stubComplete>[0]) => { decisions++; return stubComplete(req, "OFFLINE FIXTURE"); } }, renderPoster: async () => { renders++; throw new Error("No creative handoff expected"); } };
  const denied = { ...campaign, dataAccessPolicy: { externalSources: [] } };
  const result = await runEngine({ campaigns: [denied], now: input.at }, denied, { type: "START", actor: "founder" }, settings, defaultBrand, options);
  assert.equal(result.campaign.status, "paused"); assert.equal(result.canAdvance, false); assert.equal(renders, 0); assert.equal(result.campaign.run?.step, "trend.receive"); assert.deepEqual(result.campaign.sharedContext.approvedClaims, []);
  pass("no usable evidence stores a partial brief and prevents creative handoff");
  let allowed = true; let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; allowed = false; return Response.json({ extract: "Late synthetic reply" }); };
  const beforeDecisions = decisions;
  const paused = await runEngine({ campaigns: [campaign], now: input.at }, campaign, { type: "START", actor: "founder" }, settings, defaultBrand, { ...options, researchAllowed: () => allowed });
  assert.equal(fetchCalls, 1); assert.equal(shelfCalls, beforeShelf); assert.equal(decisions, beforeDecisions); assert.equal(paused.campaign.status, "paused"); assert.equal(renders, 0);
  assert.ok(paused.campaign.evidence.some(e => e.detail.includes("Late synthetic reply")));
  pass("pause during a response retains provenance but starts no further tool, LLM or creative call");
  assert.equal(campaign.evidence.length, 0);
  pass("source campaign remains unchanged");
  globalThis.fetch = async () => { throw new DOMException("timeout", "TimeoutError"); };
  assert.match((await marketContextTool.run(input)).summary, /timed out/);
  pass("bounded request timeouts become explicit source limitations");
  // Old successful evidence must not satisfy a new denied/failed retrieval.
  const staleCampaign = { ...denied, evidence: dated.evidence };
  const stale = await runEngine({ campaigns: [staleCampaign], now: input.at }, staleCampaign, { type: "START", actor: "founder" }, settings, defaultBrand, options);
  assert.equal(stale.campaign.status, "paused");
  assert.ok(!stale.campaign.trendFindings.some(f => f.evidenceIds.includes(dated.evidence[0].id)));
  pass("older successful evidence remains auditable but cannot satisfy a new retrieval");
  globalThis.fetch = async () => Response.json({ extract: "Synthetic context" });
  allowed = true;
  const afterDecision = await runEngine({ campaigns: [campaign], now: input.at }, campaign, { type: "START", actor: "founder" }, settings, defaultBrand, {
    ...options, researchAllowed: () => allowed,
    llm: { request: async (req) => { allowed = false; return stubComplete(req, "OFFLINE FIXTURE"); } },
  });
  assert.equal(afterDecision.campaign.status, "paused"); assert.equal(renders, 0);
  assert.deepEqual(afterDecision.campaign.sharedContext.approvedClaims, []);
  pass("pause while the decision returns also blocks creative handoff");

} finally { globalThis.fetch = originalFetch; }
console.log(`${checks} TA-03 checks passed (all fixtures synthetic; no live API claim).`);
