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
 * - the revision cap stops the automatic loop
 */
export function resolveReviewOutcome(input: {
  agentOutcome: ComplianceOutcome | null;
  issueCount: number;
  policyProblems: readonly string[];
  attempt: number;
  maxAttempts: number;
}): ComplianceOutcome {
  if (input.policyProblems.length > 0 || input.agentOutcome == null) return "manual_review";
  if (input.agentOutcome === "pass" && input.issueCount > 0) return "manual_review";
  if (input.agentOutcome === "changes_required" && (input.issueCount === 0 || input.attempt >= input.maxAttempts)) {
    return "manual_review";
  }
  return input.agentOutcome;
}
