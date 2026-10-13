"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { GUIDELINES_INTRO, GuidelinesPanel } from "@/components/GuidelinesPanel";
import { Empty, PageHeader, RiskBadge, SectionTitle } from "@/components/ui";
import { useAisle } from "@/lib/store";

const RISK_ORDER = { high: 0, medium: 1, low: 2 } as const;

export default function ApprovalsPage() {
  const campaigns = useAisle((s) => s.campaigns);
  const approve = useAisle((s) => s.approve);
  const reject = useAisle((s) => s.reject);
  const requestChanges = useAisle((s) => s.requestChanges);
  const resolveConflict = useAisle((s) => s.resolveConflict);
  const busy = useAisle((s) => s.busy);
  const [notes, setNotes] = useState<Record<string, string>>({});

  /* Highest risk first, so the thing most likely to hurt is read first. */
  const queue = campaigns
    .filter((c) => c.status === "awaiting_approval")
    .sort(
      (a, b) =>
        RISK_ORDER[a.complianceReports.at(-1)?.risk ?? "low"] -
        RISK_ORDER[b.complianceReports.at(-1)?.risk ?? "low"],
    );

  /* Not every exception is an approval: a run can also be parked on a
     scheduling conflict, which AHR-05 says the founder must settle. */
  const conflictQueue = campaigns.flatMap((c) =>
    c.scheduleConflicts
      .filter((x) => !x.resolved)
      .map((x) => ({ campaign: c, conflict: x })),
  );

  const highRisk = queue.filter(
    (c) => c.complianceReports.at(-1)?.risk === "high",
  ).length;
  const total = queue.length + conflictQueue.length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Guidelines & reviews"
        title="Guidelines and reviews"
        description="Add the brand and legal documents your agents should follow. If they find something they can't settle themselves, it's escalated to you below for manual review."
      />

      <section className="flex flex-col gap-3">
        <SectionTitle title="Brand guidelines & legal" />
        <p className="text-base text-ink-soft">{GUIDELINES_INTRO}</p>
        <GuidelinesPanel hideHeader />
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title="Brand profile" />
        <p className="text-base text-ink-soft">
          Your brand name, tone and the details every agent writes from.
        </p>
        <div className="hairline flex justify-center p-4">
          <Link
            href="/brand"
            className="inline-flex items-center rounded-full border border-line px-4 py-2 text-sm font-medium hover:bg-paper-2"
          >
            View brand profile
          </Link>
        </div>
      </section>

      <div className="flex flex-col gap-8">
        <SectionTitle
          kicker="Manual review"
          title={
            total > 0
              ? `${total} awaiting your review${highRisk ? ` · ${highRisk} high risk` : ""}`
              : "Human review"
          }
        />

        {total === 0 ? (
          <Empty
            title="Nothing needs your review"
            body="If the AI isn't sure about something, it escalates to you for a manual review and it will appear here. Until then, the agents keep going."
          />
        ) : null}

        {queue.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium text-ink-soft">
              Compliance flags ({queue.length})
            </h3>
            <ul className="flex flex-col gap-4">
              {queue.map((c) => {
                const report = c.complianceReports.at(-1);
                const attempt = c.complianceAttempts.at(-1);
                const note = notes[c.id] ?? "";
                const issues = attempt?.issues ?? [];
                const confirmed = issues.filter(
                  (i) => i.basis === "confirmed_breach",
                );
                const judgement = issues.filter(
                  (i) => i.basis === "human_judgement",
                );
                const manual = attempt?.outcome === "manual_review";
                const disabled = busy[c.id];
                return (
                  <li key={c.id} className="hairline flex flex-col gap-4 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <Link
                          href={`/campaigns/${c.id}`}
                          className="font-serif text-xl hover:text-signal"
                        >
                          {c.name}
                        </Link>
                        <p className="mt-0.5 text-sm text-ink-soft">
                          {c.product}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {manual ? (
                          <span className="status-chip risk-high">
                            manual review required
                          </span>
                        ) : null}
                        {report ? <RiskBadge risk={report.risk} /> : null}
                      </div>
                    </div>

                    {report?.summary ? (
                      <p className="text-base leading-relaxed">
                        {report.summary}
                      </p>
                    ) : null}

                    {attempt ? (
                      <p className="text-sm text-mute">
                        Attempt {attempt.attempt} of 3 · creative v
                        {attempt.creativeVersion} · {confirmed.length} confirmed
                        · {judgement.length} for your judgement
                        {attempt.policyRefs.length
                          ? ` · ${attempt.policyRefs.join(", ")}`
                          : ""}
                      </p>
                    ) : null}

                    {issues.length > 0 ||
                    (!attempt && report?.findings.length) ? (
                      <ul className="flex flex-col gap-3 text-base text-ink-soft">
                        {[...confirmed, ...judgement].map((issue) => (
                          <li
                            key={issue.id}
                            className={cn(
                              "border-l-2 pl-3",
                              issue.basis === "confirmed_breach"
                                ? "border-danger"
                                : "border-line",
                            )}
                          >
                            <span
                              className={cn(
                                "status-chip",
                                issue.basis === "confirmed_breach"
                                  ? "risk-high"
                                  : "risk-mid",
                              )}
                            >
                              {issue.basis === "confirmed_breach"
                                ? "confirmed breach"
                                : "judgement"}
                            </span>
                            <span className="ml-2">
                              &ldquo;{issue.excerpt}&rdquo;
                            </span>
                            <span className="mt-1 block text-sm text-mute">
                              {issue.rule} — fix: {issue.recommendedCorrection}
                            </span>
                          </li>
                        ))}
                        {!attempt
                          ? report?.findings.map((f) => (
                              <li
                                key={f.id}
                                className="border-l-2 border-line pl-3"
                              >
                                {f.type}: {f.excerpt}
                              </li>
                            ))
                          : null}
                      </ul>
                    ) : null}

                    <div className="flex flex-col gap-3 border-t border-line pt-4">
                      <label className="flex flex-col gap-1.5">
                        <span className="text-sm text-mute">
                          Your note (optional)
                        </span>
                        <textarea
                          value={note}
                          onChange={(e) =>
                            setNotes((n) => ({ ...n, [c.id]: e.target.value }))
                          }
                          placeholder="Why you decided this. Your agents will read it next time."
                          rows={2}
                          className="w-full border border-line px-3 py-2.5 text-base outline-none focus:border-signal"
                        />
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => void approve(c.id, note)}
                          className="rounded-full btn-primary px-4 py-2 text-sm font-medium disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() =>
                            void requestChanges(
                              c.id,
                              note || "Please revise using my notes.",
                            )
                          }
                          className="rounded-full border border-line px-4 py-2 text-sm font-medium hover:bg-paper-2 disabled:opacity-50"
                        >
                          Request changes
                        </button>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => void reject(c.id, note || "Rejected.")}
                          className="rounded-full border border-signal px-4 py-2 text-sm font-medium text-signal hover:bg-signal-soft disabled:opacity-50"
                        >
                          Reject
                        </button>
                        <Link
                          href={`/campaigns/${c.id}`}
                          className="ml-auto px-3 py-2 text-sm text-mute hover:text-ink"
                        >
                          Open campaign
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {conflictQueue.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium text-ink-soft">
              Scheduling conflicts ({conflictQueue.length}) — flagged, not
              resolved for you
            </h3>
            <ul className="flex flex-col gap-3">
              {conflictQueue.map(({ campaign, conflict }) => {
                const key = `conflict:${conflict.id}`;
                return (
                  <li
                    key={conflict.id}
                    className="hairline flex flex-col gap-3 p-5"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="status-chip risk-mid">
                        {conflict.kind.replace(/_/g, " ")}
                      </span>
                      <Link
                        href={`/campaigns/${campaign.id}`}
                        className="font-medium hover:text-signal"
                      >
                        {campaign.name}
                      </Link>
                      <span className="text-sm text-mute">
                        {conflict.channel}
                      </span>
                    </div>
                    <p className="text-base text-ink-soft">{conflict.detail}</p>
                    <input
                      value={notes[key] ?? ""}
                      onChange={(e) =>
                        setNotes((n) => ({ ...n, [key]: e.target.value }))
                      }
                      placeholder="Note (optional)"
                      className="w-full border border-line px-3 py-2.5 text-base outline-none focus:border-signal"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={busy[campaign.id]}
                        onClick={() =>
                          void resolveConflict(
                            campaign.id,
                            conflict.id,
                            notes[key] || "Accepted by the founder.",
                          )
                        }
                        className="rounded-full btn-primary px-4 py-2 text-sm font-medium disabled:opacity-50"
                      >
                        Accept this slot
                      </button>
                      <Link
                        href={`/campaigns/${campaign.id}`}
                        className="px-3 py-2 text-sm text-mute hover:text-ink"
                      >
                        Edit the brief instead
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
