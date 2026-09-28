"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/ids";
import { channelLabel } from "@/lib/status";
import type { ChannelResultStatus } from "@/lib/runtime/types";
import { useAisle } from "@/lib/store";
import { Empty, SectionTitle, Stat } from "@/components/ui";
import Link from "next/link";

export default function PerformancePage() {
  const campaigns = useAisle((s) => s.campaigns);
  const collectFeedback = useAisle((s) => s.collectFeedback);
  const setCollectorOverrides = useAisle((s) => s.setCollectorOverrides);
  const decideRecommendation = useAisle((s) => s.decideRecommendation);
  const busy = useAisle((s) => s.busy);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  /* Campaigns with a collected report, plus published campaigns that still have
     results to collect — the queue is what the founder actually works. */
  const analysed = campaigns.filter((c) => c.performanceReport);
  const awaitingCollection = campaigns.filter(
    (c) => c.status === "published" && !c.performanceReport,
  );
  const legacy = campaigns.filter((c) => !c.performanceReport && c.performance);

  const totals = analysed.reduce(
    (acc, c) => {
      const t = c.performanceReport?.totals;
      if (!t) return acc;
      acc.impressions += t.impressions;
      acc.clicks += t.clicks;
      acc.conversions += t.conversions;
      return acc;
    },
    { impressions: 0, clicks: 0, conversions: 0 },
  );
  const ctr = totals.impressions ? (totals.clicks / totals.impressions) * 100 : 0;
  const gaps = analysed.reduce((n, c) => n + (c.performanceReport?.gaps.length ?? 0), 0);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="text-[11px] uppercase tracking-[0.2em] text-signal">Feedback loop</p>
        <h1 className="font-serif text-4xl">What ran. What to do next.</h1>
        <p className="mt-2 max-w-xl text-sm text-ink-soft">
          Media Manager collects results. Trend Analyser reads them before the next brief. That is
          the difference between four chatbots and a company.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Impressions" value={formatNumber(totals.impressions)} hint="reporting channels only" />
        <Stat label="Blended CTR" value={`${ctr.toFixed(1)}%`} />
        <Stat label="Conversions" value={formatNumber(totals.conversions)} />
        <Stat
          label="Data gaps"
          value={String(gaps)}
          hint={gaps > 0 ? "marked, never estimated" : "no gaps recorded"}
        />
      </section>

      {awaitingCollection.length > 0 ? (
        <section className="hairline bg-surface p-5">
          <SectionTitle kicker="AHR-06" title="Published, waiting on results" />
          <ul className="mt-3 flex flex-col gap-2">
            {awaitingCollection.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <Link href={`/campaigns/${c.id}`} className="font-medium hover:text-signal">
                  {c.name}
                </Link>
                <span className="text-xs text-mute">
                  ran on {c.schedule.map((s) => channelLabel[s.channel]).join(", ") || c.channels.join(", ")}
                </span>
                <button
                  type="button"
                  disabled={busy[c.id]}
                  onClick={() => void collectFeedback(c.id)}
                  className="rounded-full border border-ink px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  {busy[c.id] ? "Collecting…" : "Collect results"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {analysed.map((c) => {
        const report = c.performanceReport!;
        const maxImp = Math.max(...report.results.map((r) => r.figures?.impressions ?? 0), 1);
        const decision = c.recommendationDecision;
        const draft = drafts[c.id] ?? report.recommendationText ?? report.summary;
        const firstChannel = report.results[0]?.channel ?? c.channels[0];
        return (
          <article key={c.id} className="hairline bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link href={`/campaigns/${c.id}`} className="font-serif text-2xl hover:text-signal">
                  {c.name}
                </Link>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">
                  {report.summary}
                </p>
                <p className="mt-2 text-xs text-mute">
                  collected {report.at.slice(0, 16).replace("T", " ")} · published{" "}
                  {report.publishedAt.slice(0, 10)} · {report.results.filter((r) => r.figures).length}/
                  {report.results.length} channel(s) reported
                </p>
              </div>
              <p className="text-sm tabular-nums text-mute">
                {report.totals ? `${formatNumber(report.totals.impressions)} imp · ${report.totals.ctr}% CTR` : "no totals"}
              </p>
            </div>

            <div className="mt-5 flex flex-wrap items-end justify-between gap-2">
              <h3 className="text-[11px] uppercase tracking-wider text-mute">
                Collection status per channel
              </h3>
              <details className="text-xs">
                <summary className="cursor-pointer text-mute hover:text-ink">
                  Declare a channel outcome
                </summary>
                <p className="mt-2 max-w-md text-mute">
                  AHR-06 turns on what happens when a channel does not report. Declare one here and
                  collect again: it is marked as a gap, never filled in.
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(
                    ["ok", "late", "not_authorised", "incomplete", "no_data"] as ChannelResultStatus[]
                  ).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() =>
                        void setCollectorOverrides(
                          c.id,
                          status === "ok" ? {} : { [firstChannel]: status },
                        )
                      }
                      className="rounded-full border border-line px-2 py-1 hover:border-signal hover:text-signal"
                    >
                      {channelLabel[firstChannel]}: {status.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>
              </details>
            </div>

            <ul className="mt-3 flex flex-col gap-2">
              {report.results.map((r) => (
                <li key={r.channel}>
                  <div className="mb-1 flex flex-wrap justify-between gap-2 text-xs">
                    <span className="flex items-center gap-2">
                      {channelLabel[r.channel]}
                      <span
                        className={cn(
                          "status-chip",
                          r.status === "ok"
                            ? "risk-low"
                            : r.status === "incomplete"
                              ? "risk-mid"
                              : "risk-high",
                        )}
                      >
                        {r.status.replace(/_/g, " ")}
                      </span>
                    </span>
                    <span className="tabular-nums text-mute">
                      {r.figures
                        ? `${formatNumber(r.figures.impressions)} · ${r.figures.ctr}% CTR`
                        : r.note.slice(0, 70)}
                    </span>
                  </div>
                  <div className="h-1.5 bg-paper-2">
                    <div
                      className={cn("h-1.5", r.figures ? "bg-ink" : "bg-line")}
                      style={{ width: `${((r.figures?.impressions ?? 0) / maxImp) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>

            {report.gaps.length > 0 ? (
              <ul className="mt-4 flex flex-col gap-1 border-l-2 border-signal pl-3 text-xs text-ink-soft">
                {report.gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            ) : null}

            <div className="mt-5 border-t border-line pt-4">
              <SectionTitle kicker="Returned to Trend Analyser" title="Next-cycle recommendation" />
              {report.recommendationUnsupported ? (
                <p className="mt-3 text-sm text-signal">
                  No keep/drop/change advice could be sourced from the collected evidence, so none
                  was produced. The summary above is what the founder has to work from.
                </p>
              ) : (
                <ul className="mt-3 flex flex-col gap-2 text-sm">
                  {report.recommendationPoints.map((p) => (
                    <li key={p.id}>
                      <span className="text-[10px] uppercase tracking-wider text-signal">
                        {p.verdict} · {p.area.replace(/_/g, " ")}
                      </span>
                      <p className="mt-0.5">{p.text}</p>
                    </li>
                  ))}
                </ul>
              )}

              {decision ? (
                <div className="mt-4 text-sm">
                  <span
                    className={cn(
                      "status-chip",
                      decision.action === "discarded" ? "risk-mid" : "risk-low",
                    )}
                  >
                    {decision.action}
                  </span>
                  <span className="ml-2 text-xs text-mute">
                    {decision.at.slice(0, 16).replace("T", " ")} · {decision.author}
                  </span>
                  <p className="mt-1">
                    {decision.action === "discarded"
                      ? "Discarded — this note will not be attached to the next brief."
                      : (decision.text ?? "")}
                  </p>
                </div>
              ) : (
                <div className="mt-4">
                  <textarea
                    value={draft}
                    onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                    rows={3}
                    className="w-full border border-line px-3 py-2 text-sm outline-none focus:border-ink"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy[c.id]}
                      onClick={() => void decideRecommendation(c.id, "accepted", draft)}
                      className="rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      disabled={busy[c.id]}
                      onClick={() => void decideRecommendation(c.id, "edited", draft)}
                      className="rounded-full border border-ink px-4 py-2 text-sm disabled:opacity-50"
                    >
                      Save edit
                    </button>
                    <button
                      type="button"
                      disabled={busy[c.id]}
                      onClick={() => void decideRecommendation(c.id, "discarded")}
                      className="rounded-full border border-signal px-4 py-2 text-sm text-signal disabled:opacity-50"
                    >
                      Discard
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-mute">
                    Accepting or editing attaches the note to the next brief; discarding keeps it
                    out of the pipeline for good (UC-06 step 12).
                  </p>
                </div>
              )}
            </div>
          </article>
        );
      })}

      {analysed.length === 0 ? (
        <Empty
          title="No results collected yet"
          body="Publish a campaign, then collect authorised channel results. Missing data is marked as a gap rather than estimated."
        />
      ) : null}

      {legacy.length > 0 ? (
        <section>
          <SectionTitle kicker="Archived demo history" title="Seeded campaigns" />
          <p className="mt-2 max-w-2xl text-sm text-ink-soft">
            These campaigns predate the runtime and carry a plain recommendation without a
            collected report, so they are shown for context only.
          </p>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {legacy.map((c) => (
              <li key={c.id} className="hairline bg-surface p-3">
                <Link href={`/campaigns/${c.id}`} className="font-medium hover:text-signal">
                  {c.name}
                </Link>
                <p className="mt-1 text-ink-soft">{c.performance?.summary}</p>
                <p className="mt-1 text-xs text-mute">{c.performance?.recommendation}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
