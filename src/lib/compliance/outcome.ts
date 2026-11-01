import type { ComplianceOutcome } from "../runtime/types";

/**
 * Guard rails on a compliance agent's structured answer.
 *
 * These rules do not read the advertisement. They only accept, or refuse to
 * pass, the outcome the agent already returned:
 * - no usable answer is not a pass
 * - a pass that still lists issues is not a pass
 * - a rewrite with no issues is not a coherent answer
 * - missing authorised policy cannot be cleared
 * - the revision cap stops the automatic loop after the third revised draft is reviewed
 */
export function resolveReviewOutcome(input: {
  agentOutcome: ComplianceOutcome | null;
  issueCount: number;
  policyProblems: readonly string[];
  attempt: number;
  maxAttempts: number;
}): ComplianceOutcome {
  if (input.agentOutcome == null) return "manual_review";
  if (input.agentOutcome === "pass" && (input.issueCount > 0 || input.policyProblems.length > 0)) return "manual_review";
  // Attempt 1 reviews the initial draft. Failures on attempts 1–3 each produce
  // one revised draft. Attempt 4 reviews the third revised draft and escalates.
  if (input.agentOutcome === "changes_required" && (input.issueCount === 0 || input.attempt > input.maxAttempts || input.policyProblems.length > 0)) {
    return "manual_review";
  }
  return input.agentOutcome;
}
