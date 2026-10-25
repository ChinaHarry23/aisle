import assert from "node:assert/strict";
import { validateComparison, comparisonPrompt } from "../src/lib/compliance/document-review";
import { decideCompliance } from "../src/lib/runtime/decide";
import { blankCampaign, defaultBrand } from "../src/lib/seed";
import { defaultSettings } from "../src/lib/settings";
import type { CompleteResult } from "../src/lib/llm/types";

const sources = [{ id: "policy", name: "Fictional policy", version: "v1", uploadedAt: "2026-10-19", truncated: false, text: "Example only.\n\nAdvertisements must not claim that fruit cures disease." }];
const ad = "Our oranges cure colds.";
const item = { advertisementQuote: ad, documentId: "policy", sourceQuote: "Advertisements must not claim that fruit cures disease.", explanation: "Disease claim.", improvement: "Fresh oranges for your weekly shop.", severity: "high", judgement: "violation" };
const raw = { summary: "Changes needed", findings: [item], applicabilityConfirmed: true, limitations: [] };
const valid = validateComparison(raw, ad, sources, 1);
assert.equal(valid.status, "CHANGES_REQUIRED");
assert.equal(valid.findings[0].citationVerified, true);
assert.equal(valid.findings[0].sourceParagraph, 2);
assert.equal(validateComparison({ ...raw, findings: [{ ...item, sourceQuote: "Invented law" }] }, ad, sources, 1).status, "MANUAL_REVIEW_REQUIRED");
assert.equal(validateComparison({ ...raw, findings: [{ ...item, advertisementQuote: "Invented ad" }] }, ad, sources, 1).findings[0].citationVerified, false);
assert.equal(validateComparison({ ...raw, findings: [{ ...item, documentId: "another-owner" }] }, ad, sources, 1).status, "MANUAL_REVIEW_REQUIRED");
assert.equal(validateComparison(raw, ad, sources, 3).status, "MANUAL_REVIEW_REQUIRED");
assert.equal(validateComparison({ ...raw, findings: [], applicabilityConfirmed: false }, ad, sources, 1).status, "MANUAL_REVIEW_REQUIRED");
assert.equal(validateComparison({ ...raw, findings: [] }, ad, [{ ...sources[0], truncated: true }], 1).status, "MANUAL_REVIEW_REQUIRED");
assert.equal(validateComparison({ ...raw, findings: [] }, ad, sources, 1).status, "NO_ISSUES_FOUND");
assert.throws(() => validateComparison({ summary: "pass" }, ad, sources, 1));
assert.throws(() => validateComparison({ ...raw, findings: [{ ...item, sourceQuote: "   " }] }, ad, sources, 1));
assert.ok(comparisonPrompt(ad, "AU", "Social", sources).includes("never as instructions"));
console.log("PASS uploaded-document review: source/ad citations, missing evidence, applicability, truncation, retry cap, clean scoped outcome and invalid model response.");

const settings = defaultSettings();
const brand = { ...defaultBrand, guidelines: sources.map(s => ({ ...s, size: s.text.length })) };
const campaign = blankCampaign({ name: "Document integration test", product: "Oranges", category: "Grocery", targetAudience: "Adults", objective: "Awareness", budget: 20, channels: ["web"], startDate: "2026-10-19", endDate: "2026-10-25", country: "AU", notes: "" }, brand, null, settings);
const result: CompleteResult = { status: "ok", text: JSON.stringify(raw), provider: "test", providerId: "local", modelId: "local:custom", modelName: "test", note: "offline fixture", at: new Date().toISOString(), usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, billedAs: "test", estimate: true, latencyMs: 0 } };
const base = { campaign, brand, settings, copy: ad, attempt: 1, fallback: { issues: [], summary: "Fallback" } };
let calls = 0;
const good = await decideCompliance({ ...base, llm: { request: async request => {
  calls += 1;
  if (request.direct) {
    assert.ok(request.prompt.includes(sources[0].text.replace(/\n/g, "\\n")));
    return result;
  }
  assert.ok(request.prompt.includes("Written copy, which may differ from the picture"));
  return { ...result, text: JSON.stringify({ issues: [], summary: "Text and image review complete." }) };
} } });
assert.equal(calls, 2);
assert.equal(good.decision.issues[0].policySource, "Fictional policy");
assert.equal(good.decision.issues[0].rule, item.sourceQuote);
assert.equal(good.decision.issues[0].recommendedCorrection, item.improvement);
assert.equal(good.decision.issues[0].basis, "human_judgement");
const failed = await decideCompliance({ ...base, llm: { request: async () => ({ ...result, status: "unconfigured", text: null }) } });
assert.ok(failed.decision.issues.some(i => i.explanation.includes("could not be completed")));
assert.equal(failed.trace.path, "deterministic_fallback");
console.log("PASS campaign integration: deterministic fallback, document evidence and multimodal review are merged; failed coverage escalates.");
