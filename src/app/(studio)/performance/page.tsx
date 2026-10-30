"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/ids";
import { channelLabel } from "@/lib/status";
import type { ChannelResultStatus } from "@/lib/runtime/types";
import { useActiveCampaigns, useAisle } from "@/lib/store";
import { SaveInsightsPanel } from "@/components/insights/FeedbackInsights";
import { Empty, PageHeader, ResultStatusChip, SectionTitle, Stat } from "@/components/ui";
import Link from "next/link";

export default function PerformancePage() {
  const campaigns = useActiveCampaigns();
  const collectFeedback = useAisle((s) => s.collectFeedback);
  const setCollectorOverrides = useAisle((s) => s.setCollectorOverrides);
  const decideRecommendation = useAisle((s) => s.decideRecommendation);
  const busy = useAisle((s) => s.busy);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  /* Campaigns with a collected report, plus published campaigns that still have
     results to collect — the queue is what the founder actually works. */
  const analysed = campaigns.flatMap((c) => (c.performanceReport ? [{ c, report: c.performanceReport }] : []));
  const awaitingCollection = campaigns.filter(
    (c) => c.status === "published" && !c.performanceReport,
  );
  const legacy = campaigns.filter((c) => !c.performanceReport && c.performance);

  const totals = analysed.reduce(
    (acc, { report }) => {
      const t = report.totals;
      if (!t) return acc;
      acc.impressions += t.impressions;
      acc.conversions += t.conversions;
      return acc;
    },
    { impressions: 0, conversions: 0 },
  );
  const gaps = analysed.reduce((n, { report }) => n + report.gaps.length, 0);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Performance"
        title="What worked, and what to do next"
        description="We collect results from your channels, then use them to shape your next campaign brief."
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="Impressions" value={formatNumber(totals.impressions)} hint="reporting channels only" />
        <Stat label="Conversions" value={formatNumber(totals.conversions)} />
        <Stat
          label="Data gaps"
          value={String(gaps)}
          hint={gaps > 0 ? "marked, never estimated" : "no gaps recorded"}
        />
      </section>

      {awaitingCollection.length > 0 ? (
        <section className="hairline p-4">
          <SectionTitle kicker="Results" title="Published, waiting on results" />
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
                  className="rounded-full border border-line font-medium hover:bg-paper-2 px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  {busy[c.id] ? "Collecting…" : "Collect results"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {analysed.map(({ c, report }) => {
        const maxImp = Math.max(...report.results.map((r) => r.figures?.impressions ?? 0), 1);
        const decision = c.recommendationDecision;
        const draft = drafts[c.id] ?? report.recommendationText ?? report.summary;
        const firstChannel = report.results[0]?.channel ?? c.channels[0];
        return (
          <article key={c.id} className="hairline p-4">
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
                        setCollectorOverrides(
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
                      <ResultStatusChip status={r.status} />
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
              <SectionTitle kicker="Up next" title="What we suggest for your next campaign" />
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
                      ? "Discarded. This advice is not offered for a later campaign."
                      : (decision.text ?? "")}
                  </p>
                  <SaveInsightsPanel campaignId={c.id} />
                </div>
              ) : report.recommendationUnsupported ? (
                <div className="mt-4">
                  <button
                    type="button"
                    disabled={busy[c.id]}
                    onClick={() => void decideRecommendation(c.id, "discarded")}
                    className="rounded-full border border-signal px-4 py-2 text-sm text-signal disabled:opacity-50"
                  >
                    Discard
                  </button>
                  <p className="mt-2 text-xs text-mute">
                    This summary cannot be accepted or saved as advice for a later campaign.
                    Discard it, or leave it as the record of what was collected.
                  </p>
                </div>
              ) : (
                <div className="mt-4">
                  <textarea
                    value={draft}
                    onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                    rows={3}
                    className="w-full border border-line px-3 py-2 text-sm outline-none focus:border-signal"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy[c.id]}
                      onClick={() => void decideRecommendation(c.id, "accepted", draft)}
                      className="rounded-full btn-primary px-4 py-2 text-sm font-medium disabled:opacity-50"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      disabled={busy[c.id]}
                      onClick={() => void decideRecommendation(c.id, "edited", draft)}
                      className="rounded-full border border-line font-medium hover:bg-paper-2 px-4 py-2 text-sm disabled:opacity-50"
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
                    Accepting or editing keeps this advice so you can save it. It is not added to
                    the next campaign unless you tick it when you start one. Discarding keeps it out.
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
          body="Publish a campaign and connect your channels to see results here. If data is missing, we say so instead of guessing."
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
              <li key={c.id} className="hairline p-3">
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
