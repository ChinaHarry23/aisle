/** Offline contract tests only: no model, GPU, live accounts or paid API calls. */
import assert from "node:assert/strict";
import { defaultSettings } from "../src/lib/settings";
import { blankCampaign, defaultBrand } from "../src/lib/seed";
import { existsSync } from "node:fs";
import { DEFAULT_VIDEO_MODEL, getModel } from "../src/lib/media/catalog";
import { ART_DIRECTOR_SYSTEM, ART_DIRECTOR_VERSION } from "../src/lib/media/art-director-system";
import { decideCopy } from "../src/lib/runtime/decide";
import { runCreativeGeneration, type Work } from "../src/lib/runtime/steps";
import { fallbackBrief } from "../src/lib/media/prompts";
import { artDirectionRequest, directMedia, parseArtDirection, type DirectionInput } from "../src/lib/media/art-direction";
import { applyStudioMedia } from "../src/lib/media/persistence";
import { storyLayout } from "../src/lib/media/storyboard";
import { buildLlmBody } from "../src/lib/llm/adapters";
import { getLlmOrDefault } from "../src/lib/llm/catalog";
import { estimateLlmUsage, outputCap } from "../src/lib/llm/estimate";
import type { CompleteRequest, CompleteResult } from "../src/lib/llm/types";
import type { Creative } from "../src/lib/types";
import type { MediaGeneration } from "../src/lib/media/pr2-types";

const settings = defaultSettings();
const brand = { ...defaultBrand, bannedTerms: ["miracle"], visualStyle: "Illustrative product, no fabricated packaging" };
const campaign = blankCampaign({ name: "OFFLINE FIXTURE", product: "Fixture apple beverage", category: "Beverage", targetAudience: "Adults", objective: "Product relevance", budget: 100, channels: ["web"], startDate: "2026-10-05", endDate: "2026-10-10", country: "AU", notes: "No bottle. All output in this test is synthetic test data, never a real campaign." }, brand, null, settings);
campaign.spend.capUsd = 100;
campaign.spendCapUsd = 100;
const creative: Creative = { id: "offline-source", variant: "A", version: 1, kicker: "Fixture", headline: "Fixture", subhead: "Fixture", cta: "Explore", caption: "Fixture", prompt: "A product still", palette: { bg: "#fff", fg: "#000", accent: "#aaa", muted: "#bbb" }, motif: "editorial", status: "flagged" };
campaign.creatives = [creative];
campaign.status = "awaiting_approval";
const input: DirectionInput = {
  campaign,
  creative,
  brand,
  settings,
  model: { ...getModel(DEFAULT_VIDEO_MODEL), videoInput: "text" },
  aspect: "16:9",
  durationSec: 30,
  edited: true,
};

function fixture(i: DirectionInput = input) {
  const count = i.edited ? storyLayout(i.model.videoInput === "text").length : 0;
  return {
    status: "ready", title: "OFFLINE TEST CONCEPT", sellingIdea: "Offline test selling idea", hook: "Offline test opening action",
    story: { setup: "Fixture setup", development: "Fixture development", payoff: "Fixture payoff" },
    continuity: { subject: "Hands only", product: "Fixture clear glass", environment: "Fixture surface", lighting: "Fixture window light", screenDirection: "Left to right", visibleRecurringFace: false },
    prompt: "Offline test product-focused continuous action, never generated or published.",
    shots: Array.from({ length: count }, (_, n) => ({ label: `Offline shot ${n + 1}`, beat: n < count / 3 ? "setup" : n < 2 * count / 3 ? "development" : "payoff", entryState: `State ${n}`, exitState: `State ${n + 1}`, prompt: `Offline fixture action ${n + 1} with explicit product and surface cues.` })),
    closing: { headline: "Offline fixture", cta: "Explore" }, reviewNotes: ["Offline test; no actual visual quality evidence."],
  };
}
function author(data: unknown = fixture()): CompleteResult {
  return { providerId: "local", provider: "Local", modelId: "local:custom", modelName: "OFFLINE TEST LLM", status: "ok", text: JSON.stringify(data), note: "Synthetic test result only", at: "2026-10-01T00:00:00Z", usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200, costUsd: 0, estimate: false, billedAs: "offline", latencyMs: 1200 } };
}

