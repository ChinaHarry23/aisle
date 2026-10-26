"use client";

import { useState } from "react";
import Link from "next/link";
import { ResearchDecisions } from "./ResearchDecisions";
import { StructuredBrief } from "./StructuredBrief";
import { StrategySummary } from "./StrategySummary";
import type { Campaign } from "@/lib/types";
import { coverageFor, type ResearchCategory } from "@/lib/trend/contracts";
import { currentStrategy } from "@/lib/trend/strategy";
import { cn } from "@/lib/cn";

const labels: Record<ResearchCategory, string> = {
  current_market: "Current market",
  historical_market: "Historical trends",
  customer_interest: "Customer interests",
  purchase_preference: "Purchasing preferences",
  seasonal: "Seasonal influences",
  cultural: "Cultural influences",
  channel: "Channel behaviour",
  competitor: "Competitor activity",
};

type Area = NonNullable<Campaign["researchCoverage"]>[number];
type View = "strategy" | "areas" | "decisions" | "brief";

function areaKey(area: Area) {
  return `${area.category}:${area.channel ?? ""}`;
}

function areaTitle(area: Area) {
  return `${labels[area.category]}${area.channel ? ` · ${area.channel}` : ""}`;
}

export function TrendReport({ campaign }: { campaign: Campaign }) {
  const areas = campaign.researchCoverage ?? coverageFor(campaign, []);
  const retrieved = areas.filter((area) => area.evidenceIds.length).length;
  const quality = campaign.trendQuality;
  const strategy = currentStrategy(campaign);
  const strategyInsightIds = new Set(strategy?.insights.map((insight) => insight.id));
  const appliedInsightIds = new Set(campaign.creatives.filter((creative) => creative.strategyVersion === strategy?.version).flatMap((creative) => creative.insightUses?.map((use) => use.insightId).filter((id) => strategyInsightIds.has(id)) ?? []));
  const attention = quality
    ? (campaign.trendRequests?.filter((request) => request.status === "pending") ?? [])
    : campaign.trendGaps.filter((gap) => gap.needsFounder);
  const recorded = Boolean(campaign.researchAttempts?.length);
  const draft = strategy
    ? strategy.status === "product_led" ? "Product-led direction" : "Campaign strategy ready"
    : campaign.running && campaign.run?.step.startsWith("trend.")
      ? "Developing your campaign"
      : quality
    ? quality.status === "COMPLETE"
      ? quality.storedVersion === quality.version
        ? quality.handedOffAt
          ? "Complete · handed to content generation"
          : "Complete · stored"
        : "Evidence passed · awaiting storage"
      : campaign.status === "rejected"
        ? "Analysis ended · partial report"
        : "Research saved · some questions remain"
    : recorded
      ? "Draft · evidence review pending"
      : "No verified research run";

  function statusFor(area: Area) {
    if (!quality) {
      if (area.analysis) return area.analysis.evidenceIds.length ? "Draft assessment" : "Evidence gap";
      if (area.evidenceIds.length) return "Sources retrieved";
      if (area.attempts?.length) return "No evidence";
      return "Not run";
    }
    return quality.researchAreas.find((item) => item.category === area.category && item.channel === area.channel)?.supported
      ? "Supported"
      : "Evidence gap";
  }

  const firstGap = areas.find((area) => statusFor(area) !== "Supported") ?? areas[0];
  const [view, setView] = useState<View>("strategy");
  const [selectedKey, setSelectedKey] = useState(firstGap ? areaKey(firstGap) : "");
  const selected = areas.find((area) => areaKey(area) === selectedKey) ?? firstGap;

  const views: { id: View; label: string }[] = [
    { id: "strategy", label: "Campaign direction" },
    { id: "areas", label: "Research details" },
    ...(attention.length ? [{ id: "decisions" as const, label: `Your inputs · ${attention.length}` }] : []),
    { id: "brief", label: "Full report" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section className="hairline p-4 md:p-5" aria-label="Trend report overview">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl">Research for your campaign</h2>
            <p className="mt-1 text-sm text-ink-soft">
              {campaign.product} · {campaign.country} · {campaign.startDate} – {campaign.endDate}
            </p>
          </div>
          <span className="status-chip status-wait">{draft}</span>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3 text-sm">
          <div>
            <dt className="text-mute">Useful directions</dt>
            <dd className="mt-1 text-lg">{strategy?.insights.length ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-mute">Applied to creative</dt>
            <dd className="mt-1 text-lg">{strategy ? appliedInsightIds.size : "—"}</dd>
          </div>
          <div>
            <dt className="text-mute">Channels planned</dt>
            <dd className="mt-1 text-lg">{strategy?.channels.length ?? campaign.channels.length}</dd>
          </div>
        </dl>
        {campaign.researchModelTurns?.length ? (
          <details className="mt-4 border-t border-line pt-3">
            <summary className="cursor-pointer text-sm text-signal">
              Research activity
            </summary>
            <ol className="mt-3 space-y-2 text-xs text-mute">
              <li>{retrieved} of {areas.length} research areas returned sources. {quality?.findings.filter((finding) => finding.supported).length ?? 0} reviewed findings.</li>
              {campaign.researchModelTurns.map((turn) => (
                <li key={turn.turn}>
                  Turn {turn.turn} · {turn.modelId} · {turn.phase} · {turn.status} · {turn.tokens} tokens
                  <p>{turn.selectedTools.length ? `Selected: ${turn.selectedTools.join(", ")}` : "No tool selected"}</p>
                </li>
              ))}
              {quality?.modelStatus && quality.modelStatus !== "assessed" ? <li>Review detail: {quality.modelStatus}</li> : null}
            </ol>
          </details>
        ) : null}
      </section>

      <div role="tablist" aria-label="Trend report sections" className="flex flex-wrap gap-2">
        {views.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={view === item.id}
            onClick={() => setView(item.id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm",
              view === item.id ? "border-signal bg-signal text-white" : "border-line bg-surface text-ink-soft hover:text-ink",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {view === "strategy" ? <StrategySummary campaign={campaign} /> : null}

      {view === "areas" && selected ? (
        <section className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]" aria-label="Research areas">
          <div>
            <label className="block text-sm lg:hidden">
              Research area
              <select
                className="mt-1 w-full border border-line bg-surface px-3 py-2"
                value={areaKey(selected)}
                onChange={(event) => setSelectedKey(event.target.value)}
              >
                {areas.map((area) => (
                  <option key={areaKey(area)} value={areaKey(area)}>
                    {areaTitle(area)} · {statusFor(area)}
                  </option>
                ))}
              </select>
            </label>
            <ul className="hidden border border-line lg:block">
              {areas.map((area) => {
                const active = areaKey(area) === areaKey(selected);
                return (
                  <li key={areaKey(area)}>
                    <button
                      type="button"
                      aria-current={active ? "true" : undefined}
                      onClick={() => setSelectedKey(areaKey(area))}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 border-b border-line px-3 py-2 text-left text-sm last:border-b-0",
                        active ? "bg-paper-2 font-medium" : "hover:bg-paper-2",
                      )}
                    >
                      <span>{areaTitle(area)}</span>
                      <span className="shrink-0 text-xs text-mute">{statusFor(area)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <article className="hairline p-4 md:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="font-serif text-xl">{areaTitle(selected)}</h3>
              <span className="text-xs text-signal">{statusFor(selected)}</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed">
              {selected.analysis?.summary ?? "No source-supported assessment is available yet."}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-mute">
              {quality
                ? [quality.researchAreas.find((item) => item.category === selected.category && item.channel === selected.channel)?.reason, selected.analysis?.limitation].filter(Boolean).join(" ")
                : selected.analysis?.limitation || selected.limitation}
            </p>
            <details className="mt-4 border-t border-line pt-3">
              <summary className="cursor-pointer text-sm text-signal">
                Evidence and execution · {selected.evidenceIds.length} sources
              </summary>
              <ul className="mt-3 space-y-2 text-xs text-mute">
                {(selected.attempts ?? []).map((attempt, index) => (
                  <li key={index}>
                    {attempt.phase === "agent" ? "Agent selected · " : attempt.phase === "mandatory" ? "Coverage check · " : ""}
                    {attempt.tool} · {attempt.status}
                    <p>{attempt.summary}</p>
                  </li>
                ))}
                {!selected.attempts?.length ? <li>No execution recorded.</li> : null}
              </ul>
              {selected.evidenceIds.map((id) => {
                const evidence = campaign.evidence.find((source) => source.id === id);
                const review = quality?.evidence.find((item) => item.id === id);
                if (!evidence) return null;
                return (
                  <div className="mt-3 border-t border-line pt-3 text-xs" key={id}>
                    <p className="font-medium">{evidence.sourceName}</p>
                    {evidence.sourceName === "WhichGrocer" ? (
                      <a className="text-signal underline" href="https://www.whichgrocer.com" target="_blank" rel="noreferrer">
                        Product data by WhichGrocer
                      </a>
                    ) : null}
                    <p className="mt-1 text-mute">
                      Information date: {evidence.observedAt ?? "Unknown"} · Retrieved: {evidence.fetchedAt}
                    </p>
                    {review ? (
                      <p className="mt-2 text-mute">
                        Quality: {review.accepted ? "Accepted for supporting findings" : "Excluded from support"} · {review.currency}
                        <br />
                        {review.reason}
                        <br />
                        {review.exclusions.join(" ")}
                      </p>
                    ) : null}
                    <p className="mt-2 break-words leading-relaxed">{evidence.detail}</p>
                    {/^https?:\/\//.test(evidence.sourceRef) ? (
                      <a className="mt-2 inline-block text-signal underline" href={evidence.sourceRef} target="_blank" rel="noreferrer">
                        Read source ↗
                      </a>
                    ) : (
                      <p className="mt-2 break-all text-mute">{evidence.sourceRef}</p>
                    )}
                  </div>
                );
              })}
            </details>
          </article>
        </section>
      ) : null}

      {view === "areas" && !selected ? (
        <p className="text-sm text-mute">This campaign has no research areas yet.</p>
      ) : null}

      {view === "decisions" ? (
        <section className="hairline p-4 md:p-5" aria-label="Research decisions">
          <h3 className="font-serif text-xl">Needs your attention</h3>
          <p className="mt-2 text-sm text-mute">
            Open one request at a time. A decision can add a source or correct the brief. It does not approve an unsupported finding.
          </p>
          {quality ? (
            <ResearchDecisions campaign={campaign} />
          ) : attention.length ? (
            <ul className="mt-4 space-y-3">
              {campaign.trendGaps.filter((gap) => gap.needsFounder).map((gap) => (
                <li key={gap.id} className="border border-line p-3 text-sm">
                  <p className="font-medium">{gap.detail}</p>
                  <p className="mt-1 text-ink-soft">{gap.effect}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-mute">
              {recorded ? "No research decision is open." : "Run the research workflow before decisions appear."}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-4 text-sm text-signal">
            <Link href="/settings">Check source connections →</Link>
            <a href="#retail-data">Provide authorised retail data →</a>
          </div>
        </section>
      ) : null}

      {view === "brief" ? (
        <div className="flex flex-col gap-6">
          <StructuredBrief campaign={campaign} />
          {!campaign.structuredTrendBrief ? (
            <section className="hairline p-4 md:p-5" aria-label="Research conclusions">
              <h3 className="font-serif text-xl">Conclusions</h3>
              <p className="mt-2 text-sm text-ink-soft">{campaign.brief?.angle || "Awaiting a supported theme."}</p>
              <p className="mt-2 text-sm text-ink-soft">{campaign.brief?.visualDirection || "Awaiting a visual direction."}</p>
              {campaign.trendFindings.length ? (
                <ol className="mt-4 space-y-3">
                  {campaign.trendFindings.map((finding) => (
                    <li key={finding.id} className="text-sm">
                      <strong>{finding.topic}</strong>
                      <p className="mt-1 text-ink-soft">{finding.finding}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-3 text-sm text-mute">Awaiting analysis.</p>
              )}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
