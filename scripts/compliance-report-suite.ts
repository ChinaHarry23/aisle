import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildReport } from "../src/lib/compliance/report";
import { parseSubmission, type ComplianceReviewRun } from "../src/lib/compliance/service";
import type { ComplianceIssue } from "../src/lib/runtime/types";
const now = "2026-10-17T00:00:00.000Z";
const submission = parseSubmission(JSON.parse(readFileSync("docs/contracts/examples/compliance-valid.json", "utf8")));
const run: ComplianceReviewRun = { reviewId: "review-test", campaignId: submission.campaignId, advertisementVersionId: submission.advertisementVersionId, pipelineRunId: "pipeline-test", status: "UNDER_REVIEW", startedAt: now, attemptNumber: 1, submission, ruleSelection: { rules: [], problems: [], checkedAt: now } };
const finding: ComplianceIssue = { id: "finding-test", category: "brand_guideline", basis: "confirmed_breach", severity: "low", excerpt: "claim", explanation: "Test restriction", rule: "fixture-rule", policySource: "fixture-only", policyDate: "2026-01-01", recommendedCorrection: "Remove claim" };
for (const severity of ["low", "medium", "high"] as const) {
  const report = buildReport(run, [{ ...finding, severity }], [], "report-test", now);
  assert.equal(report.status, "CHANGES_REQUIRED");
  assert.equal(report.unresolvedCount, 1);
  assert.equal(report.confirmedViolationCount, 1);
  assert.equal(report.findings[0].resolved, false);
  assert.equal(report.advertisementVersionId, submission.advertisementVersionId);
  assert.equal(report.generatedAt, now);
}
const manual = buildReport(run, [{ ...finding, basis: "human_judgement" }], ["Evidence unavailable"], "r", now);
assert.equal(manual.status, "MANUAL_REVIEW_REQUIRED");
assert.equal(manual.humanJudgementCount, 1);
assert.equal(manual.confirmedViolationCount, 0);
assert.deepEqual(manual.limitations, ["Evidence unavailable"]);
assert.equal(buildReport(run, [], [], "r", now).status, "PASSED");
assert.equal(buildReport({ ...run, ruleSelection: { rules: [], problems: ["Missing policy"], checkedAt: now } }, [], [], "r", now).status, "MANUAL_REVIEW_REQUIRED");
assert.equal(buildReport({ ...run, ruleSelection: undefined }, [], [], "r", now).status, "MANUAL_REVIEW_REQUIRED");
const captured = buildReport(run, [finding], [], "r", now);
finding.excerpt = "mutated after review";
assert.equal(captured.findings[0].excerpt, "claim");
assert.deepEqual(JSON.parse(JSON.stringify(captured)), captured);
console.log("PASS CC-05: all severity levels block pass, judgement escalates, clean report passes, missing policy blocks, exact version/time retained, findings copied and serialisable.");

assert.equal(buildReport(run, [], ["AI comparison unavailable"], "r", now).status, "MANUAL_REVIEW_REQUIRED");
assert.equal(buildReport({ ...run, evidence: { sources: [], problems: ["No local law"], retrievedAt: now } }, [], [], "r", now).status, "MANUAL_REVIEW_REQUIRED");

assert.equal(buildReport(run, [], [], "r", now, ["Text-only review scope"]).status, "PASSED");
