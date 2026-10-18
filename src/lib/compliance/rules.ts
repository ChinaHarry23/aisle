/** Server-controlled policy registry. Uploaded ad text cannot authorise a source. */
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { ComplianceSubmission } from "./service";
const nonempty = z.string().trim().min(1);
export const ruleSchema = z.object({
  id: nonempty, source: nonempty, version: nonempty,
  type: z.enum(["advertising_law", "consumer_protection", "copyright", "ethics", "platform", "brand"]),
  jurisdiction: nonempty, effectiveDate: z.iso.date(), expiresAt: z.iso.date(),
  platforms: z.array(nonempty), audiencePattern: z.string().optional(), productPattern: z.string().optional(),
  category: z.enum(["misleading_claim", "unsupported_claim", "missing_condition", "price_accuracy", "copyright", "audience_targeting", "platform_policy", "brand_guideline", "inappropriate_content"]),
  mode: z.enum(["forbidden_phrase", "required_phrase", "manual"]),
  terms: z.array(nonempty), reason: nonempty, correction: nonempty,
  severity: z.enum(["low", "medium", "high"]), conflictsWith: z.array(nonempty).default([]),
});
export type ComplianceRule = z.infer<typeof ruleSchema>;
export type RuleSelection = { rules: ComplianceRule[]; problems: string[]; checkedAt: string };
export const registrySchema = z.object({ authorisedSources: z.array(nonempty), rules: z.array(ruleSchema) });
export function selectRules(raw: unknown, s: ComplianceSubmission, now: string): RuleSelection {
  const parsed = registrySchema.safeParse(raw);
  if (!parsed.success) return { rules: [], problems: ["Policy registry is missing or invalid; an authorised maintainer must configure it."], checkedAt: now };
  const { authorisedSources, rules } = parsed.data;
  const problems: string[] = [];
  const applicable = rules.filter(r => (r.jurisdiction === "*" || r.jurisdiction === s.country)
    && (!r.platforms.length || r.platforms.some(p => s.targetPlatforms.includes(p as typeof s.targetPlatforms[number])))
    && (!r.audiencePattern || s.targetAudience.toLowerCase().includes(r.audiencePattern.toLowerCase()))
    && (!r.productPattern || `${s.productInformation} ${s.campaignObjective}`.toLowerCase().includes(r.productPattern.toLowerCase())));
  const today = now.slice(0, 10);
  const selected = applicable.filter(r => {
    if (!authorisedSources.includes(r.source)) { problems.push(`Unauthorised source for ${r.id}.`); return false; }
    if (r.effectiveDate > today || r.expiresAt < today || r.effectiveDate > r.expiresAt) { problems.push(`Outdated or not yet effective rule: ${r.id}.`); return false; }
    if (r.mode !== "manual" && r.terms.length === 0) { problems.push(`Rule ${r.id} has no executable terms.`); return false; }
    return true;
  });
  const ids = selected.map(r => r.id);
  if (new Set(ids).size !== ids.length) problems.push("Conflicting rule versions share an ID.");
  for (const r of selected) {
    if (r.conflictsWith.some(id => ids.includes(id))) problems.push(`Conflicting policy: ${r.id}.`);
    if (selected.some(other => other.id !== r.id && other.mode !== r.mode && other.mode !== "manual" && r.mode !== "manual" && other.terms.some(t => r.terms.some(x => x.toLowerCase() === t.toLowerCase())))) problems.push(`Contradictory required/forbidden wording: ${r.id}.`);
  }
  for (const type of ["advertising_law", "consumer_protection", "copyright", "ethics", "brand"] as const)
    if (!selected.some(r => r.type === type)) problems.push(`Missing applicable ${type} policy.`);
  for (const platform of s.targetPlatforms)
    if (!selected.some(r => r.type === "platform" && r.platforms.includes(platform))) problems.push(`Missing policy for ${platform}.`);
  return { rules: structuredClone(selected), problems: [...new Set(problems)], checkedAt: now };
}
export function loadRules(s: ComplianceSubmission, now: string): RuleSelection {
  const path = process.env.AISLE_COMPLIANCE_RULES_FILE;
  if (!path) return selectRules(null, s, now);
  try { return selectRules(JSON.parse(readFileSync(path, "utf8")), s, now); }
  catch { return { rules: [], problems: ["Configured policy registry could not be read."], checkedAt: now }; }
}
