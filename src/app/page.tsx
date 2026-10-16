"use client";

import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { AdCanvas } from "@/components/AdCanvas";
import { AgentLog } from "@/components/AgentLog";
import { AgentPipeline, SectionTitle, Stat, StatusBadge } from "@/components/ui";
import { agentLabel, agentRole } from "@/lib/status";
import { formatNumber } from "@/lib/ids";
import { getLlmOrDefault } from "@/lib/llm/catalog";
import type { AgentSlot } from "@/lib/llm/types";
import { useAisle } from "@/lib/store";

const bench: { id: AgentSlot; replaces: string }[] = [
  { id: "trend", replaces: "Market researcher" },
  { id: "creative", replaces: "Photographer, copy, creative direction" },
  { id: "compliance", replaces: "Legal & brand risk" },
  { id: "media", replaces: "Social, web, print, in-store" },
];

export default function OverviewPage() {
  const campaigns = useAisle((s) => s.campaigns);
  const brand = useAisle((s) => s.brand);
  const settings = useAisle((s) => s.settings);
  const collectFeedback = useAisle((s) => s.collectFeedback);
  const busy = useAisle((s) => s.busy);

  const awaiting = campaigns.filter((c) => c.status === "awaiting_approval");
  const conflictCount = campaigns.reduce(
    (n, c) => n + c.scheduleConflicts.filter((x) => !x.resolved).length,
    0,
  );
  const blockedTotal = campaigns.reduce((n, c) => n + c.spend.blockedAttempts, 0);
  const live = campaigns.filter((c) =>
    ["analysing", "generating", "compliance", "revising", "scheduling"].includes(c.status),
  );
  const published = campaigns.filter((c) => c.status === "published");
  const hero = published.find((c) => c.creatives.length > 0);
  const recentLog = campaigns.flatMap((c) =>
    c.log.map((e) => ({ ...e, campaign: c.name, campaignId: c.id })),
  );
  recentLog.sort((a, b) => (a.at < b.at ? 1 : -1));

  const fresh = campaigns.length === 0;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-signal">
            {fresh ? "Aisle" : "This week"}
          </p>
          <h1 className="mt-1 font-serif text-4xl tracking-tight md:text-5xl">
            {fresh ? "Start with one brief." : `${brand.retailerName} is in cycle.`}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-soft">
            {fresh
              ? "Set the product, the audience, and the channels. Aisle researches, makes the creative, checks the claims, and waits for you before anything is published."
              : "You set the brief. Four agents research, make, check, and schedule. You approve what goes out."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/campaigns/new"
            className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm text-paper hover:bg-ink-soft"
          >
            <Plus size={14} /> New campaign
          </Link>
          {fresh ? (
            <Link
              href="/brand"
              className="inline-flex items-center gap-1.5 rounded-full border border-ink px-4 py-2 text-sm hover:bg-surface"
            >
              Set up brand
            </Link>
          ) : null}
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Awaiting you"
          value={String(awaiting.length)}
          hint={conflictCount > 0 ? `${conflictCount} schedule conflict(s)` : "Human-in-the-loop"}
        />
        <Stat label="Agents running" value={String(live.length)} hint="Active handoffs" />
        <Stat
          label="Blocked attempts"
          value={String(blockedTotal)}
          hint="Refused by the policy guard"
        />
        <Stat
          label="Reporting impressions"
          value={formatNumber(
            published.reduce((n, c) => n + (c.performanceReport?.totals?.impressions ?? 0), 0),
          )}
          hint="Collected channels only"
        />
      </section>

      <section>
        <SectionTitle kicker="The company" title="Four agents. One founder." />
        <div className="mt-5 grid gap-px overflow-hidden bg-line md:grid-cols-4">
          {bench.map((seat) => {
            const llm = getLlmOrDefault(settings.agents[seat.id].modelId);
            return (
              <div key={seat.id} className="bg-paper p-5">
                <p className="text-[11px] uppercase tracking-[0.16em] text-signal">{agentLabel[seat.id]}</p>
                <p className="mt-2 font-serif text-xl">{agentRole[seat.id]}</p>
                <p className="mt-2 text-sm text-ink-soft">Replaces: {seat.replaces}</p>
                <p className="mt-3 text-xs text-mute">
                  {llm.provider} · {llm.name}
                </p>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-mute">
          Pipeline: Trend Analyser → Image Generation → Compliance Checker → Media Manager →
          distribution. Backends are set in{" "}
          <Link href="/settings" className="text-signal hover:underline">
            Settings
          </Link>
          .
        </p>
      </section>

      {campaigns.some((c) => c.status === "published" && !c.performanceReport) ? (
        <section>
          <SectionTitle
            kicker="Results"
            title="Waiting to be collected"
            aside={
              <Link href="/performance" className="text-sm text-signal hover:underline">
                Open performance
              </Link>
            }
          />
          <ul className="mt-4 flex flex-col gap-2">
            {campaigns
              .filter((c) => c.status === "published" && !c.performanceReport)
              .map((c) => (
                <li key={c.id} className="hairline flex flex-wrap items-center justify-between gap-3 bg-surface p-4">
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-sm text-ink-soft">
                      Published on {c.channels.join(", ")} — collect authorised channel results.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy[c.id]}
                    onClick={() => void collectFeedback(c.id)}
                    className="rounded-full border border-ink px-4 py-2 text-sm disabled:opacity-50"
                  >
                    {busy[c.id] ? "Collecting…" : "Collect results"}
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      {awaiting.length > 0 ? (
        <section>
          <SectionTitle
            kicker="Exceptions"
            title="Needs your judgment"
            aside={
              <Link href="/approvals" className="text-sm text-signal hover:underline">
                Open queue
              </Link>
            }
          />
          <ul className="mt-4 grid gap-3">
            {awaiting.map((c) => {
              const report = c.complianceReports.at(-1);
              const manual = c.complianceAttempts.at(-1)?.outcome === "manual_review";
              return (
                <li key={c.id} className="hairline flex flex-wrap items-center justify-between gap-3 bg-surface p-4">
                  <div>
                    <p className="font-medium">
                      {c.name}
                      {manual ? (
                        <span className="ml-2 status-chip risk-high">manual review</span>
                      ) : null}
                    </p>
                    <p className="text-sm text-ink-soft">{report?.summary}</p>
                  </div>
                  <Link
                    href={`/campaigns/${c.id}`}
                    className="inline-flex items-center gap-1 text-sm text-signal"
                  >
                    Review <ArrowRight size={14} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div>
          <SectionTitle kicker="On the bench" title="Campaigns" />
          {campaigns.length === 0 ? (
            <p className="mt-4 text-sm text-ink-soft">
              No campaigns yet. Write the first brief and the agents will run it.
            </p>
          ) : null}
          <ul className="mt-4 flex flex-col gap-3">
            {campaigns.slice(0, 5).map((c) => (
              <li key={c.id}>
                <Link
                  href={`/campaigns/${c.id}`}
                  className="hairline block bg-surface p-4 transition hover:bg-surface"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-serif text-xl">{c.name}</p>
                      <p className="mt-1 text-sm text-ink-soft">
                        {c.product} · {c.targetAudience}
                      </p>
                    </div>
                    <StatusBadge status={c.status} />
                  </div>
                  <div className="mt-4">
                    <AgentPipeline status={c.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-6">
          {hero?.creatives[0] ? (
            <div>
              <SectionTitle kicker="In market" title="Hero creative" />
              <div className="mt-4 aspect-[4/5] max-h-[420px]">
                <AdCanvas creative={hero.creatives[0]} campaignId={hero.id} brandLabel={hero.sharedContext.retailer} className="h-full" />
              </div>
            </div>
          ) : null}
          <div>
            <SectionTitle kicker="Collaboration" title="Latest handoffs" />
            <div className="mt-4 max-h-[360px] overflow-y-auto pr-1 scrollbar-thin">
              <AgentLog events={recentLog.slice(0, 8)} dense />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
