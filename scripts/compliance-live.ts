/** Explicitly opted-in smoke test. Uses synthetic ads, saved local law and the production decision adapter. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSubmission } from "../src/lib/compliance/service";
import { loadRules } from "../src/lib/compliance/rules";
import { loadReviewEvidence } from "../src/lib/compliance/knowledge/review";
import { decideCompliance } from "../src/lib/runtime/decide";
import { runComplete } from "../src/lib/llm/metered-complete";
import { defaultSettings } from "../src/lib/settings";
import { blankCampaign, defaultBrand } from "../src/lib/seed";
import { buildReport } from "../src/lib/compliance/report";

if (!process.argv.includes("--live")) throw new Error("Use --live to authorise paid API calls with synthetic test advertisements.");
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured in this process.");
const now = new Date().toISOString();
const settings = defaultSettings();
if (process.env.AISLE_COMPLIANCE_TEST_MODEL) settings.agents.compliance.modelId = process.env.AISLE_COMPLIANCE_TEST_MODEL;
const cases = [
  { name: "unsupported-claim", headline: "Our oranges are clinically proven to cure colds.", body: "Buy fresh oranges today.", caption: "Guaranteed to prevent illness.", product: "Fresh oranges. No clinical studies or medical evidence are provided." },
  { name: "ordinary-copy", headline: "Fresh oranges for your weekly shop.", body: "Explore our range of fresh produce.", caption: "Choose oranges for your fruit bowl.", product: "Fresh oranges sold as ordinary food. No health or therapeutic claims." },
];
const results: unknown[] = [];
const output = process.env.AISLE_COMPLIANCE_TEST_OUTPUT ?? join(tmpdir(), "aisle-compliance-live-results.json");
for (const test of cases) {
  const submission = parseSubmission(JSON.parse(readFileSync("docs/contracts/examples/compliance-valid.json", "utf8")));
  submission.brandAssets.guidelines = [];
  submission.brandAssets.bannedTerms = [];
  submission.productInformation = test.product;
  submission.targetAudience = "Adults";
  submission.targetPlatforms = ["web"];
  submission.content = [{ ...submission.content[0], headline: test.headline, body: test.body, caption: test.caption, callToAction: "Browse oranges", imageUrl: null, createdAt: now }];
  const evidence = loadReviewEvidence(submission, loadRules(submission, now).rules, now);
  assert.ok(evidence.sources.some(s => s.kind === "legislation"), "No local legislation retrieved; not running an evidence-free live test.");
  const brand = { ...defaultBrand, bannedTerms: [], approvedTerms: [], guidelines: [] };
  const campaign = blankCampaign({ name: `Synthetic live test: ${test.name}`, product: test.product, category: "Grocery", targetAudience: "Adults", objective: "Product awareness", budget: 20, channels: ["web"], startDate: now.slice(0,10), endDate: now.slice(0,10), country: "AU", notes: "Synthetic test; never publish." }, brand, null, settings);
  const copy = [test.headline, test.body, test.caption, "Browse oranges"].join("\n");
  console.log(`Running ${test.name}: ${evidence.sources.length} local source passages, model ${settings.agents.compliance.modelId}.`);
  const result = await decideCompliance({ campaign, brand, settings, copy, attempt: 1, evidence,
    llm: { request: async req => {
      const response = await runComplete(req, { kind: "unmetered", reason: "Owner-authorised live compliance smoke test with synthetic ads" });
      if (response.status !== "ok") throw new Error(`Live provider failed (${response.status}): ${response.note}`);
      assert.equal(response.providerId, "openai", "Must test OpenAI, not a silent fallback provider.");
      writeFileSync(join(tmpdir(), `aisle-compliance-${test.name}-response.json`), JSON.stringify(response, null, 2));
      return response;
    } },
  });
  assert.equal(result.trace.path, "live_model", "Model response must pass the production comparison parser.");
  const report = buildReport({ reviewId: test.name, campaignId: campaign.id, advertisementVersionId: submission.advertisementVersionId, pipelineRunId: "live-test", status: "UNDER_REVIEW", startedAt: now, attemptNumber: 1, submission, evidence }, result.decision.issues, result.decision.limitations ?? [], test.name, now, result.decision.scopeNotes);
  results.push({ case: test.name, advertisement: copy, model: result.trace.modelId, usage: result.trace.usage, sourceCount: evidence.sources.length, report, summary: result.decision.summary });
  writeFileSync(output, JSON.stringify({ generatedAt: now, synthetic: true, results }, null, 2));
  console.log(JSON.stringify({ case: test.name, status: report.status, summary: result.decision.summary, findings: result.decision.issues, limitations: result.decision.limitations }, null, 2));
}
console.log(`Saved live evidence: ${output}`);
