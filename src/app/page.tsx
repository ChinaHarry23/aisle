"use client";

import Link from "next/link";
import { useEffect, useState, type ComponentType } from "react";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  Clapperboard,
  LineChart,
  Megaphone,
  Plus,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { AgentPipeline, StatusBadge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { getLlmOrDefault } from "@/lib/llm/catalog";
import type { AgentSlot } from "@/lib/llm/types";
import { useAisle } from "@/lib/store";
import type { CampaignStatus } from "@/lib/types";

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

type Stage = {
  id: AgentSlot | "create" | "founder";
  step: number;
  name: string;
  does: string;
  icon: Icon;
  statuses: CampaignStatus[];
  href: string;
};

const stages: Stage[] = [
  {
    id: "create",
    step: 1,
    name: "Campaigns",
    does: "Add a product and an audience.",
    icon: Megaphone,
    statuses: ["draft"],
    href: "/campaigns/new",
  },
  {
    id: "trend",
    step: 2,
    name: "Trends",
    does: "Finds what's selling and drafts the brief.",
    icon: TrendingUp,
    statuses: ["analysing"],
    href: "/trends",
  },
  {
    id: "creative",
    step: 3,
    name: "Studio",
    does: "Creates the ad copy and visuals.",
    icon: Clapperboard,
    statuses: ["generating"],
    href: "/studio",
  },
  {
    id: "compliance",
    step: 4,
    name: "Compliance",
    does: "Checks guidelines and country rules, and sends fixes back.",
    icon: ShieldCheck,
    statuses: ["compliance", "revising"],
    href: "/campaigns",
  },
  {
    id: "founder",
    step: 5,
    name: "Approvals",
    does: "You sign off anything medium or high risk.",
    icon: ShieldAlert,
    statuses: ["awaiting_approval"],
    href: "/approvals",
  },
  {
    id: "media",
    step: 6,
    name: "Schedule",
    does: "Posts approved work to every channel.",
    icon: CalendarDays,
    statuses: ["scheduling", "scheduled"],
    href: "/schedule",
  },
];

const agentStages = stages.filter((s) => s.id !== "create");

function StageIcon({ icon: Icon, human, size }: { icon: Icon; human: boolean; size: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center",
        size === "md" ? "h-9 w-9 rounded-xl" : "h-8 w-8 rounded-lg",
        human ? "bg-signal text-paper" : "bg-paper-2 text-ink",
      )}
    >
      <Icon size={size === "md" ? 18 : 15} strokeWidth={1.8} />
    </span>
  );
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

