import type { ComplianceIssue } from "@/lib/runtime/types";

export function ComplianceFindingDetails({ finding, excerpt, number, mode }: {
  finding: ComplianceIssue;
  excerpt: string;
  number: number;
  mode: "issue" | "improvement";
}) {
  if (mode === "improvement") {
    return (
      <article className="rounded border border-line bg-surface p-4">
        <h4 className="font-medium">{number}. Recommended change</h4>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{finding.recommendedCorrection}</p>
      </article>
    );
  }

  const sourceIsLink = !!finding.sourceUrl && /^https?:\/\//.test(finding.sourceUrl);
  return (
    <article className="rounded border border-line bg-surface p-4">
      <h4 className="font-medium">{number}. {excerpt}</h4>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">{finding.explanation}</p>
      <p className="mt-3 text-sm">
        <span className="text-mute">Source: </span>
        {sourceIsLink ? (
          <a href={finding.sourceUrl} target="_blank" rel="noreferrer" className="font-medium text-signal underline underline-offset-2">
            {finding.policySource}
          </a>
        ) : (
          <span className="font-medium">{finding.policySource}</span>
        )}
      </p>
    </article>
  );
}
