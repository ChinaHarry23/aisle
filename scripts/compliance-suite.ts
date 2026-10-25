import assert from "node:assert/strict";
import { beginReview, submissionFor, parseSubmission, ComplianceSubmissionError } from "../src/lib/compliance/service";
import { blankCampaign, defaultBrand } from "../src/lib/seed";
import { defaultSettings } from "../src/lib/settings";
import { copyFromBrief } from "../src/lib/media/brief-copy";
import { buildCreatives } from "../src/lib/runtime/steps";
import { runEngine } from "../src/lib/runtime/engine";
import type { Campaign } from "../src/lib/types";
import type { LlmRuntime } from "../src/lib/runtime/decide";
import { writeFileSync } from "node:fs";
const now = "2026-10-17T00:00:00.000Z";
function fixture(): Campaign {
  const c = blankCampaign({ name: "Compliance test", product: "Cotton shirt", category: "Apparel", targetAudience: "Adults", objective: "Product awareness", budget: 500, channels: ["web"], startDate: "2026-10-17", endDate: "2026-10-20", country: "AU", notes: "" }, defaultBrand, null, defaultSettings());
  c.id = "campaign-example"; c.createdAt = now;
  const brief = { product: c.product, angle: "Everyday wear", audience: c.targetAudience, channels: c.channels, keyMessage: "Cotton shirt", claimsAllowed: [], claimsAvoid: [], visualDirection: "Simple product shot" };
  c.brief = brief;
  c.creatives = buildCreatives(c, Object.values(copyFromBrief(c)), 1).map((cr, i) => ({ ...cr, id: `creative-${i}`, createdAt: now }));
  c.status = "generating";
  c.run = { id: "pipeline-example", campaignId: c.id, status: "running", step: "compliance.receive", startedAt: now, updatedAt: now, stepsTaken: 0, maxSteps: 40, toolsUsed: [], revisionAttempts: 0, awaiting: null, awaitingDetail: null, haltedReason: null };
  return c;
}
const c = fixture();
const submission = submissionFor(c, defaultBrand);
assert.deepEqual(parseSubmission(submission), submission);
for (const field of ["campaignId", "advertisementVersionId", "content", "productInformation", "brandAssets", "campaignObjective", "targetAudience", "country", "targetPlatforms"] as const) {
  const invalid = { ...submission, [field]: undefined };
  assert.throws(() => parseSubmission(invalid), ComplianceSubmissionError);
}
assert.throws(() => parseSubmission({ ...submission, content: [{ ...submission.content[0], createdAt: "yesterday" }] }), ComplianceSubmissionError);
assert.throws(() => parseSubmission({ ...submission, content: [submission.content[0], submission.content[0]] }), /unique/);
assert.notEqual(submissionFor(c, { ...defaultBrand, bannedTerms: [...defaultBrand.bannedTerms, "extra"] }).advertisementVersionId, submission.advertisementVersionId);
const mixed = fixture(); mixed.creatives[1].version = 2;
assert.throws(() => submissionFor(mixed, defaultBrand), /one version/);
const run = beginReview(c, defaultBrand, submission, now);
assert.equal(run.attemptNumber, 1);
assert.equal(run.status, "UNDER_REVIEW");
assert.equal(beginReview(c, defaultBrand, submission, now).reviewId, run.reviewId);
assert.equal(c.complianceReviewRuns?.length, 1);
c.creatives[0].headline = "changed";
assert.notEqual(submissionFor(c, defaultBrand).advertisementVersionId, submission.advertisementVersionId);
assert.notEqual(run.submission.content[0].headline, "changed");
assert.throws(() => beginReview(c, defaultBrand, submission, now), /does not match/);
for (const status of ["paused", "published", "scheduled", "rejected"] as const) {
  const blocked = fixture(); blocked.status = status;
  assert.throws(() => beginReview(blocked, defaultBrand, submissionFor(blocked, defaultBrand), now), /Only the running/);
}
let calls = 0;
const llm: LlmRuntime = { request: async () => { calls++; throw new Error("provider unavailable"); } };
const original = fixture();
const accepted = await runEngine({ campaigns: [original], now }, original, { type: "ADVANCE", actor: "founder" }, defaultSettings(), defaultBrand, { llm, maxSteps: 1 });
assert.equal(calls, 0, "registration must checkpoint before calling a provider");
assert.equal(accepted.campaign.run?.step, "compliance.review");
assert.equal(accepted.campaign.status, "compliance");
assert.equal(accepted.campaign.founderDecision, null);
assert.equal(accepted.campaign.channelVersions.length, 0);
assert.equal(accepted.campaign.complianceReviewRuns?.[0].status, "UNDER_REVIEW");
const restored = JSON.parse(JSON.stringify(accepted.campaign)) as Campaign;
await assert.rejects(() => runEngine({ campaigns: [restored], now }, restored, { type: "ADVANCE", actor: "founder" }, defaultSettings(), defaultBrand, { llm, maxSteps: 1 }), /provider unavailable/);
assert.equal(restored.complianceReviewRuns?.[0].status, "UNDER_REVIEW", "persisted checkpoint survives a provider failure");
const invalid = fixture(); invalid.creatives = [];
const rejected = await runEngine({ campaigns: [invalid], now }, invalid, { type: "ADVANCE", actor: "founder" }, defaultSettings(), defaultBrand, { llm, maxSteps: 1 });
assert.equal(rejected.canAdvance, false);
assert.equal(rejected.campaign.complianceReviewRuns?.length ?? 0, 0);
assert.match(rejected.message, /INVALID_SUBMISSION/);
assert.equal(calls, 1);
if (process.argv.includes("--examples")) {
  writeFileSync("docs/contracts/examples/compliance-valid.json", JSON.stringify(submission, null, 2) + "\n");
  writeFileSync("docs/contracts/examples/compliance-invalid.json", JSON.stringify({ ...submission, content: [], targetPlatforms: [] }, null, 2) + "\n");
}
console.log("PASS CC-01/02: contract validation, immutable snapshot, exact version/context, duplicate registration, permission checks, graph checkpoint, provider failure, invalid submission, no approval/distribution.");
