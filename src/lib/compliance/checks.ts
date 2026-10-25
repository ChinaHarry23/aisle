import type { ComplianceSubmission } from "./service";
import type { RuleSelection } from "./rules";
/**
 * Records what this step does not decide.
 *
 * Phrase, price, image and claim matches are not applied here. The compliance
 * agent reviews the advertisement against the retrieved law passages. This
 * function must not invent findings or a pass.
 */
export function checkSubmission(
  s: ComplianceSubmission,
  selection: RuleSelection,
): { limitations: string[] } {
  const limitations = [
    ...s.limitations,
    ...selection.problems,
    "No phrase, price, image, or claim scan is applied in code. The compliance agent reviews the submitted advertisement against the rules it was given.",
  ];
  return { limitations: [...new Set(limitations)] };
}