export default function OverviewPage() {
  const campaigns = useAisle((s) => s.campaigns);
  const brand = useAisle((s) => s.brand);
  const settings = useAisle((s) => s.settings);
  const collectFeedback = useAisle((s) => s.collectFeedback);
  const busy = useAisle((s) => s.busy);
  const [firstName, setFirstName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { user?: { name?: string } | null } | null) => {
        const name = json?.user?.name?.trim().split(/\s+/)[0];
        if (!cancelled && name) setFirstName(name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const awaiting = campaigns.filter((c) => c.status === "awaiting_approval");
  const toCollect = campaigns.filter((c) => c.status === "published" && !c.performanceReport);
  const conflicts = campaigns.reduce(
    (n, c) => n + c.scheduleConflicts.filter((x) => !x.resolved).length,
    0,
  );
  const published = campaigns.filter((c) => c.status === "published").length;
  const countIn = (statuses: CampaignStatus[]) =>
    campaigns.filter((c) => statuses.includes(c.status)).length;
  const working = stages
    .filter((s) => s.id !== "create" && s.id !== "founder")
    .reduce((n, s) => n + countIn(s.statuses), 0);

  const kpis: { label: string; value: number; hint: string; href: string; icon: Icon; hot?: boolean }[] = [
    {
      label: "In progress",
      value: working,
      hint: working === 1 ? "campaign with the agents" : "campaigns with the agents",
      href: "/campaigns",
      icon: Activity,
      hot: working > 0,
    },
    {
      label: "Awaiting approval",
      value: awaiting.length,
      hint: awaiting.length > 0 ? "ready for your review" : "nothing waiting",
      href: "/approvals",
      icon: ShieldAlert,
      hot: awaiting.length > 0,
    },
    {
      label: "Published",
      value: published,
      hint: toCollect.length > 0 ? `${toCollect.length} awaiting results` : "campaigns live",
      href: "/performance",
      icon: LineChart,
    },
    {
      label: "Schedule conflicts",
      value: conflicts,
      hint: conflicts > 0 ? "need resolving" : "all clear",
      href: "/schedule",
      icon: CalendarDays,
      hot: conflicts > 0,
    },
  ];

  const isNew = campaigns.length === 0;

  const stageStatus = (stage: Stage) => {
    const n = countIn(stage.statuses);
    const isHuman = stage.id === "create" || stage.id === "founder";
    const model = isHuman ? null : getLlmOrDefault(settings.agents[stage.id as AgentSlot].modelId);
    return { n, isHuman, model };
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Welcome */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[18rem] flex-1">
          <p className="text-sm text-mute">{greeting()}</p>
          <h1 className="mt-1 font-serif text-2xl tracking-tight md:text-3xl">
            Welcome to Aisle{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-2 max-w-4xl text-[15px] leading-relaxed text-ink-soft">
            {isNew
              ? `Aisle is a marketing team for ${brand.retailerName}, run by AI agents. Give it a brief for a promotion and the agents research trends, create the images and copy, check everything for legal and brand risk, and schedule it across web, social media and print. Nothing goes live until you approve it.`
              : `Your AI marketing team for ${brand.retailerName}. Nothing goes live until you approve it.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:pt-1">
          <Link
            href="/campaigns/new"
            className="inline-flex items-center gap-2 rounded-full btn-primary px-4 py-2 text-sm font-medium"
          >
            <Plus size={16} /> New campaign
          </Link>
        </div>
      </header>

      {/* What needs the user */}
      {awaiting.length > 0 || toCollect.length > 0 || conflicts > 0 ? (
        <section aria-label="Needs your attention" className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-signal">
            Needs your attention
          </h2>
          <ul className="flex flex-col gap-2">
            {awaiting.map((c) => {
              const manual = c.complianceAttempts.at(-1)?.outcome === "manual_review";
              return (
                <li key={c.id}>
                  <Link
                    href={`/campaigns/${c.id}`}
                    className="hairline flex items-center justify-between gap-4 p-4 hairline-hover"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {c.name}
                        {manual ? (
                          <span className="ml-2 status-chip risk-high">manual review</span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 truncate text-sm text-ink-soft">
                        {c.complianceReports.at(-1)?.summary ?? "Ready for your sign-off."}
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-signal">
                      Review <ArrowRight size={14} />
                    </span>
                  </Link>
                </li>
              );
            })}
            {toCollect.map((c) => (
              <li
                key={c.id}
                className="hairline flex items-center justify-between gap-4 p-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="mt-0.5 text-sm text-ink-soft">
                    Live. Pull in results from your channels.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy[c.id]}
                  onClick={() => void collectFeedback(c.id)}
                  className="shrink-0 rounded-full border border-line px-4 py-1.5 text-sm font-medium hover:bg-paper-2 disabled:opacity-50"
                >
                  {busy[c.id] ? "Collecting…" : "Collect results"}
                </button>
              </li>
            ))}
            {conflicts > 0 ? (
              <li>
                <Link
                  href="/schedule"
                  className="hairline flex items-center justify-between gap-4 p-4 hairline-hover"
                >
                  <p className="font-medium">
                    {conflicts} schedule conflict{conflicts === 1 ? "" : "s"} to resolve
                  </p>
                  <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-signal">
                    Open schedule <ArrowRight size={14} />
                  </span>
                </Link>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {/* At a glance */}
      <section aria-label="At a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Link key={k.label} href={k.href} className="hairline hairline-hover p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-soft">{k.label}</span>
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg",
                    k.hot ? "bg-signal-soft text-signal" : "bg-paper-2 text-ink-soft",
                  )}
                >
                  <Icon size={16} strokeWidth={1.8} />
                </span>
              </div>
              <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">{k.value}</p>
              <p className="mt-0.5 text-xs text-mute">{k.hint}</p>
            </Link>
          );
        })}
      </section>

      {isNew ? (
        <>
          {/* First visit: a call to action, then the full explanation */}
          <section aria-label="Campaigns" className="hairline flex flex-col items-start gap-3 p-8">
            <h2 className="font-serif text-xl">No campaigns yet</h2>
            <p className="max-w-md text-sm text-ink-soft">
              Add a product and an audience. The agents handle the rest.
            </p>
            <Link
              href="/campaigns/new"
              className="inline-flex items-center gap-2 rounded-full btn-primary px-4 py-2 text-sm font-medium"
            >
              <Plus size={14} /> Create your first campaign
            </Link>
          </section>

          <section aria-label="How it works" className="flex flex-col gap-4">
            <div>
              <h2 className="font-serif text-lg md:text-xl">How it works</h2>
              <p className="mt-1 text-sm text-ink-soft">
                Start a campaign and five agents take it through to publishing.
              </p>
            </div>
            <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:gap-6">
              {agentStages.map((stage, i) => (
                <li key={stage.id} className="relative">
                  <Link
                    href={stage.href}
                    className="hairline flex h-full flex-col gap-3 p-4 hairline-hover"
                  >
                    <div className="flex items-center justify-between">
                      <StageIcon icon={stage.icon} human={false} size="md" />
                      <span className="text-xs tabular-nums text-mute">Step {i + 1}</span>
                    </div>
                    <div>
                      <p className="font-semibold">{stage.name}</p>
                      <p className="mt-0.5 text-sm leading-snug text-ink-soft">{stage.does}</p>
                    </div>
                  </Link>
                  {i < agentStages.length - 1 && (
                    <ArrowRight
                      aria-hidden
                      size={16}
                      className="absolute -right-5 top-1/2 hidden -translate-y-1/2 text-mute lg:block"
                    />
                  )}
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {/* Campaigns */}
          <section aria-label="Campaigns" className="flex flex-col gap-4">
            <div className="flex items-end justify-between gap-3">
              <h2 className="font-serif text-lg md:text-xl">Your campaigns</h2>
              <Link href="/campaigns" className="text-sm text-signal hover:underline">
                View all
              </Link>
            </div>
            <ul className="flex flex-col gap-3">
              {campaigns.slice(0, 4).map((c) => (
                <li key={c.id}>
                  <Link href={`/campaigns/${c.id}`} className="hairline block p-4 hairline-hover">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{c.name}</p>
                        <p className="mt-0.5 truncate text-sm text-ink-soft">
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
          </section>

          {/* Agent status */}
          <aside aria-label="Your agents" className="hairline p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-serif text-lg">Your agents</h2>
              <Link href="/settings" className="text-xs text-mute hover:text-signal">
                Change models
              </Link>
            </div>
            <ul className="mt-3 flex flex-col">
              {agentStages.map((stage) => {
                const { n, isHuman, model } = stageStatus(stage);
                return (
                  <li key={stage.id} className="border-t border-line first:border-t-0">
                    <Link
                      href={stage.href}
                      className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-paper-2"
                    >
                      <StageIcon icon={stage.icon} human={false} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{stage.name}</span>
                        <span className="block truncate text-xs text-mute">
                          {model ? model.name : "You"}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1.5 text-xs",
                          n > 0 ? "font-medium text-signal" : "text-mute",
                        )}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            n > 0 ? "animate-pulse bg-signal" : "bg-line",
                          )}
                        />
                        {n > 0 ? (isHuman ? `${n} waiting` : `${n} active`) : "Idle"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </aside>
        </div>
      )}
    </div>
  );
}