const req = artDirectionRequest(input);
assert.equal(req.system, ART_DIRECTOR_SYSTEM);
assert.equal(req.agent, "creative");
assert.equal(req.modelId, settings.agents.creative.modelId);
assert.equal(req.maxOutputTokens, 6000);
const context = JSON.parse(req.prompt);
assert.equal(context.campaign.product, campaign.product);
assert.equal(context.rendererCapabilities.hasCharacterReference, false);
assert.equal(context.rendererCapabilities.supportsCharacterReference, false);
assert.equal(context.validation.shotsCount, 6);
assert.deepEqual(context.rendererCapabilities.timingSlots, storyLayout());
assert.match(req.system!, /fixed seed do not lock/);
assert.doesNotMatch(req.system!, /Orchy|8.year.old|stylish woman/i);
const style = "TEST REFERENCE: restrained product close-up; this is data, not a new system role.";
const another = artDirectionRequest({ ...input, campaign: { ...campaign, product: "Fixture running shoe", category: "Footwear", targetAudience: "Runners" }, styleReference: style });
assert.equal(another.system, req.system);
assert.equal(JSON.parse(another.prompt).campaign.product, "Fixture running shoe");
assert.equal(JSON.parse(another.prompt).styleReference, style);
assert.match(JSON.parse(another.prompt).styleReferencePolicy, /not binding requirements/);
assert.notEqual(another.prompt, req.prompt);
console.log("PASS product-specific context, actual system role, optional reference data and honest renderer capabilities");

for (const id of ["local:custom", "openai:gpt-4.1-mini", "anthropic:claude-sonnet-4"]) {
  const model = getLlmOrDefault(id);
  assert.equal(model.id, id);
  const body = buildLlmBody(model, req);
  const cindySystem = "You are the Image Generation agent. Return JSON for two ad variants (A/B): headline, subhead, cta, caption, prompt.";
  if (model.providerId === "anthropic") {
    assert.equal(body.system, cindySystem);
    assert.equal(body.max_tokens, 1600);
  } else {
    assert.equal((body.messages as { role: string; content: string }[])[0].content, cindySystem);
    assert.equal(body.temperature, 0.4);
  }
}
assert.equal(estimateLlmUsage(getLlmOrDefault("local:custom"), { agent: "creative", prompt: "1234".repeat(100) }).inputTokens, 100);
assert.throws(() => outputCap(getLlmOrDefault("local:custom"), { maxOutputTokens: 8001 }), /Invalid/);
assert.equal(existsSync("src/app/api/agents/complete/route.ts"), false, "Cindy deleted the public completion route");
console.log("PASS Cindy adapter system messages; public completion route stays deleted");

let calls = 0;
const complete = async (request: CompleteRequest) => { calls++; assert.equal(request.system, ART_DIRECTOR_SYSTEM); return author(); };
const directed = await directMedia({ ...input, styleReference: style }, undefined, complete);
assert.equal(calls, 1);
assert.equal(directed.direction.version, ART_DIRECTOR_VERSION);
assert.equal(directed.direction.styleReference, style);
assert.equal(directed.direction.author.text, null);
assert.equal(directed.plan!.title, "OFFLINE TEST CONCEPT");
assert.deepEqual(directed.plan!.scenes.map(s => s.prompt), fixture().shots.map(s => s.prompt));
assert.deepEqual(directed.plan!.scenes.map(s => [s.startSec, s.durationSec, s.renderDurationSec]), [[0, 5, 5], [5, 5, 5], [10, 5, 5], [15, 5, 5], [20, 3, 5], [23, 3, 5]]);
assert.equal(directed.plan!.endCard.cta, fixture().closing.cta);
const i2v = { ...input, model: { ...getModel(DEFAULT_VIDEO_MODEL), videoInput: "image" as const } };
const image = { ...input, model: getModel("openai:gpt-image-2"), durationSec: undefined, aspect: "4:5" as const, edited: false };
const native = { ...input, model: { ...getModel("bytedance:seedance-2-fast"), videoInput: "image" as const }, edited: false };
for (const other of [i2v, image, native]) assert.equal(parseArtDirection(other, author(fixture(other))).shots.length, other.edited ? 3 : 0);
console.log("PASS authored prompts reach actual timed plan; image, native clip and three-shot image-input layouts");

