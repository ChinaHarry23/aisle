"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const campaigns = useAisle((s) => s.campaigns);
  const brand = useAisle((s) => s.brand);
  const settings = useAisle((s) => s.settings);
  const createCampaign = useAisle((s) => s.createCampaign);
  const launch = useAisle((s) => s.launch);

  const awaiting = campaigns.filter((c) => c.status === "awaiting_approval");
  const live = campaigns.filter((c) =>
    ["analysing", "generating", "compliance", "revising", "scheduling"].includes(c.status),
  );
  const published = campaigns.filter((c) => c.status === "published");
  const scheduled = campaigns.filter((c) => c.status === "scheduled");
  const hero = published.find((c) => c.creatives.length > 0);
  const recentLog = campaigns.flatMap((c) =>
    c.log.map((e) => ({ ...e, campaign: c.name, campaignId: c.id })),
  );
  recentLog.sort((a, b) => (a.at < b.at ? 1 : -1));

  function watchLiveRun() {
    const id = createCampaign({
      name: "Trail Parka — mid-semester restock",
      product: "Northline Trail Parka (navy)",
      category: "Apparel",
      targetAudience: "Australian university students, 18–24",
      objective: "Promote our new winter jacket to Australian university students.",
      budget: 12000,
      channels: ["instagram", "web", "email", "digital_signage"],
      startDate: "2026-08-26",
      endDate: "2026-09-12",
      country: "AU",
      notes: "Keep it campus, not wilderness. Watch the compliance loop.",
    });
    launch(id);
    router.push(`/campaigns/${id}`);
  }

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-signal">Founder desk</p>
          <h1 className="mt-1 font-serif text-4xl tracking-tight md:text-5xl">
            {brand.retailerName} is in cycle.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-soft">
            Weekly catalogue energy across social, web, email, and in-store. You set the brief.
            Four agents research, make, check, and schedule. You handle the exceptions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={watchLiveRun}
            className="rounded-full bg-ink px-4 py-2 text-sm text-paper hover:bg-ink-soft"
          >
            Watch a live agent run
          </button>
          <Link
            href="/campaigns/new"
            className="inline-flex items-center gap-1.5 rounded-full border border-ink px-4 py-2 text-sm hover:bg-surface"
          >
            <Plus size={14} /> New campaign
          </Link>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Awaiting you" value={String(awaiting.length)} hint="Human-in-the-loop" />
        <Stat label="Agents running" value={String(live.length)} hint="Active handoffs" />
        <Stat label="Scheduled" value={String(scheduled.length)} hint="Ready to publish" />
        <Stat
          label="Published impressions"
          value={formatNumber(published.reduce((n, c) => n + (c.performance?.impressions ?? 0), 0))}
          hint="This cycle"
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
              return (
                <li key={c.id} className="hairline flex flex-wrap items-center justify-between gap-3 bg-surface p-4">
                  <div>
                    <p className="font-medium">{c.name}</p>
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
                <AdCanvas creative={hero.creatives[0]} className="h-full" />
              </div>
            </div>
          ) : null}
          <div>
            <SectionTitle kicker="Collaboration" title="Latest handoffs" />
            <div className="mt-4 max-h-[360px] overflow-y-auto pr-1 scrollbar-thin">
              <AgentLog
                events={recentLog.slice(0, 8).map(({ campaign: _c, campaignId: _id, ...e }) => e)}
                dense
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
