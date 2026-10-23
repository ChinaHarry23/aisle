import type { StructuredComplianceReport } from "./report";
/** CC-01/02: server-side submission boundary. No approval or delivery capability. */
import type { RuleSelection } from "./rules";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { BrandProfile, Campaign } from "../types";
import type { ComplianceIssue, ComplianceOutcome } from "../runtime/types";

const text = z.string().trim().min(1);
export const submissionSchema = z.object({
  campaignId: text,
  advertisementVersionId: text,
  version: z.number().int().positive(),
  content: z.array(z.object({
    creativeId: text, headline: text, body: text, caption: z.string(),
    callToAction: text, imageUrl: z.string().nullable(),
    createdAt: z.iso.datetime(), generationInputs: z.object({ prompt: text }),
  })).min(1),
  productInformation: text,
  brandAssets: z.object({ retailerName: text, logoUrl: z.string().nullable(),
    guidelines: z.array(z.object({ id: text, name: text, text: z.string() })),
    bannedTerms: z.array(z.string()), approvedTerms: z.array(z.string()), countryRule: z.string() }),
  campaignObjective: text,
  targetAudience: text,
  country: z.enum(["AU", "NZ", "UK", "US"]),
  targetPlatforms: z.array(z.enum(["instagram", "web", "email", "print", "digital_signage"])).min(1),
  limitations: z.array(z.string()),
}).strict();
export type ComplianceSubmission = z.infer<typeof submissionSchema>;
export type ComplianceReviewRun = {
  reviewId: string;
  campaignId: string;
  advertisementVersionId: string;
  pipelineRunId: string;
  status: "UNDER_REVIEW" | "COMPLETED";
  startedAt: string;
  completedAt?: string;
  attemptNumber: number;
  submission: ComplianceSubmission;
  ruleSelection?: RuleSelection;
  report?: StructuredComplianceReport;
  result?: {
    status: ComplianceOutcome;
    findings: ComplianceIssue[];
    rejectionReason: string | null;
    limitations: string[];
    reportId: string;
  };
};
export class ComplianceSubmissionError extends Error {
  code: "INVALID_SUBMISSION" | "REVIEW_NOT_AUTHORISED" | "VERSION_MISMATCH";
  fields: { field: string; message: string }[];
  constructor(code: ComplianceSubmissionError["code"], message: string, fields: ComplianceSubmissionError["fields"] = []) {
    super(message); this.name = "ComplianceSubmissionError"; this.code = code; this.fields = fields;
  }
  toJSON() { return { code: this.code, message: this.message, fields: this.fields }; }
}
export function parseSubmission(value: unknown): ComplianceSubmission {
  const parsed = submissionSchema.safeParse(value);
  if (!parsed.success) throw new ComplianceSubmissionError("INVALID_SUBMISSION", "Compliance submission is incomplete or invalid.",
    parsed.error.issues.map(i => ({ field: i.path.join("."), message: i.message })));
  const ids = parsed.data.content.map(c => c.creativeId);
  if (new Set(ids).size !== ids.length) throw new ComplianceSubmissionError("INVALID_SUBMISSION", "Creative IDs must be unique.");
  return parsed.data;
}
/** Hash the exact content AND review context; never use a version number alone. */
export function versionId(submission: Omit<ComplianceSubmission, "advertisementVersionId">): string {
  return `adv_${createHash("sha256").update(JSON.stringify(submission)).digest("hex")}`;
}
export function submissionFor(c: Campaign, brand: BrandProfile): ComplianceSubmission {
  const versions = new Set(c.creatives.map(cr => cr.version));
  if (versions.size !== 1) throw new ComplianceSubmissionError("INVALID_SUBMISSION", "Submit a non-empty batch with one version number.");
  const limitations = c.creatives.some(cr => !cr.createdAt)
    ? ["Legacy creative creation time unavailable; campaign creation time used explicitly as a fallback."] : [];
  const input = {
    campaignId: c.id, version: c.creatives[0].version,
    content: c.creatives.map(cr => ({ creativeId: cr.id, headline: cr.headline, body: cr.subhead,
      caption: cr.caption, callToAction: cr.cta, imageUrl: cr.generation?.url ?? null,
      createdAt: cr.createdAt ?? c.createdAt, generationInputs: { prompt: cr.prompt } })),
    productInformation: c.product,
    brandAssets: { retailerName: brand.retailerName, logoUrl: brand.logoUrl ?? null,
      guidelines: (brand.guidelines ?? []).map(d => ({ id: d.id, name: d.name, text: d.text })),
      bannedTerms: brand.bannedTerms, approvedTerms: brand.approvedTerms, countryRule: brand.countryRules[c.country] ?? "" },
    campaignObjective: c.objective, targetAudience: c.targetAudience, country: c.country,
    targetPlatforms: c.channels, limitations,
  };
  return parseSubmission({ ...input, advertisementVersionId: versionId(input) });
}
export function assertReviewPermission(c: Campaign) {
  if (!c.run || c.run.status !== "running" || !["compliance.receive", "compliance.review"].includes(c.run.step)
    || !["generating", "revising", "compliance"].includes(c.status)
    || c.creatives.some(cr => cr.status === "approved" || cr.status === "rejected")) {
    throw new ComplianceSubmissionError("REVIEW_NOT_AUTHORISED", "Only the running orchestration compliance stage may submit unpublished drafts.");
  }
}
export function beginReview(c: Campaign, brand: BrandProfile, raw: unknown, now: string): ComplianceReviewRun {
  assertReviewPermission(c);
  const submission = parseSubmission(raw);
  const expected = submissionFor(c, brand);
  if (JSON.stringify(submission) !== JSON.stringify(expected))
    throw new ComplianceSubmissionError("VERSION_MISMATCH", "Submission does not match the current advertisement and campaign context.");
  const existing = c.complianceReviewRuns?.find(r => r.pipelineRunId === c.run!.id && r.advertisementVersionId === submission.advertisementVersionId);
  if (existing) return existing;
  const run: ComplianceReviewRun = {
    reviewId: randomUUID(), campaignId: c.id, advertisementVersionId: submission.advertisementVersionId,
    pipelineRunId: c.run!.id, status: "UNDER_REVIEW", startedAt: now,
    attemptNumber: Math.max(c.complianceAttempts.length, ...(c.complianceReviewRuns ?? []).map(r => r.attemptNumber)) + 1,
    submission: structuredClone(submission),
  };
  c.complianceReviewRuns = [...(c.complianceReviewRuns ?? []), run];
  return run;
}
