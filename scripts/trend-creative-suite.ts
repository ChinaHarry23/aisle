/** Offline campaign strategy → copy → image/channel contract regressions. No provider calls. */
import assert from "node:assert/strict";
import { briefFixture, fixtureAt } from "./trend-brief-fixtures";
import { assembleStrategy, type StrategyDraft } from "../src/lib/trend/strategy";
import { decideCopy, decideChannelCaptions, type CopyVariant } from "../src/lib/runtime/decide";
import { posterPrompt } from "../src/lib/media/prompts";
import { copyFromBrief } from "../src/lib/media/brief-copy";
import { buildCreatives } from "../src/lib/runtime/steps";
import { applyStudioMedia, withoutVisualInsightUses } from "../src/lib/media/persistence";
import { defaultBrand } from "../src/lib/seed";
import { defaultSettings } from "../src/lib/settings";
import { stubComplete } from "../src/lib/llm/stub";
import type { CompleteRequest } from "../src/lib/llm/types";
import type { Creative } from "../src/lib/types";
import type { MediaGeneration } from "../src/lib/media/pr2-types";

const { c } = briefFixture();
c.productImageUrl = "https://example.invalid/fixture-pack.jpg";
c.brief!.angle = "Report synthesis needs review.";
c.brief!.visualDirection = "Visual direction awaits a validated report.";
const draft: StrategyDraft = {
  recommendedAngle: "SYNTHETIC fixture: make the lunch table the hero",
  audienceMotivation: "SYNTHETIC fixture: adults planning lunches need a concrete serving occasion.",
  keyMessage: "A place at your lunch table",
  visualDirection: "A tabletop composition with a serving glass and the exact product pack; no people in frame.",
  alternativeConcept: "A close composition explaining the exact pack and product name.",
  insights: [
    { id: "lunch-scene", title: "Show a serving occasion", implication: "Make the use occasion concrete.", application: "Use a lunch-table scene and a lunch-led headline.", findingIds: ["f-OPPORTUNITY"], basis: "research", limitation: "SYNTHETIC fixture; no measured advertising outcome." },
    { id: "pack-detail", title: "Explore a product close-up", implication: "Product familiarity is a creative hypothesis.", application: "Use a legible pack close-up in the alternative concept.", findingIds: [], basis: "hypothesis", limitation: "A testable creative proposal, not measured audience preference." },
  ],
  channels: [
    { channel: "web", approach: "SYNTHETIC web application: present the serving scene next to product detail.", format: "Hero plus product detail", cta: "Explore the pack", insightIds: ["lunch-scene"] },
    { channel: "email", approach: "SYNTHETIC email application: lead with one lunch idea and one product link.", format: "One idea and one link", cta: "See the lunch idea", insightIds: ["lunch-scene", "pack-detail"] },
  ],
  concepts: [
    { id: "a", name: "At lunch", angle: "Lunch-table occasion", headlineDirection: "Lead with the serving occasion", visualDirection: "Tabletop and glass", insightIds: ["lunch-scene"] },
    { id: "b", name: "A closer look", angle: "Exact product introduction", headlineDirection: "Lead with the product name", visualDirection: "Close pack composition", insightIds: ["pack-detail"] },
  ],
  limitations: ["Offline synthetic test data only."],
};
c.strategy = assembleStrategy(c, draft, fixtureAt, "MOCK ONLY");
const fallback: CopyVariant[] = ["A", "B"].map(variant => ({ variant: variant as "A" | "B", kicker: "", headline: "Fixture product", subhead: c.product, cta: "Explore", caption: "Fixture caption", prompt: "Fixture pack" }));
const response = [
  { ...fallback[0], headline: "A place at your lunch table", prompt: draft.visualDirection, insightUses: [{ insightId: "lunch-scene", application: "visual", rationale: "The glass and lunch-table scene make the serving occasion explicit." }, { insightId: "invented", application: "headline", rationale: "This ID was never supplied." }] },
  { ...fallback[1], headline: "Meet the pack", prompt: "A close product pack composition", insightUses: [{ insightId: "pack-detail", application: "headline", rationale: "Meet the pack introduces the exact product rather than a serving occasion." }] },
];
let copyRequest: CompleteRequest | undefined;
const copy = await decideCopy({ campaign: c, brand: defaultBrand, settings: defaultSettings(), version: 1, complianceNotes: [], fallback, llm: { request: async req => {
  copyRequest = req;
  return { ...stubComplete(req, "Offline fixture"), status: "ok", text: JSON.stringify({ variants: response }) };
} } });
assert.ok(copyRequest);
assert.match(copyRequest.prompt, /SYNTHETIC fixture: make the lunch table the hero/);
assert.match(copyRequest.prompt, /f-OPPORTUNITY/, "the sixth quality finding survives into the actual creative request");
assert.match(copyRequest.prompt, /https:\/\/www\.abs\.gov\.au\/synthetic\/current_market/, "source attribution reaches creative");
assert.match(copyRequest.prompt, /no measured advertising outcome/, "limitations reach creative");
assert.match(copyRequest.prompt, /first campaign concept for A and the alternative for B/);
assert.doesNotMatch(copyRequest.prompt, /Visual direction awaits|Report synthesis needs review/);
assert.doesNotMatch(copyRequest.prompt, /appealing adult enjoying this exact drink/, "the category scene does not override the campaign scene");
assert.deepEqual(copy.variants[0].insightUses?.map(use => use.insightId), ["lunch-scene"]);
assert.deepEqual(copy.variants[0].unusedInsightIds, ["pack-detail"]);
assert.equal(copy.variants[1].insightUses?.[0].insightId, "pack-detail");
assert.equal(copy.variants[0].strategyVersion, c.strategy.version);
console.log("PASS actual creative request retains selected findings, evidence, applications and limitations; distinct concepts and valid adoption survive");

