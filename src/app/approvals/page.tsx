"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Empty, RiskBadge } from "@/components/ui";
import { useAisle } from "@/lib/store";

export default function ApprovalsPage() {
  const campaigns = useAisle((s) => s.campaigns);
  const approve = useAisle((s) => s.approve);
  const reject = useAisle((s) => s.reject);
  const requestChanges = useAisle((s) => s.requestChanges);
  const resolveConflict = useAisle((s) => s.resolveConflict);
  const busy = useAisle((s) => s.busy);
  const queue = campaigns.filter((c) => c.status === "awaiting_approval");
  const [notes, setNotes] = useState<Record<string, string>>({});

  /* Not every exception is an approval: a run can also be parked on a
     scheduling conflict, which AHR-05 says the founder must settle. */
  const conflictQueue = campaigns.flatMap((c) =>
    c.scheduleConflicts
      .filter((x) => !x.resolved)
      .map((x) => ({ campaign: c, conflict: x })),
  );

  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="text-[11px] uppercase tracking-[0.2em] text-signal">Human-in-the-loop</p>
        <h1 className="font-serif text-4xl">Exceptions only.</h1>
        <p className="mt-2 max-w-xl text-sm text-ink-soft">
          Low-risk work can move without you. Medium and high risk — print locks, thin claims,
          unusual targeting — stop here. Your note is written back into shared context.
        </p>
      </header>

      {conflictQueue.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] uppercase tracking-[0.18em] text-signal">
            Scheduling conflicts — flagged, not resolved for you
          </h2>
          {conflictQueue.map(({ campaign, conflict }) => (
            <div key={conflict.id} className="hairline bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="status-chip risk-mid">{conflict.kind.replace(/_/g, " ")}</span>
                <Link
                  href={`/campaigns/${campaign.id}`}
                  className="font-serif text-lg hover:text-signal"
                >
                  {campaign.name}
                </Link>
                <span className="text-xs text-mute">{conflict.channel}</span>
              </div>
              <p className="mt-2 text-sm text-ink-soft">{conflict.detail}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void resolveConflict(
                      campaign.id,
                      conflict.id,
                      notes[campaign.id] || "Accepted by the founder.",
                    )
                  }
                  className="rounded-full bg-ink px-4 py-2 text-sm text-paper"
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
            </div>
          ))}
        </section>
      ) : null}

      {queue.length === 0 && conflictQueue.length === 0 ? (
        <Empty
          title="Nothing in the queue"
          body="When Compliance is uncertain, or the schedule collides, the campaign lands here. Until then, the bench runs."
        />
      ) : null}

      {queue.length > 0 ? (
        <ul className="flex flex-col gap-4">
          {queue.map((c) => {
            const report = c.complianceReports.at(-1);
            const attempt = c.complianceAttempts.at(-1);
            const note = notes[c.id] ?? "";
            const confirmed = attempt?.issues.filter((i) => i.basis === "confirmed_breach").length ?? 0;
            const judgement = attempt?.issues.filter((i) => i.basis === "human_judgement").length ?? 0;
            const manual = attempt?.outcome === "manual_review";
            return (
              <li key={c.id} className="hairline bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-serif text-2xl">{c.name}</h2>
                    <p className="mt-1 text-sm text-ink-soft">{c.product}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {manual ? (
                      <span className="status-chip risk-high">manual review required</span>
                    ) : null}
                    {report ? <RiskBadge risk={report.risk} /> : null}
                  </div>
                </div>
                {attempt ? (
                  <p className="mt-2 text-xs text-mute">
                    attempt {attempt.attempt} of 3 · v{attempt.creativeVersion} · {confirmed}{" "}
                    confirmed breach(es) · {judgement} needing judgement · policies:{" "}
                    {attempt.policyRefs.join(", ")}
                  </p>
                ) : null}
                <p className="mt-3 text-sm leading-relaxed">{report?.summary}</p>
                <ul className="mt-3 flex flex-col gap-2 text-sm text-ink-soft">
                  {(attempt?.issues ?? []).map((issue) => (
                    <li key={issue.id} className="border-l-2 border-line pl-3">
                      <span
                        className={cn(
                          "status-chip",
                          issue.basis === "confirmed_breach" ? "risk-high" : "risk-mid",
                        )}
                      >
                        {issue.basis === "confirmed_breach" ? "confirmed breach" : "judgement"}
                      </span>
                      <span className="ml-2">{issue.excerpt}</span>
                      <span className="mt-1 block text-xs text-mute">
                        {issue.rule} — fix: {issue.recommendedCorrection}
                      </span>
                    </li>
                  ))}
                  {!attempt
                    ? report?.findings.map((f) => (
                        <li key={f.id}>
                          {f.type}: {f.excerpt}
                        </li>
                      ))
                    : null}
                </ul>
                <textarea
                  value={note}
                  onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
                  placeholder="Founder note"
                  rows={2}
                  className="mt-4 w-full border border-line px-3 py-2 text-sm outline-none focus:border-ink"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy[c.id]}
                    onClick={() => void approve(c.id, note)}
                    className="rounded-full bg-ink px-4 py-2 text-sm text-paper"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy[c.id]}
                    onClick={() => void requestChanges(c.id, note || "Revise to founder notes.")}
                    className="rounded-full border border-ink px-4 py-2 text-sm"
                  >
                    Request changes
                  </button>
                  <button
                    type="button"
                    disabled={busy[c.id]}
                    onClick={() => void reject(c.id, note || "Rejected.")}
                    className="rounded-full border border-signal px-4 py-2 text-sm text-signal"
                  >
                    Reject
                  </button>
                  <Link href={`/campaigns/${c.id}`} className="px-3 py-2 text-sm text-mute hover:text-ink">
                    Open campaign
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
