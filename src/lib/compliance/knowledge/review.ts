import { readFileSync } from "node:fs";
import { z } from "zod";
import { KnowledgeStore } from "./store";
import type { ComplianceSubmission } from "../service";
import type { ReviewSource } from "../document-review";
import type { ComplianceRule } from "../rules";

export type ReviewEvidence = { sources: ReviewSource[]; problems: string[]; retrievedAt: string };

/** Retrieve original local passages. Registry summaries are search hints, never evidence. */
export function loadReviewEvidence(submission: ComplianceSubmission, rules: ComplianceRule[], now: string): ReviewEvidence {
  const sources: ReviewSource[] = [];
  const problems: string[] = [];
  let store: KnowledgeStore | undefined;
  try {
    const file = process.env.AISLE_COMPLIANCE_KB_SOURCES_FILE ?? "data/compliance-sources.json";
    const config = z.object({ authorisedSources: z.array(z.url()).min(1) }).parse(JSON.parse(readFileSync(file, "utf8")));
    store = new KnowledgeStore();
    const queries = [...submission.content.flatMap(ad => [ad.headline, ad.body, ad.caption, ad.callToAction]),
      submission.productInformation, ...rules.map(rule => rule.reason)].filter(Boolean);
    const seen = new Set<string>();
    for (const platform of submission.targetPlatforms) for (const query of queries) {
      const result = store.search(query, { jurisdiction: submission.country, platform, now, authorisedSources: config.authorisedSources });
      // An individual search miss is normal; absence of legal evidence is checked below.
      problems.push(...result.problems.filter(problem => !problem.startsWith("No matching") && !problem.startsWith("No eligible")));
      for (const passage of result.passages) {
        if (seen.has(passage.citationId)) continue;
        seen.add(passage.citationId);
        sources.push({ id: passage.citationId, name: passage.document.title, text: passage.text,
          version: passage.document.version, uploadedAt: passage.document.downloadedAt, truncated: false,
          sourceUrl: passage.document.sourceUrl, location: passage.location, kind: passage.document.kind,
          jurisdiction: passage.document.jurisdiction, effectiveFrom: passage.document.effectiveFrom });
      }
    }
  } catch (error) {
    problems.push(error instanceof Error ? error.message : "The local legal documents could not be read.");
  } finally { store?.close(); }
  if (!sources.some(source => source.kind === "legislation")) problems.push(`No applicable local legislation was retrieved for ${submission.country}. Import and verify local advertising law before completing this review.`);
  for (const document of submission.brandAssets.guidelines) sources.push({ id: `upload:${document.id}`, name: document.name,
    text: document.text, version: submission.advertisementVersionId, uploadedAt: now, truncated: false, kind: "brand_policy" });
  return { sources, problems: [...new Set(problems)], retrievedAt: now };
}