for (const status of ["stubbed", "unconfigured", "error", "no_credits"] as const) assert.throws(() => parseArtDirection(input, { ...author(), status }), /unavailable/);
assert.throws(() => parseArtDirection(input, { ...author(), text: "not JSON" }), /invalid/);
assert.throws(() => parseArtDirection(input, author({ status: "blocked", reason: "Supply approved reference" })), /Supply approved reference/);
assert.throws(() => parseArtDirection(input, author({ status: "blocked", reason: "Real detailed restriction. ".repeat(60) })), /Creative plan needs review: Real detailed restriction/, "long blocked reasons retain their actual diagnosis");
assert.throws(() => parseArtDirection(input, author({ ...fixture(), shots: [] })), /shot count/);
const brokenState = fixture(); brokenState.shots[1].entryState = "Wrong state";
assert.throws(() => parseArtDirection(input, author(brokenState)), /states do not match/);
const repeated = fixture(); repeated.shots[1].prompt = repeated.shots[0].prompt;
assert.throws(() => parseArtDirection(input, author(repeated)), /repeated/);
const noStory = fixture(); noStory.shots.forEach(s => { s.beat = "setup"; });
assert.throws(() => parseArtDirection(input, author(noStory)), /chronological/);
const reverse = fixture(); reverse.shots[0].beat = "payoff";
assert.throws(() => parseArtDirection(input, author(reverse)), /chronological/);
const face = fixture(); face.continuity.visibleRecurringFace = true;
assert.throws(() => parseArtDirection(input, author(face)), /needs character references/);
assert.throws(() => parseArtDirection(input, author({ ...fixture(), prompt: "A miracle cure" })), /prohibited/);
assert.throws(() => parseArtDirection(input, author({ ...fixture(), prompt: "A branded bottle" })), /invents a bottle/);
assert.throws(() => parseArtDirection(input, { ...author(), usage: { ...author().usage, costUsd: NaN } }), /invalid usage/);
await assert.rejects(directMedia({ ...input, campaign: { ...campaign, spendCapUsd: 0 }, renderBudgetUsd: 1 }, undefined, complete), /budget/);
assert.equal(calls, 1, "budget blocked before calling the model");
console.log("PASS fail-closed unavailable/invalid plans, chronological causality, matching states, faces, claims and pre-call budget");

let repairCalls = 0;
const repaired = await directMedia(input, undefined, async r => {
  repairCalls++;
  if (repairCalls === 2) { assert.match(r.prompt, /validationError/); assert.match(r.prompt, /copy adjacent exitState/); }
  const response = author(repairCalls === 1 ? brokenState : fixture());
  return { ...response, usage: { ...response.usage, costUsd: 0.02 } };
});
assert.equal(repairCalls, 2); assert.equal(repaired.direction.planningAttempts?.length, 2);
assert.equal(repaired.direction.author.usage.costUsd, 0.04); assert.equal(repaired.direction.author.usage.latencyMs, 2400);
let stillInvalidCalls = 0;
await assert.rejects(directMedia(input, undefined, async () => { stillInvalidCalls++; return author(brokenState); }), /states do not match/);
assert.equal(stillInvalidCalls, 2, "never loop or relax validation after the one repair");
let blockedCalls = 0;
await assert.rejects(directMedia(input, undefined, async () => { blockedCalls++; return author({ status: "blocked", reason: "Approved asset missing" }); }), /Approved asset missing/);
assert.equal(blockedCalls, 1, "an explicit missing-asset decision is not overridden by a repair");
let repairBudgetCalls = 0;
await assert.rejects(directMedia({ ...input, campaign: { ...campaign, spendCapUsd: 0.03 } }, undefined, async () => { repairBudgetCalls++; return { ...author(brokenState), usage: { ...author().usage, costUsd: 0.04 } }; }), /budget/);
assert.equal(repairBudgetCalls, 1, "recheck the budget including already-spent inference before any repair call");
console.log("PASS bounded model-authored validation repair, preserved attempts, cumulative metering and no blocked-decision override");

