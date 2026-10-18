import { randomUUID } from "node:crypto";
import type { ComplianceSubmission } from "./service";
import type { RuleSelection } from "./rules";
import type { ComplianceIssue } from "../runtime/types";
export function checkSubmission(s: ComplianceSubmission, selection: RuleSelection): { issues: ComplianceIssue[]; limitations: string[] } {
  const issues: ComplianceIssue[] = [];
  const limitations = [...s.limitations, ...selection.problems];
  const add = (category: ComplianceIssue["category"], excerpt: string, explanation: string, correction: string, basis: ComplianceIssue["basis"], rule: string, source: string, date: string, severity: ComplianceIssue["severity"] = "medium") => {
    issues.push({ id: randomUUID(), category, excerpt, explanation, recommendedCorrection: correction, basis, rule, policySource: source, policyDate: date, severity });
  };
  for (const ad of s.content) {
    const content = `${ad.headline}\n${ad.body}\n${ad.caption}\n${ad.callToAction}`;
    const lower = content.toLowerCase();
    for (const term of s.brandAssets.bannedTerms.filter(t => t.trim())) if (lower.includes(term.toLowerCase()))
      add("brand_guideline", `${ad.creativeId}: ${term}`, "This wording is explicitly banned in the submitted retailer guidelines.", "Remove the banned wording and resubmit a new version.", "confirmed_breach", "retailer.banned-terms", "Submitted retailer policy snapshot", selection.checkedAt.slice(0, 10), "high");
    const unsupported = content.match(/\b(guaranteed|clinically proven|best|number one|miracle|healthiest)\b/gi);
    if (unsupported) add("unsupported_claim", `${ad.creativeId}: ${[...new Set(unsupported)].join(", ")}`, "Objective or absolute claim requires supporting evidence; no verified evidence ledger is supplied.", "Provide substantiation or replace with a verifiable product fact.", "human_judgement", "review.claim-evidence", "Internal review completeness check", "", "high");
    if (/\b(sale|discount|free|\d+% off)\b/i.test(content) && !/\b(terms|until|ends|conditions|while stocks last)\b/i.test(content))
      add("missing_condition", ad.creativeId, "Promotional wording has no detected conditions or validity period.", "Provide and verify applicable promotional conditions.", "human_judgement", "review.promotion", "Internal review completeness check", "");
    const prices = content.match(/[$£€]\s*\d+(?:\.\d{2})?/g) ?? [];
    if (prices.length) add("price_accuracy", `${ad.creativeId}: ${prices.join(", ")}`, "Advertised prices cannot be verified against an authoritative product price record.", "Verify prices and provide the product-price evidence.", "human_judgement", "review.price", "Internal review completeness check", "");
    if (ad.imageUrl) add("copyright", ad.creativeId, "Image ownership/licensing and embedded text have not been verified.", "Provide asset licence/ownership evidence and review the image.", "human_judgement", "review.asset-rights", "Internal review completeness check", "");
    if (/\b(children|minors|under.?18|kids)\b/i.test(s.targetAudience)) add("audience_targeting", s.targetAudience, "Campaign targets a potentially protected age group.", "Obtain an audience-specific policy and human targeting review.", "human_judgement", "review.audience", "Internal review completeness check", "", "high");
    for (const rule of selection.rules) {
      const matches = rule.terms.filter(t => lower.includes(t.toLowerCase()));
      const missing = rule.terms.filter(t => !lower.includes(t.toLowerCase()));
      if (rule.mode === "manual" || (rule.mode === "forbidden_phrase" && matches.length) || (rule.mode === "required_phrase" && missing.length))
        add(rule.category, `${ad.creativeId}: ${(rule.mode === "required_phrase" ? missing : matches).join(", ") || "whole advertisement"}`, rule.reason, rule.correction,
          rule.mode === "manual" ? "human_judgement" : "confirmed_breach", rule.id, rule.source, rule.effectiveDate, rule.severity);
    }
  }
  limitations.push("Automated checks inspect supplied text and configured rules; image interpretation, legal applicability and independent evidence verification require human review where uncertain.");
  return { issues, limitations: [...new Set(limitations)] };
}
