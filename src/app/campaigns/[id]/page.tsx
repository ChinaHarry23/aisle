"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AgentLog } from "@/components/AgentLog";
import { CreativeStudio } from "@/components/studio/CreativeStudio";
import {
  AgentPipeline,
  Confidence,
  Empty,
  RiskBadge,
  SectionTitle,
  StatusBadge,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDate, formatMoney } from "@/lib/ids";
import { channelLabel } from "@/lib/status";
import { useAisle } from "@/lib/store";

const tabs = [
  "brief",
  "research",
  "studio",
  "compliance",
  "channels",
  "log",
] as const;

type Tab = (typeof tabs)[number];

export default function CampaignWorkspace() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const campaign = useAisle((s) => s.campaigns.find((c) => c.id === id));
  const brand = useAisle((s) => s.brand);
  const launch = useAisle((s) => s.launch);
  const pause = useAisle((s) => s.pause);
  const approve = useAisle((s) => s.approve);
  const reject = useAisle((s) => s.reject);
  const requestChanges = useAisle((s) => s.requestChanges);
  const publish = useAisle((s) => s.publish);
  const [tab, setTab] = useState<Tab>("brief");
  const [note, setNote] = useState("");

  const latestReports = useMemo(() => {
    if (!campaign) return [];
    const maxV = Math.max(0, ...campaign.complianceReports.map((r) => r.version));
    return campaign.complianceReports.filter((r) => r.version === maxV);
  }, [campaign]);

  if (!campaign) {
    return (
      <Empty title="Campaign not found" body="It may have been cleared with a demo reset.">
        <Link href="/campaigns" className="text-sm text-signal">
          Back to board
        </Link>
      </Empty>
    );
  }

  const canLaunch = ["draft", "paused", "rejected"].includes(campaign.status);
  const needsYou = campaign.status === "awaiting_approval";
  const canPublish = campaign.status === "scheduled";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/campaigns" className="text-xs uppercase tracking-wider text-mute hover:text-ink">
          ← Board
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-serif text-4xl tracking-tight">{campaign.name}</h1>
              <StatusBadge status={campaign.status} />
            </div>
            <p className="mt-2 text-sm text-ink-soft">
              {campaign.product} · {campaign.targetAudience} · {formatMoney(campaign.budget)} ·{" "}
              {campaign.country}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canLaunch ? (
              <button
                type="button"
                onClick={() => launch(campaign.id)}
                className="rounded-full bg-ink px-4 py-2 text-sm text-paper"
              >
                Launch agents
              </button>
            ) : null}
            {campaign.running ? (
              <button
                type="button"
                onClick={() => pause(campaign.id)}
                className="rounded-full border border-ink px-4 py-2 text-sm"
              >
                Pause
              </button>
            ) : null}
            {canPublish ? (
              <button
                type="button"
                onClick={() => publish(campaign.id)}
                className="rounded-full bg-signal px-4 py-2 text-sm text-paper"
              >
                Publish now
              </button>
            ) : null}
          </div>
        </div>
        <div className="mt-6">
          <AgentPipeline status={campaign.status} />
        </div>
      </div>

      {needsYou ? (
        <section className="border border-signal/30 bg-surface p-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-signal">
            Human-in-the-loop
          </p>
          <h2 className="mt-1 font-serif text-2xl">This cannot publish without you.</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">
            {latestReports[0]?.summary ??
              "Compliance escalated an uncertain or high-visibility decision."}
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Founder note — this is written back into shared context for the next agent."
            rows={2}
            className="mt-4 w-full border border-line px-3 py-2 text-sm outline-none focus:border-ink"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => approve(campaign.id, note)}
              className="rounded-full bg-ink px-4 py-2 text-sm text-paper"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => requestChanges(campaign.id, note || "Please revise to founder notes.")}
              className="rounded-full border border-ink px-4 py-2 text-sm"
            >
              Request changes
            </button>
            <button
              type="button"
              onClick={() => reject(campaign.id, note || "Killed by founder.")}
              className="rounded-full border border-signal px-4 py-2 text-sm text-signal"
            >
              Reject
            </button>
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-1 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "px-3 py-2 text-sm capitalize",
              tab === t ? "border-b-2 border-ink text-ink" : "text-mute hover:text-ink",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "brief" ? (
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="hairline bg-surface p-5">
            <SectionTitle kicker="Shared campaign context" title="What every agent sees" />
            <dl className="mt-4 grid gap-3 text-sm">
              <Row k="Retailer" v={campaign.sharedContext.retailer} />
              <Row k="Product" v={campaign.sharedContext.product} />
              <Row k="Audience" v={campaign.sharedContext.audience} />
              <Row k="Objective" v={campaign.sharedContext.objective} />
              <Row k="Market" v={`${campaign.country} — ${brand.countryRules[campaign.country]}`} />
              <Row k="Tone" v={campaign.sharedContext.brandTone} />
              <Row
                k="Approved claims"
                v={
                  campaign.sharedContext.approvedClaims.length
                    ? campaign.sharedContext.approvedClaims.join(" · ")
                    : "None yet — Trend Analyser will propose them."
                }
              />
              <Row
                k="Prior performance"
                v={campaign.sharedContext.previousPerformanceNote ?? "No previous cycle fed in."}
              />
              <Row
                k="Founder notes"
                v={
                  campaign.sharedContext.founderNotes.length
                    ? campaign.sharedContext.founderNotes.join(" / ")
                    : "—"
                }
              />
            </dl>
          </div>
          <div className="hairline bg-surface p-5">
            <SectionTitle kicker="Campaign brief" title={campaign.brief?.angle ?? "Waiting on Trend Analyser"} />
            {campaign.brief ? (
              <div className="mt-4 space-y-3 text-sm leading-relaxed">
                <p>
                  <span className="text-mute">Key message. </span>
                  {campaign.brief.keyMessage}
                </p>
                <p>
                  <span className="text-mute">Visual. </span>
                  {campaign.brief.visualDirection}
                </p>
                <p>
                  <span className="text-mute">Say. </span>
                  {campaign.brief.claimsAllowed.join(" · ")}
                </p>
                <p>
                  <span className="text-mute">Do not say. </span>
                  {campaign.brief.claimsAvoid.join(" · ")}
                </p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-ink-soft">
                Launch agents to produce a structured brief the creative agent can actually use.
              </p>
            )}
            {campaign.running ? (
              <p className="mt-6 text-sm text-signal">Agents are working this campaign now.</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {tab === "research" ? (
        <section className="flex flex-col gap-8">
          <div>
            <SectionTitle kicker="Market trend analysis" title="What is worth promoting this cycle" />
            <ul className="mt-4 grid gap-3 md:grid-cols-2">
              {campaign.trends.map((t) => (
                <li key={t.id} className="hairline bg-surface p-4">
                  <p className="text-[11px] uppercase tracking-wider text-mute">{t.source}</p>
                  <h3 className="mt-1 font-serif text-xl">{t.topic}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">{t.evidence}</p>
                  <div className="mt-4 flex gap-6">
                    <Confidence value={t.relevance} label="Relevance" />
                    <Confidence value={t.confidence} />
                  </div>
                </li>
              ))}
            </ul>
            {campaign.trends.length === 0 ? (
              <p className="mt-3 text-sm text-mute">No trends yet.</p>
            ) : null}
          </div>
          <div>
            <SectionTitle kicker="Opportunities" title="Ranked for this retailer" />
            <ol className="mt-4 flex flex-col gap-3">
              {campaign.opportunities.map((o) => (
                <li key={o.id} className="hairline flex gap-4 bg-surface p-4">
                  <span className="font-serif text-2xl text-signal">{o.rank}</span>
                  <div>
                    <h3 className="font-medium">{o.title}</h3>
                    <p className="mt-1 text-sm text-ink-soft">{o.why}</p>
                    <p className="mt-2 text-xs text-mute">
                      Audience fit {o.audienceFit}% · {o.expectedValue}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <SectionTitle kicker="Optional · personas" title="Who the other agents should write for" />
            <ul className="mt-4 grid gap-3 md:grid-cols-2">
              {campaign.personas.map((p) => (
                <li key={p.id} className="hairline bg-surface p-4">
                  <h3 className="font-serif text-xl">{p.name}</h3>
                  <p className="text-xs text-mute">{p.age}</p>
                  <p className="mt-2 text-sm text-ink-soft">{p.summary}</p>
                  <p className="mt-3 text-xs text-mute">
                    {p.channels.join(" · ")} — {p.motivations.join(", ")}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {tab === "studio" ? <CreativeStudio campaign={campaign} /> : null}

      {tab === "compliance" ? (
        <section className="flex flex-col gap-4">
          <SectionTitle
            kicker="Automated review + revision loop"
            title="Why it was flagged — not just pass/fail"
          />
          {campaign.complianceReports.length === 0 ? (
            <p className="text-sm text-mute">No reports yet.</p>
          ) : (
            [...campaign.complianceReports].reverse().map((r) => (
              <article key={r.id} className="hairline bg-surface p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <RiskBadge risk={r.risk} />
                  <span className="text-xs uppercase tracking-wider text-mute">
                    v{r.version} · {r.verdict} · score {r.score}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-relaxed">{r.summary}</p>
                <p className="mt-2 text-xs text-mute">{r.countryProfile}</p>
                <ul className="mt-4 flex flex-col gap-3">
                  {r.findings.map((f) => (
                    <li key={f.id} className="border-l-2 border-signal pl-3">
                      <p className="text-xs uppercase tracking-wider text-signal">
                        {f.type} · {f.severity}
                      </p>
                      <p className="mt-1 font-serif text-lg">“{f.excerpt}”</p>
                      <p className="mt-1 text-sm text-ink-soft">{f.explanation}</p>
                      <p className="mt-1 text-xs text-mute">{f.rule}</p>
                    </li>
                  ))}
                </ul>
              </article>
            ))
          )}
        </section>
      ) : null}

      {tab === "channels" ? (
        <section className="flex flex-col gap-6">
          <SectionTitle kicker="Media manager" title="Adapt, schedule, distribute" />
          {campaign.adaptations.length === 0 ? (
            <p className="text-sm text-mute">
              Channel versions appear after approval. Optimal posting times use audience behaviour
              plus any historical performance.
            </p>
          ) : (
            <ul className="grid gap-3">
              {campaign.adaptations.map((a) => (
                <li key={a.channel} className="hairline bg-surface p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-serif text-xl">{channelLabel[a.channel]}</h3>
                    <span className="text-xs uppercase tracking-wider text-signal">{a.postingTime}</span>
                  </div>
                  <p className="mt-2 font-medium">{a.headline}</p>
                  <p className="mt-1 text-sm text-ink-soft">{a.body}</p>
                  <p className="mt-3 text-xs text-mute">
                    {a.specs} — {a.postingReason}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {campaign.schedule.length > 0 ? (
            <div>
              <h3 className="text-[11px] uppercase tracking-wider text-mute">Schedule</h3>
              <ul className="mt-2 divide-y divide-line border-y border-line">
                {campaign.schedule.map((s) => (
                  <li key={s.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                    <span>
                      {channelLabel[s.channel]} · {s.note}
                    </span>
                    <span className="text-mute">
                      {formatDate(s.at, true)} · {s.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {campaign.performance ? (
            <div className="hairline bg-ink p-5 text-paper">
              <p className="text-[11px] uppercase tracking-[0.16em] text-signal">Feedback loop</p>
              <p className="mt-2 font-serif text-2xl">{campaign.performance.summary}</p>
              <p className="mt-3 text-sm text-white/70">{campaign.performance.recommendation}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "log" ? (
        <section>
          <SectionTitle kicker="Collaboration" title="Every handoff, flag, and decision" />
          <div className="mt-5">
            <AgentLog events={campaign.log} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-mute">{k}</dt>
      <dd className="mt-0.5 leading-relaxed">{v}</dd>
    </div>
  );
}