const storedCreatives = buildCreatives(c, copy.variants, 1);
assert.equal(storedCreatives[0].strategyVersion, c.strategy.version);
assert.deepEqual(storedCreatives[0].insightUses, copy.variants[0].insightUses);
assert.deepEqual(storedCreatives[1].unusedInsightIds, ["lunch-scene"]);
console.log("PASS built creative records preserve the strategy version, actual applications and unused insight IDs");

const continuity = copyFromBrief(c);
assert.match(continuity.A.prompt, /Tabletop and glass/);
assert.match(continuity.B.prompt, /Close pack composition/);
assert.doesNotMatch(continuity.A.prompt, /Visual direction awaits|Report synthesis needs review/);
console.log("PASS model-unavailable copy still uses distinct saved concept scenes without workflow placeholders");

const creative: Creative = { ...copy.variants[0], id: "fixture-a", version: 1, status: "draft", motif: "editorial", palette: { bg: "#fff", fg: "#000", accent: "#aaa", muted: "#bbb" } };
const image = posterPrompt(c, creative);
assert.match(image, /tabletop composition/i);
assert.doesNotMatch(image, /appealing adult enjoying this exact drink|Visual direction awaits/);
console.log("PASS poster rendering preserves the chosen campaign scene instead of adding a contradictory category scene");

const mediaCampaign = { ...c, status: "awaiting_approval" as const, creatives: storedCreatives };
const generation: MediaGeneration = {
  kind: "image", modelId: "comfy:local", provider: "ComfyUI", modelName: "Offline fixture", status: "ok", url: "https://example.invalid/revised-fixture.png", note: "Synthetic test only", at: fixtureAt,
  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, units: 1, unitLabel: "image", costUsd: 0, billedAs: "fixture", latencyMs: 0, estimate: false },
  artDirection: {
    version: "fixture", title: "Changed scene", sellingIdea: "Product detail", hook: "Close pack",
    story: { setup: "Product", development: "Detail", payoff: "Explore" },
    continuity: { subject: "Pack", product: c.product, environment: "Studio", lighting: "Soft", screenDirection: "Still", visibleRecurringFace: false },
    prompt: "A revised close product composition without a lunch table", shots: [], closing: { headline: creative.headline, cta: creative.cta }, reviewNotes: [], author: stubComplete(copyRequest, "Offline fixture"),
  },
};
const mediaUpdate = applyStudioMedia(mediaCampaign, { kind: "image", creativeId: storedCreatives[0].id, expectedUrl: null, generation });
assert.deepEqual(mediaUpdate.creatives[0].insightUses, []);
assert.deepEqual(new Set(mediaUpdate.creatives[0].unusedInsightIds), new Set(["pack-detail", "lunch-scene"]));
assert.deepEqual(mediaUpdate.creatives[1].insightUses, storedCreatives[1].insightUses, "unchanged other variant retains attribution");
const copiedInsight: Creative = { ...creative, insightUses: [...creative.insightUses!, { insightId: "lunch-scene", application: "headline", rationale: "Lunch table appears in the unchanged headline." }] };
assert.deepEqual(withoutVisualInsightUses(copiedInsight).insightUses?.map(use => use.application), ["headline"]);
assert.deepEqual(withoutVisualInsightUses(copiedInsight).unusedInsightIds, ["pack-detail"]);
assert.equal(creative.insightUses?.length, 1, "the source creative is not mutated");
console.log("PASS image edits drop outdated visual attribution while preserving copy applications and other variants");

let captionRequest: CompleteRequest | undefined;
await decideChannelCaptions({ campaign: c, brand: defaultBrand, settings: defaultSettings(), hero: creative, channels: [{ channel: "email", spec: "One subject and CTA" }], approvedClaims: [], llm: { request: async req => {
  captionRequest = req;
  return { ...stubComplete(req, "Offline fixture"), status: "ok", text: JSON.stringify({ captions: { email: "A place at your lunch table. Explore the pack." } }) };
} } });
assert.match(captionRequest!.prompt, /SYNTHETIC email application/);
assert.doesNotMatch(captionRequest!.prompt, /SYNTHETIC web application/, "only the selected channel guidance is sent");
console.log("PASS channel adaptation receives the researched application for the selected channel");

c.targetAudience = "A different audience";
let staleRequest: CompleteRequest | undefined;
const stale = await decideCopy({ campaign: c, brand: defaultBrand, settings: defaultSettings(), version: 1, complianceNotes: [], fallback, llm: { request: async req => {
  staleRequest = req;
  return { ...stubComplete(req, "Offline fixture"), status: "ok", text: JSON.stringify({ variants: response }) };
} } });
assert.doesNotMatch(staleRequest!.prompt, /SYNTHETIC fixture: make the lunch table the hero/);
assert.equal(stale.variants[0].insightUses, undefined);
assert.doesNotMatch(staleRequest!.prompt, /Visual direction awaits|Report synthesis needs review/);
const legacyFallback = copyFromBrief(c);
assert.doesNotMatch(legacyFallback.A.prompt, /Visual direction awaits|Report synthesis needs review/);
console.log("PASS a changed campaign does not reuse a previous strategy or claim its insights were applied");
