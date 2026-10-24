import { ComplianceFindingDetails } from "./ComplianceFindingDetails";
import { excerptFormatter } from "@/lib/compliance/presentation";
import type { Campaign } from "@/lib/types";
import { formatDate } from "@/lib/ids";

const statusLabels = {
  PASSED: "Checks passed — human approval required",
  CHANGES_REQUIRED: "Changes required",
  MANUAL_REVIEW_REQUIRED: "Manual review required",
};

function displayTime(value?: string | null) {
  return value ? formatDate(value, true) : "Pending";
}

/** Saved snapshots only: historic reports never display a newer draft as their input. */
export function ComplianceReviewHistory({ campaign }: { campaign: Campaign }) {
  const runs = campaign.complianceReviewRuns ?? [];
  if (!runs.length) return <p className="text-sm text-mute">No version-bound review records yet. A new compliance submission will appear here.</p>;
  return <section className="flex flex-col gap-4" aria-label="Compliance review history">
    <div><h2 className="font-serif text-xl">Compliance reports</h2>
      <p className="text-sm text-mute">Each report belongs to the saved advertisement version shown below.</p></div>
    {[...runs].reverse().map((run, index) => {
      const report = run.report;
      const policyProblems = report?.policyProblems ?? run.evidence?.problems ?? run.ruleSelection?.problems ?? [];
      const explainExcerpt = excerptFormatter(run.submission.content);
      return <details key={run.reviewId} open={index === 0} className="rounded border border-line bg-surface p-4">
        <summary className="cursor-pointer font-medium">Review {run.attemptNumber} · v{run.submission.version} · {report ? statusLabels[report.status] : run.status === "UNDER_REVIEW" ? "Review pending" : "Legacy review completed"}</summary>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-mute">Review round</dt><dd>Review {run.attemptNumber}</dd></div>
          <div><dt className="text-mute">Advertisement version</dt><dd>Version {run.submission.version}</dd></div>
          <div><dt className="text-mute">Review started</dt><dd>{displayTime(run.startedAt)}</dd></div>
          <div><dt className="text-mute">Report generated</dt><dd>{displayTime(report?.generatedAt ?? run.completedAt)}</dd></div>
        </dl>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-mute">Technical IDs</summary>
          <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
            <div><dt className="text-mute">Review ID</dt><dd className="break-all">{run.reviewId}</dd></div>
            <div><dt className="text-mute">Submitted version ID</dt><dd className="break-all">{run.advertisementVersionId}</dd></div>
          </dl>
        </details>
        {report && <p className="mt-4 font-medium">{report.unresolvedCount} unresolved · {report.confirmedViolationCount} AI-identified conflicts · {report.humanJudgementCount} need confirmation</p>}
        {policyProblems.length ? <div className="mt-4 border-l-4 border-amber-500 p-3"><h3 className="font-medium">Policy information needs attention</h3><ul className="list-disc pl-5 text-sm">{policyProblems.map(p => <li key={p}>{p}</li>)}</ul></div> : null}
        {(report?.findings ?? run.result?.findings ?? []).length ? <div className="mt-5 grid gap-6 lg:grid-cols-2">
          <section>
            <h3 className="mb-3 font-serif text-lg">Issues</h3>
            <div className="flex flex-col gap-3">
              {(report?.findings ?? run.result?.findings ?? []).map((finding, i) =>
                <ComplianceFindingDetails key={`${finding.id}-issue-${i}`} finding={finding} excerpt={explainExcerpt(finding.excerpt)} number={i + 1} mode="issue" />)}
            </div>
          </section>
          <section>
            <h3 className="mb-3 font-serif text-lg">Improvements</h3>
            <div className="flex flex-col gap-3">
              {(report?.findings ?? run.result?.findings ?? []).map((finding, i) =>
                <ComplianceFindingDetails key={`${finding.id}-improvement-${i}`} finding={finding} excerpt={explainExcerpt(finding.excerpt)} number={i + 1} mode="improvement" />)}
            </div>
          </section>
        </div> : null}
        <details className="mt-4"><summary className="cursor-pointer text-sm font-medium">Reviewed advertisement snapshot</summary>
          {run.submission.content.map((ad, advertisementIndex) => <article key={ad.creativeId} className="mt-3 border border-line p-3"><p className="text-xs text-mute">Advertisement {String.fromCharCode(65 + advertisementIndex)}</p><h4 className="font-medium">{ad.headline}</h4><p>{ad.body}</p><p className="text-sm">{ad.caption}</p><p className="text-sm">{ad.callToAction}</p></article>)}
        </details>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium">Sources supplied to this review ({run.evidence?.sources.length ?? 0})</summary>
          {run.evidence ? run.evidence.sources.map(source => <div key={source.id} className="mt-3 text-sm"><p className="font-medium">{source.name} · {source.version}</p><p className="text-xs text-mute">{source.location}</p><blockquote className="mt-1 border-l-2 border-line pl-3">{source.text}</blockquote></div>) : <p className="mt-2 text-sm text-mute">This older review did not retain local legal passages. Run a new review for source-backed feedback.</p>}
        </details>
        {!!report?.scopeNotes?.length && <details className="hairline p-4 text-sm"><summary className="cursor-pointer font-medium">Review scope</summary><ul className="mt-2 list-disc pl-5 text-mute">{report.scopeNotes.map(note => <li key={note}>{note}</li>)}</ul></details>}
        {(report?.limitations ?? run.result?.limitations ?? run.submission.limitations).length > 0 && <div className="mt-4"><h3 className="text-sm font-medium">Known limitations</h3><ul className="list-disc pl-5 text-sm text-mute">{(report?.limitations ?? run.result?.limitations ?? run.submission.limitations).map(l => <li key={l}>{l}</li>)}</ul></div>}
      </details>;
    })}
  </section>;
}