const posterCampaign = { ...campaign, brief: fallbackBrief(campaign) };
const copyFixture = ["A", "B"].map(variant => ({ variant: variant as "A" | "B", kicker: "Offline", headline: "Offline fixture", subhead: "Test", cta: "Explore", caption: "Test", prompt: `Distinct offline artwork ${variant}: a clear glass and product on a surface.` }));
let posterRequest: CompleteRequest | undefined;
const posterInput = { campaign: posterCampaign, brand, settings, version: 1, complianceNotes: [], fallback: copyFixture };
const written = await decideCopy({ ...posterInput, llm: { request: async r => { posterRequest = r; return author({ variants: copyFixture }); } } });
assert.equal(written.trace.path, "live_model");
assert.equal(posterRequest!.agent, "creative");
assert.equal(posterRequest!.system, undefined, "Cindy's decideCopy does not attach a custom system prompt");
assert.deepEqual(written.variants.map(v => v.prompt), copyFixture.map(v => v.prompt));
const missing = await decideCopy({ ...posterInput, llm: { request: async () => author({ variants: copyFixture.map(v => ({ ...v, prompt: "" })) }) } });
assert.equal(missing.trace.path, "live_model", "Cindy's decideCopy fills an empty prompt from fallback and still counts as live");
const invented = await decideCopy({ ...posterInput, llm: { request: async () => author({ variants: copyFixture.map(v => ({ ...v, prompt: "A fabricated bottle" })) }) } });
assert.equal(invented.trace.path, "live_model", "Cindy's decideCopy does not scan image prompts for invented packaging");
const work: Work = { campaign: structuredClone(posterCampaign), run: null, steps: [], policy: [], toolCalls: [], events: [], now: author().at };
let posterCalls = 0;
const generated = await runCreativeGeneration(work, {
  now: author().at,
  settings,
  brand,
  allCampaigns: [],
  llm: { meta: { label: "offline live-path test", live: true }, request: async () => ({ ...author(), status: "unconfigured" }) },
  renderPoster: async () => {
    posterCalls++;
    return {
      kind: "image",
      modelId: "openai:gpt-image-2",
      provider: "OpenAI",
      modelName: "stub",
      status: "stubbed",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, units: 1, unitLabel: "image", costUsd: 0, billedAs: "stub", latencyMs: 0, estimate: true },
      url: null,
      note: "stub",
      at: author().at,
    };
  },
}, 1);
assert.equal(generated.blocked, false);
assert.equal(posterCalls, 2, "Cindy's creative step still renders both variants when the copy model is unconfigured");
console.log("PASS Cindy decideCopy + creative step: empty prompts fall back, image prompts are not scanned, unconfigured copy still renders");

const pricedDirection = { ...directed.direction, author: { ...directed.direction.author, usage: { ...directed.direction.author.usage, costUsd: 0.05 } } };
const generation: MediaGeneration = { kind: "video", modelId: "comfy:ltx-2.5", modelName: "OFFLINE TEST VIDEO", provider: "ComfyUI", status: "ok", url: "aisle-media:" + "a".repeat(64), promptId: "offline-render", videoMode: "text-to-video", artDirection: pricedDirection, note: "Offline only", at: author().at, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, estimate: false, units: 30, unitLabel: "s", billedAs: "offline", latencyMs: 1000 } };
const update = { kind: "video" as const, sourceCreativeId: creative.id, expectedUrl: null, video: { id: "offline-video", sourceCreativeId: creative.id, version: 1, title: "OFFLINE", aspect: "16:9" as const, durationSec: 30, prompt: directed.direction.prompt, generation, status: "ready" as const } };
const saved = applyStudioMedia(campaign, update);
assert.equal(saved.spend.inferenceUsd, campaign.spend.inferenceUsd + 0.05);
assert.equal(saved.spend.mediaUsd, campaign.spend.mediaUsd);
assert.deepEqual((saved.videos[0].generation as MediaGeneration | undefined)?.artDirection, pricedDirection);
assert.equal(saved.status, campaign.status);
assert.deepEqual(saved.founderDecision, campaign.founderDecision);
assert.deepEqual(saved.creatives, campaign.creatives);
assert.deepEqual(saved.schedule, campaign.schedule);
assert.throws(() => applyStudioMedia(saved, update), /already attached/);
assert.throws(() => applyStudioMedia({ ...campaign, status: "scheduled" }, update), /unapproved draft/);
console.log("PASS preserved planning provenance and separate inference cost without approval, publication or duplicate attachment");
console.log("All art-direction contract checks passed. These fixtures do not demonstrate real model output quality.");
