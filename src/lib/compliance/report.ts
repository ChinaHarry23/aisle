import type { ComplianceIssue } from "../runtime/types";
import type { ComplianceReviewRun } from "./service";
export type StructuredComplianceReport = {
  id: string;
  reviewId: string;
  advertisementVersionId: string;
  generatedAt: string;
  attemptNumber: number;
  status: "PASSED" | "CHANGES_REQUIRED" | "MANUAL_REVIEW_REQUIRED";
  findings: (ComplianceIssue & { resolved: false })[];
  unresolvedCount: number;
  confirmedViolationCount: number;
  humanJudgementCount: number;
  policyProblems: string[];
  limitations: string[];
  scopeNotes?: string[];
};
/** No implicit resolution: all newly produced findings remain unresolved. */
export function buildReport(run: ComplianceReviewRun, findings: ComplianceIssue[], limitations: string[], id: string, generatedAt: string, scopeNotes: string[] = []): StructuredComplianceReport {
  const retained = structuredClone(findings).map(f => ({ ...f, resolved: false as const }));
  const confirmedViolationCount = retained.filter(f => f.basis === "confirmed_breach").length;
  const humanJudgementCount = retained.length - confirmedViolationCount;
  const policyProblems = run.evidence?.problems ?? run.ruleSelection?.problems ?? ["No rule selection was retained."];
  const status = policyProblems.length || limitations.length || humanJudgementCount
    ? "MANUAL_REVIEW_REQUIRED" : confirmedViolationCount ? "CHANGES_REQUIRED" : "PASSED";
  return {
    id, reviewId: run.reviewId, advertisementVersionId: run.advertisementVersionId,
    generatedAt, attemptNumber: run.attemptNumber, status, findings: retained,
    unresolvedCount: retained.length, confirmedViolationCount, humanJudgementCount,
    scopeNotes: [...new Set(scopeNotes)],
    policyProblems: [...policyProblems], limitations: [...new Set([...limitations, ...policyProblems])],
  };
}
