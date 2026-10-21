import type { Campaign } from "@/lib/types";

const statusLabels = {
  PASSED: "Checks passed — human approval required",
  CHANGES_REQUIRED: "Changes required",
  MANUAL_REVIEW_REQUIRED: "Manual review required",
};
/** Saved snapshots only: historic reports never display a newer draft as their input. */
export function ComplianceReviewHistory({ campaign }: { campaign: Campaign }) {
  const runs = campaign.complianceReviewRuns ?? [];
  if (!runs.length) return <p className="text-sm text-mute">No version-bound review records yet. A new compliance submission will appear here.</p>;
  return <section className="flex flex-col gap-4" aria-label="Compliance review history">
    <div><h2 className="font-serif text-xl">Compliance reports</h2>
      <p className="text-sm text-mute">Each report belongs to the saved advertisement version shown below.</p></div>
    {[...runs].reverse().map((run, index) => {
      const report = run.report;
      return <details key={run.reviewId} open={index === 0} className="rounded border border-line bg-surface p-4">
        <summary className="cursor-pointer font-medium">Review {run.attemptNumber} · v{run.submission.version} · {report ? statusLabels[report.status] : run.status === "UNDER_REVIEW" ? "Review pending" : "Legacy review completed"}</summary>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-mute">Review ID</dt><dd className="break-all">{run.reviewId}</dd></div>
          <div><dt className="text-mute">Submitted version ID</dt><dd className="break-all">{run.advertisementVersionId}</dd></div>
          <div><dt className="text-mute">Started</dt><dd>{run.startedAt}</dd></div>
          <div><dt className="text-mute">Report generated</dt><dd>{report?.generatedAt ?? run.completedAt ?? "Pending"}</dd></div>
        </dl>
        {report && <p className="mt-4 font-medium">{report.unresolvedCount} unresolved · {report.confirmedViolationCount} confirmed violations · {report.humanJudgementCount} need human judgement</p>}
        {run.ruleSelection?.problems.length ? <div className="mt-4 border-l-4 border-amber-500 p-3"><h3 className="font-medium">Policy information needs attention</h3><ul className="list-disc pl-5 text-sm">{run.ruleSelection.problems.map(p => <li key={p}>{p}</li>)}</ul></div> : null}
        <div className="mt-4 flex flex-col gap-3">
          {(report?.findings ?? run.result?.findings ?? []).map((f, i) => <article key={`${f.id}-${i}`} className="rounded border border-line p-3">
            <p className="font-medium">{f.severity.toUpperCase()} · {f.category.replace(/_/g, " ")}</p>
            <p className="text-sm text-mute">{f.basis === "confirmed_breach" ? "Confirmed violation" : "Human judgement required"} · Unresolved</p>
            <blockquote className="my-2 break-words border-l-2 border-line pl-3">{f.excerpt}</blockquote>
            <p className="text-sm">{f.explanation}</p>
            {f.recommendedCorrection && <p className="mt-2 text-sm"><strong>Suggested correction: </strong>{f.recommendedCorrection}</p>}
            <p className="mt-2 break-words text-xs text-mute">Rule: {f.rule} · Source: {f.policySource} · Effective date: {f.policyDate || "Not verified"}</p>
          </article>)}
        </div>
        <details className="mt-4"><summary className="cursor-pointer text-sm font-medium">Reviewed advertisement snapshot</summary>
          {run.submission.content.map(ad => <article key={ad.creativeId} className="mt-3 border border-line p-3"><p className="text-xs text-mute">{ad.creativeId}</p><h4 className="font-medium">{ad.headline}</h4><p>{ad.body}</p><p className="text-sm">{ad.caption}</p><p className="text-sm">{ad.callToAction}</p></article>)}
        </details>
        <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Rule sources and versions ({run.ruleSelection?.rules.length ?? 0})</summary><ul className="mt-2 space-y-2 text-xs">{run.ruleSelection?.rules.map((r, i) => <li key={`${r.id}-${i}`}>{r.id} · {r.version} · {r.jurisdiction} · {r.source} · {r.effectiveDate}–{r.expiresAt}</li>)}</ul></details>
        {(report?.limitations ?? run.result?.limitations ?? run.submission.limitations).length > 0 && <div className="mt-4"><h3 className="text-sm font-medium">Known limitations</h3><ul className="list-disc pl-5 text-sm text-mute">{(report?.limitations ?? run.result?.limitations ?? run.submission.limitations).map(l => <li key={l}>{l}</li>)}</ul></div>}
      </details>;
    })}
  </section>;
}
