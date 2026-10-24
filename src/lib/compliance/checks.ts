import type { ComplianceSubmission } from "./service";
import type { RuleSelection } from "./rules";
import type { ComplianceIssue } from "../runtime/types";
/** Input validation is separate from contextual AI legal interpretation. */
export function checkSubmission(s: ComplianceSubmission, selection: RuleSelection): { issues: ComplianceIssue[]; limitations: string[] } {
  void selection;
  return { issues: [], limitations: [...s.limitations] };
}
