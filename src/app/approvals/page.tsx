"use client";

import Link from "next/link";
import { useState } from "react";
import { Empty, RiskBadge } from "@/components/ui";
import { useAisle } from "@/lib/store";

export default function ApprovalsPage() {
  const campaigns = useAisle((s) => s.campaigns);
  const approve = useAisle((s) => s.approve);
  const reject = useAisle((s) => s.reject);
  const requestChanges = useAisle((s) => s.requestChanges);
  const queue = campaigns.filter((c) => c.status === "awaiting_approval");
  const [notes, setNotes] = useState<Record<string, string>>({});

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

      {queue.length === 0 ? (
        <Empty
          title="Nothing in the queue"
          body="When Compliance is uncertain, the campaign lands here. Until then, the bench runs."
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {queue.map((c) => {
            const report = c.complianceReports.at(-1);
            const note = notes[c.id] ?? "";
            return (
              <li key={c.id} className="hairline bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-serif text-2xl">{c.name}</h2>
                    <p className="mt-1 text-sm text-ink-soft">{c.product}</p>
                  </div>
                  {report ? <RiskBadge risk={report.risk} /> : null}
                </div>
                <p className="mt-3 text-sm leading-relaxed">{report?.summary}</p>
                <ul className="mt-3 text-sm text-ink-soft">
                  {report?.findings.map((f) => (
                    <li key={f.id}>
                      {f.type}: {f.excerpt}
                    </li>
                  ))}
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
                    onClick={() => approve(c.id, note)}
                    className="rounded-full bg-ink px-4 py-2 text-sm text-paper"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => requestChanges(c.id, note || "Revise to founder notes.")}
                    className="rounded-full border border-ink px-4 py-2 text-sm"
                  >
                    Request changes
                  </button>
                  <button
                    type="button"
                    onClick={() => reject(c.id, note || "Rejected.")}
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
      )}
    </div>
  );
}
