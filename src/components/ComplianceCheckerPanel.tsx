"use client";

import { ComplianceFindingDetails } from "./ComplianceFindingDetails";
import { excerptFormatter } from "@/lib/compliance/presentation";
import { CheckCircle2, FileCheck2, ImageIcon } from "lucide-react";
import { ComplianceReviewHistory } from "@/components/ComplianceReviewHistory";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/ids";
import { campaignMediaUrl } from "@/lib/media/url";
import type { Campaign } from "@/lib/types";
import type { ComplianceIssue } from "@/lib/runtime/types";

const statusCopy = {
  PASSED: { label: "AI review: no issues identified", className: "risk-low" },
  CHANGES_REQUIRED: { label: "Changes required", className: "risk-high" },
  MANUAL_REVIEW_REQUIRED: { label: "Review needs your attention", className: "risk-mid" },
} as const;


export function ComplianceCheckerPanel({ campaign }: { campaign: Campaign }) {
  const runs = campaign.complianceReviewRuns ?? [];
  const run = runs.at(-1);
  const report = run?.report;
  const legacyReport = campaign.complianceReports.at(-1);
  const legacyFindings: ComplianceIssue[] = (legacyReport?.findings ?? []).map((finding) => ({
    id: finding.id,
    category: "brand_guideline",
    basis: "human_judgement",
    severity: finding.severity,
    excerpt: finding.excerpt,
    explanation: finding.explanation,
    rule: finding.rule,
    policySource: "Legacy campaign review",
    policyDate: "",
    recommendedCorrection: "Revise the cited wording and submit a new advertisement version.",
  }));
  const findings = (report?.findings ?? run?.result?.findings ?? campaign.complianceAttempts.at(-1)?.issues ?? legacyFindings) as ComplianceIssue[];
  const submission = run?.submission;
  const legacyStatus = legacyReport?.verdict === "pass" ? "PASSED" : legacyReport?.verdict === "revise" ? "CHANGES_REQUIRED" : legacyReport ? "MANUAL_REVIEW_REQUIRED" : null;
  const status = report ? statusCopy[report.status] : legacyStatus ? statusCopy[legacyStatus] : null;
  const policyProblems = report?.policyProblems ?? run?.evidence?.problems ?? run?.ruleSelection?.problems ?? [];

  const ads = submission?.content ?? campaign.creatives.map((creative) => ({
    creativeId: creative.id,
    headline: creative.headline,
    body: creative.subhead,
    caption: creative.caption,
    callToAction: creative.cta,
    imageUrl: creative.generation?.url ?? null,
    createdAt: creative.createdAt ?? campaign.createdAt,
    generationInputs: { prompt: creative.prompt },
  }));
  const explainExcerpt = excerptFormatter(ads);

  return (
    <section className="flex flex-col gap-6" aria-label="Compliance Checker">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-mute">Automatic campaign handoff</p>
          <h2 className="mt-1 font-serif text-2xl">Compliance Checker</h2>
          <p className="mt-1 max-w-3xl text-sm text-ink-soft">
            AI compares this advertisement and its images with passages from your local legal library and uploaded guidelines. Each finding explains the concern, the source and the next step.
          </p>
        </div>
        {status ? <span className={cn("status-chip", status.className)}>{status.label}</span> : null}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(20rem,0.95fr)]">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-medium">Advertisement received</h3>
            <span className="text-xs text-mute">
              {submission ? `Version ${submission.version} · ${submission.content.length} advertisement(s)` : legacyReport ? `Version ${legacyReport.version} · legacy sample` : "Waiting for submission"}
            </span>
          </div>

          {ads.length ? ads.map((ad, advertisementIndex) => {
            const creative = campaign.creatives.find((item) => item.id === ad.creativeId);
            const image = creative && creative.generation?.url === ad.imageUrl
              ? campaignMediaUrl(campaign.id, creative.id, creative.generation)
              : ad.imageUrl && !ad.imageUrl.startsWith("aisle-media:") ? ad.imageUrl : undefined;
            return (
              <article key={ad.creativeId} className="hairline overflow-hidden">
                <div className="border-b border-line bg-paper-2 px-4 py-2 text-xs text-mute">
                  Advertisement {String.fromCharCode(65 + advertisementIndex)} · submitted {formatDate(ad.createdAt, true)}
                </div>
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt={`Submitted advertisement ${ad.headline}`} className="max-h-[32rem] w-full object-contain" />
                ) : (
                  <div className="flex min-h-36 items-center justify-center gap-2 bg-paper-2 text-sm text-mute">
                    <ImageIcon size={18} /> No rendered image attached
                  </div>
                )}
                <div className="space-y-3 p-4">
                  <h4 className="font-serif text-2xl leading-tight">{ad.headline}</h4>
                  <p className="text-base text-ink-soft">{ad.body}</p>
                  <p className="text-sm leading-relaxed">{ad.caption}</p>
                  <p className="text-xs text-mute">Call to action: <span className="font-medium text-ink">{ad.callToAction}</span></p>
                  <details className="text-xs text-mute">
                    <summary className="cursor-pointer">Image generation prompt</summary>
                    <p className="mt-2 whitespace-pre-wrap">{ad.generationInputs.prompt}</p>
                  </details>
                </div>
              </article>
            );
          }) : (
            <div className="hairline p-5 text-sm text-mute">Content Generation has not submitted an advertisement yet.</div>
          )}
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-4">
          <div className="hairline p-4">
            <div className="flex items-start gap-3">
              <FileCheck2 className="mt-0.5 shrink-0 text-signal" size={20} />
              <div>
                <h3 className="font-medium">Review result</h3>
                <p className="mt-1 text-sm text-ink-soft">
                  {campaign.complianceAttempts.at(-1)?.summary ?? legacyReport?.summary ?? (run ? "The review is still running." : "The automatic review starts after Content Generation finishes.")}
                </p>
                {run ? (
                  <p className="mt-2 text-xs text-mute">
                    Review {run.attemptNumber} · {run.evidence?.sources.length ?? 0} source passages supplied · {run.submission.content.filter((ad) => ad.imageUrl).length} image attachment(s)
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {findings.length ? (
            <div className="flex flex-col gap-6">
              <section aria-labelledby="compliance-issues-heading">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h3 id="compliance-issues-heading" className="font-serif text-xl">Issues</h3>
                  <span className="text-xs text-mute">{findings.length} found</span>
                </div>
                <div className="flex flex-col gap-3">
                  {findings.map((finding, index) => (
                    <ComplianceFindingDetails key={`${finding.id}-issue-${index}`} finding={finding} excerpt={explainExcerpt(finding.excerpt)} number={index + 1} mode="issue" />
                  ))}
                </div>
              </section>

              <section aria-labelledby="compliance-improvements-heading">
                <h3 id="compliance-improvements-heading" className="mb-3 font-serif text-xl">Improvements</h3>
                <div className="flex flex-col gap-3">
                  {findings.map((finding, index) => (
                    <ComplianceFindingDetails key={`${finding.id}-improvement-${index}`} finding={finding} excerpt={explainExcerpt(finding.excerpt)} number={index + 1} mode="improvement" />
                  ))}
                </div>
              </section>
            </div>
          ) : report || legacyReport ? (
            <div className="border border-[color-mix(in_srgb,#15803d_45%,var(--line))] bg-[color-mix(in_srgb,#15803d_6%,var(--surface))] p-4 text-sm">
              <p className="inline-flex items-center gap-2 font-medium text-green-800"><CheckCircle2 size={17} /> No content issue was identified. Check review limitations below before publishing.</p>
            </div>
          ) : null}

          {policyProblems.length ? (
            <div className="border border-amber-500 bg-amber-50 p-4">
              <h3 className="text-sm font-medium">Review could not cover everything</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{policyProblems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
            </div>
          ) : null}

        {!!report?.scopeNotes?.length && <details className="hairline p-4 text-sm"><summary className="cursor-pointer font-medium">Review scope</summary><ul className="mt-2 list-disc pl-5 text-mute">{report.scopeNotes.map(note => <li key={note}>{note}</li>)}</ul></details>}
          {(report?.limitations ?? run?.result?.limitations ?? []).length ? (
            <details className="hairline p-4 text-sm">
              <summary className="cursor-pointer font-medium">What still needs checking</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-mute">{(report?.limitations ?? run?.result?.limitations ?? []).map((item) => <li key={item}>{item}</li>)}</ul>
            </details>
          ) : null}
        </div>
      </div>

      {runs.length ? <ComplianceReviewHistory campaign={campaign} /> : campaign.complianceReports.length ? (
        <details className="hairline p-4">
          <summary className="cursor-pointer text-sm font-medium">Legacy review history · {campaign.complianceReports.length} round(s)</summary>
          <ol className="mt-3 space-y-3 border-t border-line pt-3 text-sm">
            {campaign.complianceReports.map((item) => <li key={item.id}><span className={cn("status-chip", item.verdict === "pass" ? "risk-low" : item.verdict === "revise" ? "risk-high" : "risk-mid")}>v{item.version} · {item.verdict}</span><p className="mt-1 text-ink-soft">{item.summary}</p></li>)}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
