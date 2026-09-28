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
  Stat,
  StatusBadge,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDate, formatMoney, formatNumber } from "@/lib/ids";
import { channelLabel } from "@/lib/status";
import { useAisle } from "@/lib/store";

const tabs = [
  "brief",
  "research",
  "studio",
  "compliance",
  "channels",
  "feedback",
  "runtime",
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
  const collectFeedback = useAisle((s) => s.collectFeedback);
  const decideRecommendation = useAisle((s) => s.decideRecommendation);
  const resolveConflict = useAisle((s) => s.resolveConflict);
  const attemptBlocked = useAisle((s) => s.attemptBlocked);
  const busy = useAisle((s) => s.busy[id] ?? false);
  const [tab, setTab] = useState<Tab>("brief");
  const [note, setNote] = useState("");
  const [recommendationDraft, setRecommendationDraft] = useState<string | null>(null);
  const [boundaryResult, setBoundaryResult] = useState<string | null>(null);

  const latestReports = useMemo(() => {
    if (!campaign) return [];
    const maxV = Math.max(0, ...campaign.complianceReports.map((r) => r.version));
    return campaign.complianceReports.filter((r) => r.version === maxV);
  }, [campaign]);

  const latestAttempt = campaign?.complianceAttempts.at(-1) ?? null;
  const evidenceById = useMemo(
    () => new Map((campaign?.evidence ?? []).map((e) => [e.id, e])),
    [campaign],
  );
  const run = campaign?.run ?? null;
  const recommendText =
    recommendationDraft ??
    campaign?.performanceReport?.recommendationText ??
    campaign?.performanceReport?.summary ??
    "";

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
                onClick={() => void launch(campaign.id)}
                className="rounded-full bg-ink px-4 py-2 text-sm text-paper"
              >
                Launch agents
              </button>
            ) : null}
            {campaign.running ? (
              <button
                type="button"
                onClick={() => void pause(campaign.id)}
                className="rounded-full border border-ink px-4 py-2 text-sm"
              >
                Pause
              </button>
            ) : null}
            {canPublish ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void publish(campaign.id)}
                className="rounded-full bg-signal px-4 py-2 text-sm text-paper disabled:opacity-50"
              >
                {busy ? "Working…" : "Publish now"}
              </button>
            ) : null}
            {campaign.status === "published" && !campaign.performanceReport ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void collectFeedback(campaign.id)}
                className="rounded-full border border-ink px-4 py-2 text-sm disabled:opacity-50"
              >
                {busy ? "Collecting…" : "Collect results"}
              </button>
            ) : null}
          </div>
        </div>
        <div className="mt-6">
          <AgentPipeline status={campaign.status} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mute">
          {run ? (
            <span>
              bench{" "}
              <span className="text-ink">
                {run.status.replace(/_/g, " ")}
                {run.step ? ` · ${run.step}` : ""}
              </span>
              {run.stepsTaken > 0 ? ` · ${run.stepsTaken} step(s) this run` : ""}
            </span>
          ) : (
            <span>bench idle</span>
          )}
          <span>
            automated spend{" "}
            <span className="text-ink">
              ${(campaign.spend.inferenceUsd + campaign.spend.mediaUsd).toFixed(3)}
            </span>{" "}
            of ${campaign.spend.capUsd.toFixed(2)}
          </span>
          {campaign.spend.blockedAttempts > 0 ? (
            <span className="text-signal">{campaign.spend.blockedAttempts} blocked attempt(s)</span>
          ) : null}
          {campaign.trendGaps.length > 0 ? (
            <span>{campaign.trendGaps.length} recorded limitation(s)</span>
          ) : null}
        </div>
        {campaign.validationProblems.length > 0 ? (
          <ul className="mt-4 border border-signal/40 bg-surface p-4 text-sm">
            <li className="text-[11px] uppercase tracking-wider text-signal">
              Launch refused — the pipeline did not start
            </li>
            {campaign.validationProblems.map((p) => (
              <li key={`${p.field}-${p.message}`} className="mt-1 text-ink-soft">
                {p.field}: {p.message} <span className="text-mute">({p.clause})</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {needsYou ? (
        <section className="border border-signal/30 bg-surface p-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-signal">
            Human-in-the-loop
          </p>
          <h2 className="mt-1 font-serif text-2xl">This cannot publish without you.</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">
            {latestAttempt?.outcome === "manual_review"
              ? `Manual review: ${latestAttempt.attempt} compliance attempts were spent without clearing the copy. Every version, input and rejection reason is retained.`
              : (latestReports[0]?.summary ??
                "Compliance escalated an uncertain or high-visibility decision.")}
          </p>
          {latestAttempt ? (
            <p className="mt-2 text-xs text-mute">
              Attempt {latestAttempt.attempt} of 3 · v{latestAttempt.creativeVersion} · input digest{" "}
              {latestAttempt.inputDigest.split(" · ")[0]} · policies:{" "}
              {latestAttempt.policyRefs.join(", ")}
            </p>
          ) : null}
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
              onClick={() => void approve(campaign.id, note)}
              className="rounded-full bg-ink px-4 py-2 text-sm text-paper"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => void requestChanges(campaign.id, note || "Please revise to founder notes.")}
              className="rounded-full border border-ink px-4 py-2 text-sm"
            >
              Request changes
            </button>
            <button
              type="button"
              onClick={() => void reject(campaign.id, note || "Killed by founder.")}
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

          {campaign.trendFindings.length > 0 ? (
            <div>
              <SectionTitle
                kicker="AHR-02 · evidence discipline"
                title="Supported findings, separated from assumptions"
              />
              <ul className="mt-4 grid gap-3">
                {campaign.trendFindings.map((f) => (
                  <li key={f.id} className="hairline bg-surface p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "status-chip",
                          f.basis === "supported" ? "risk-low" : "risk-mid",
                        )}
                      >
                        {f.basis === "supported" ? "cited source" : "assumption"}
                      </span>
                      <span className="text-xs text-mute">
                        relevance {f.relevance}% · confidence {f.confidence}%
                      </span>
                    </div>
                    <h3 className="mt-2 font-serif text-xl">{f.topic}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-ink-soft">{f.finding}</p>
                    {f.risk ? <p className="mt-2 text-sm text-signal">Risk: {f.risk}</p> : null}
                    {f.evidenceIds.length > 0 ? (
                      <ul className="mt-3 flex flex-col gap-1 text-xs text-mute">
                        {f.evidenceIds.map((eid) => {
                          const ev = evidenceById.get(eid);
                          if (!ev) return null;
                          return (
                            <li key={eid}>
                              ↳ {ev.sourceName} · observed {ev.observedAt} · {ev.status} ·{" "}
                              {ev.confidence}%
                              {ev.sourceRef ? (
                                <>
                                  {" · "}
                                  {/^https?:/.test(ev.sourceRef) ? (
                                    <a
                                      href={ev.sourceRef}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-signal hover:underline"
                                    >
                                      source
                                    </a>
                                  ) : (
                                    <span>{ev.sourceRef}</span>
                                  )}
                                </>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {campaign.trendGaps.length > 0 ? (
            <div>
              <SectionTitle
                kicker="AHR-02 · limitations"
                title="What the analysis could not establish"
                aside={
                  campaign.trendGaps.some((g) => g.needsFounder) ? (
                    <span className="status-chip status-wait">founder asked</span>
                  ) : null
                }
              />
              <ul className="mt-4 flex flex-col gap-2">
                {campaign.trendGaps.map((g) => (
                  <li key={g.id} className="hairline bg-surface p-3 text-sm">
                    <span className="text-[10px] uppercase tracking-wider text-signal">
                      {g.kind.replace(/_/g, " ")}
                    </span>
                    <p className="mt-1">{g.detail}</p>
                    <p className="mt-1 text-mute">Effect: {g.effect}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {campaign.evidence.length > 0 ? (
            <div>
              <SectionTitle
                kicker="Evidence ledger"
                title={`${campaign.evidence.length} recorded source(s)`}
              />
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[46rem] border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-mute">
                      <th className="border-b border-line py-2 pr-3">Claim</th>
                      <th className="border-b border-line py-2 pr-3">Source</th>
                      <th className="border-b border-line py-2 pr-3">Observed</th>
                      <th className="border-b border-line py-2 pr-3">Kind</th>
                      <th className="border-b border-line py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaign.evidence.map((e) => (
                      <tr key={e.id} className="align-top">
                        <td className="border-b border-line py-2 pr-3">
                          <span className="font-medium">{e.claim}</span>
                          <span className="mt-0.5 block text-xs text-ink-soft">
                            {e.detail.slice(0, 150)}
                          </span>
                        </td>
                        <td className="border-b border-line py-2 pr-3 text-xs">{e.sourceName}</td>
                        <td className="border-b border-line py-2 pr-3 text-xs tabular-nums">
                          {e.observedAt}
                        </td>
                        <td className="border-b border-line py-2 pr-3 text-xs">
                          {e.sourceKind.replace(/_/g, " ")}
                        </td>
                        <td className="border-b border-line py-2 text-xs">
                          <span
                            className={cn(
                              "status-chip",
                              e.status === "verified"
                                ? "risk-low"
                                : e.status === "assumed"
                                  ? "risk-mid"
                                  : "risk-high",
                            )}
                          >
                            {e.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

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
          {latestAttempt ? (
            <article className="hairline border-l-4 border-signal bg-surface p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "status-chip",
                    latestAttempt.outcome === "pass"
                      ? "risk-low"
                      : latestAttempt.outcome === "manual_review"
                        ? "risk-high"
                        : "risk-mid",
                  )}
                >
                  {latestAttempt.outcome.replace(/_/g, " ")}
                </span>
                <span className="text-xs text-mute">
                  attempt {latestAttempt.attempt} of 3 · reviewed v{latestAttempt.creativeVersion} ·{" "}
                  {latestAttempt.modelId}
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed">{latestAttempt.summary}</p>
              <p className="mt-2 text-xs text-mute">
                Inputs recorded: {latestAttempt.inputDigest}
              </p>
              <p className="mt-1 text-xs text-mute">
                Policies applied: {latestAttempt.policyRefs.join(" · ")} ·{" "}
                {latestAttempt.policyComplete ? "policy set complete" : "policy set incomplete"}
              </p>
              {latestAttempt.issues.length > 0 ? (
                <ul className="mt-4 flex flex-col gap-3">
                  {latestAttempt.issues.map((issue) => (
                    <li key={issue.id} className="border-l-2 border-line pl-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "status-chip",
                            issue.basis === "confirmed_breach" ? "risk-high" : "risk-mid",
                          )}
                        >
                          {issue.basis === "confirmed_breach" ? "confirmed breach" : "human judgement"}
                        </span>
                        <span className="text-[10px] uppercase tracking-wider text-mute">
                          {issue.category.replace(/_/g, " ")} · {issue.severity}
                        </span>
                      </div>
                      {issue.excerpt !== "—" ? (
                        <p className="mt-1 font-serif text-lg">“{issue.excerpt}”</p>
                      ) : null}
                      <p className="mt-1 text-sm text-ink-soft">{issue.explanation}</p>
                      <p className="mt-1 text-xs text-mute">
                        {issue.rule} · {issue.policySource} · {issue.policyDate}
                      </p>
                      <p className="mt-1 text-sm text-signal">
                        Fix: {issue.recommendedCorrection}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ) : null}

          {campaign.complianceAttempts.length > 1 ? (
            <div className="hairline bg-surface p-4">
              <p className="text-[11px] uppercase tracking-wider text-mute">
                Revision trail (every submitted version is retained)
              </p>
              <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {campaign.complianceAttempts.map((a) => (
                  <li key={a.id}>
                    attempt {a.attempt}: v{a.creativeVersion} →{" "}
                    <span className="text-ink">{a.outcome.replace(/_/g, " ")}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

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
          {campaign.channelVersions.length > 0 ? (
            <div>
              <h3 className="text-[11px] uppercase tracking-wider text-mute">
                Channel versions — claims frozen at approval
              </h3>
              <ul className="mt-2 flex flex-col gap-2">
                {campaign.channelVersions.map((v) => (
                  <li key={v.id} className="hairline bg-surface p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{channelLabel[v.channel]}</span>
                      <span
                        className={cn(
                          "status-chip",
                          v.status === "published"
                            ? "risk-low"
                            : v.status === "failed"
                              ? "risk-high"
                              : "status-run",
                        )}
                      >
                        {v.status}
                      </span>
                      <span className="text-xs text-mute">
                        {v.claimsUnchanged
                          ? "cleared wording intact"
                          : "blocked — wording would have changed"}
                      </span>
                    </div>
                    <p className="mt-2 text-ink-soft">{v.body}</p>
                    <p className="mt-1 text-xs text-mute">
                      carries: {v.approvedClaims.join(" · ") || "no claims recorded"}
                    </p>
                    {v.failure ? <p className="mt-1 text-xs text-signal">{v.failure}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {campaign.scheduleConflicts.length > 0 ? (
            <div>
              <h3 className="text-[11px] uppercase tracking-wider text-mute">
                Scheduling conflicts — flagged, not resolved silently
              </h3>
              <ul className="mt-2 flex flex-col gap-2">
                {campaign.scheduleConflicts.map((c) => (
                  <li key={c.id} className="hairline bg-surface p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="status-chip risk-mid">{c.kind.replace(/_/g, " ")}</span>
                      <span className="font-medium">{channelLabel[c.channel]}</span>
                      <span className="text-xs text-mute">{formatDate(c.at, true)}</span>
                      {c.resolved ? (
                        <span className="status-chip risk-low">resolved</span>
                      ) : (
                        <span className="status-chip status-wait">needs founder</span>
                      )}
                    </div>
                    <p className="mt-1 text-ink-soft">{c.detail}</p>
                    {!c.resolved ? (
                      <button
                        type="button"
                        onClick={() =>
                          void resolveConflict(
                            campaign.id,
                            c.id,
                            note || "Accepted as-is by the founder.",
                          )
                        }
                        className="mt-2 rounded-full border border-ink px-3 py-1 text-xs"
                      >
                        Accept and continue
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

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
          {campaign.performanceReport ? (
            <button
              type="button"
              onClick={() => setTab("feedback")}
              className="hairline bg-ink p-5 text-left text-paper"
            >
              <p className="text-[11px] uppercase tracking-[0.16em] text-signal">
                Feedback loop — open the results
              </p>
              <p className="mt-2 font-serif text-2xl">{campaign.performanceReport.summary}</p>
              <p className="mt-3 text-sm text-white/70">
                {campaign.performanceReport.recommendationUnsupported
                  ? "No sourced recommendation could be produced from the collected data."
                  : (campaign.performanceReport.recommendationText ?? "Recommendation attached.")}
              </p>
            </button>
          ) : null}
        </section>
      ) : null}

      {tab === "feedback" ? (
        <section className="flex flex-col gap-6">
          <SectionTitle
            kicker="AHR-06 · performance"
            title="What actually ran, and what it supports"
            aside={
              campaign.status === "published" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void collectFeedback(campaign.id)}
                  className="rounded-full border border-ink px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  {campaign.performanceReport ? "Collect again" : "Collect results"}
                </button>
              ) : null
            }
          />

          {!campaign.performanceReport ? (
            <Empty
              title="No results collected yet"
              body={
                campaign.status === "published"
                  ? "The campaign is published. Collect authorised channel results to build the summary."
                  : "Results are only collected from a campaign published through the approved path. A draft or rejected campaign is never treated as live (UC-06 ext 2.a)."
              }
            />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-4">
                <Stat
                  label="Impressions"
                  value={
                    campaign.performanceReport.totals
                      ? formatNumber(campaign.performanceReport.totals.impressions)
                      : "—"
                  }
                  hint={`${campaign.performanceReport.results.filter((r) => r.figures).length}/${campaign.performanceReport.results.length} channel(s) reported`}
                />
                <Stat
                  label="Blended CTR"
                  value={
                    campaign.performanceReport.totals
                      ? `${campaign.performanceReport.totals.ctr}%`
                      : "—"
                  }
                />
                <Stat
                  label="Conversions"
                  value={
                    campaign.performanceReport.totals
                      ? formatNumber(campaign.performanceReport.totals.conversions)
                      : "—"
                  }
                />
                <Stat
                  label="Gaps recorded"
                  value={String(campaign.performanceReport.gaps.length)}
                  hint={campaign.performanceReport.gaps.length ? "marked, not estimated" : "complete"}
                />
              </div>

              <div className="hairline bg-surface p-5">
                <p className="text-[11px] uppercase tracking-wider text-mute">Summary</p>
                <p className="mt-2 text-sm leading-relaxed">{campaign.performanceReport.summary}</p>
              </div>

              <div>
                <h3 className="text-[11px] uppercase tracking-wider text-mute">
                  Collection status per channel
                </h3>
                <ul className="mt-2 flex flex-col gap-2">
                  {campaign.performanceReport.results.map((r) => (
                    <li key={r.channel} className="hairline bg-surface p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{channelLabel[r.channel]}</span>
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
                        <span className="text-xs text-mute">
                          {r.sourceName} · {r.periodFrom} → {r.periodTo}
                        </span>
                      </div>
                      {r.figures ? (
                        <p className="mt-1 text-xs tabular-nums text-ink-soft">
                          {formatNumber(r.figures.impressions)} impressions · {r.figures.ctr}% CTR ·{" "}
                          {formatNumber(r.figures.conversions)} conversions · {r.figures.engagement}%
                          engagement
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-mute">{r.note}</p>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="hairline bg-surface p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] uppercase tracking-wider text-mute">
                    Next-campaign recommendation
                  </p>
                  {campaign.recommendationDecision ? (
                    <span
                      className={cn(
                        "status-chip",
                        campaign.recommendationDecision.action === "discarded"
                          ? "risk-mid"
                          : "risk-low",
                      )}
                    >
                      {campaign.recommendationDecision.action}
                    </span>
                  ) : null}
                </div>

                {campaign.performanceReport.recommendationUnsupported ? (
                  <p className="mt-2 text-sm text-signal">
                    The collected evidence cannot support keep/drop/change advice, so none was
                    invented. The factual summary above stands on its own (UC-06 ext 8.a).
                  </p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-2 text-sm">
                    {campaign.performanceReport.recommendationPoints.map((point) => (
                      <li key={point.id}>
                        <span className="text-[10px] uppercase tracking-wider text-signal">
                          {point.verdict} · {point.area.replace(/_/g, " ")}
                        </span>
                        <p className="mt-0.5">{point.text}</p>
                      </li>
                    ))}
                  </ul>
                )}

                {campaign.recommendationDecision ? (
                  <div className="mt-4 border-t border-line pt-3 text-sm">
                    <p className="text-xs text-mute">
                      {campaign.recommendationDecision.at.slice(0, 16).replace("T", " ")} ·{" "}
                      {campaign.recommendationDecision.author}
                    </p>
                    <p className="mt-1">
                      {campaign.recommendationDecision.action === "discarded"
                        ? "Discarded — nothing will be attached to a later brief."
                        : (campaign.recommendationDecision.text ?? "")}
                    </p>
                  </div>
                ) : (
                  <div className="mt-4">
                    <textarea
                      value={recommendText}
                      onChange={(e) => setRecommendationDraft(e.target.value)}
                      rows={3}
                      className="w-full border border-line px-3 py-2 text-sm outline-none focus:border-ink"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void decideRecommendation(campaign.id, "accepted", recommendText)
                        }
                        className="rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void decideRecommendation(campaign.id, "edited", recommendText)
                        }
                        className="rounded-full border border-ink px-4 py-2 text-sm disabled:opacity-50"
                      >
                        Save edit
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void decideRecommendation(campaign.id, "discarded")}
                        className="rounded-full border border-signal px-4 py-2 text-sm text-signal disabled:opacity-50"
                      >
                        Discard
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-mute">
                      An accepted or edited note is attached to the next brief; a discarded one is
                      never attached (UC-06 step 12, ext 10.a).
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      ) : null}

      {tab === "runtime" ? (
        <section className="flex flex-col gap-6">
          <SectionTitle
            kicker="Agent bench"
            title="What the agents did, what they were allowed to do"
          />

          <div className="grid gap-3 sm:grid-cols-4">
            <Stat
              label="Run state"
              value={run ? run.status.replace(/_/g, " ") : "idle"}
              hint={run?.step ?? "not started"}
            />
            <Stat
              label="Automated spend"
              value={`$${(campaign.spend.inferenceUsd + campaign.spend.mediaUsd).toFixed(3)}`}
              hint={`cap $${campaign.spend.capUsd.toFixed(2)}`}
            />
            <Stat
              label="Blocked attempts"
              value={String(campaign.spend.blockedAttempts)}
              hint="refused by the policy guard"
            />
            <Stat
              label="Tool calls"
              value={String(campaign.toolCalls.length)}
              hint={`${new Set(campaign.toolCalls.map((t) => t.tool)).size} distinct tool(s)`}
            />
          </div>

          {run?.awaiting ? (
            <div className="hairline border-l-4 border-signal bg-surface p-4 text-sm">
              <p className="text-[11px] uppercase tracking-wider text-signal">
                Waiting on {run.awaiting.replace(/_/g, " ")}
              </p>
              <p className="mt-1">{run.awaitingDetail}</p>
            </div>
          ) : null}

          <div>
            <h3 className="text-[11px] uppercase tracking-wider text-mute">Run trace</h3>
            {campaign.runSteps.length === 0 ? (
              <p className="mt-2 text-sm text-mute">The bench has not run yet.</p>
            ) : (
              <ol className="mt-2 flex flex-col gap-2">
                {campaign.runSteps.map((step) => (
                  <li key={step.id} className="hairline flex flex-wrap items-baseline gap-x-3 bg-surface p-3 text-sm">
                    <span
                      className={cn(
                        "status-chip",
                        step.status === "blocked" || step.status === "error"
                          ? "risk-high"
                          : step.status === "warn"
                            ? "risk-mid"
                            : "risk-low",
                      )}
                    >
                      {step.status}
                    </span>
                    <span className="font-mono text-xs text-mute">{step.step}</span>
                    <span className="font-medium">{step.title}</span>
                    <span className="w-full text-ink-soft sm:w-auto sm:flex-1">{step.detail}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div>
            <h3 className="text-[11px] uppercase tracking-wider text-mute">
              Policy decisions — every allow and every refusal
            </h3>
            {campaign.policyDecisions.length === 0 ? (
              <p className="mt-2 text-sm text-mute">No guard evaluations recorded yet.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {[...campaign.policyDecisions].reverse().map((d) => (
                  <li key={d.id} className="hairline bg-surface p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "status-chip",
                          d.verdict === "block"
                            ? "risk-high"
                            : d.verdict === "allow_with_note"
                              ? "risk-mid"
                              : "risk-low",
                        )}
                      >
                        {d.verdict.replace(/_/g, " ")}
                      </span>
                      <span className="font-mono text-xs">{d.action}</span>
                      <span className="text-xs text-mute">by {d.actor}</span>
                      <span className="text-xs text-mute">{d.rule}</span>
                    </div>
                    <p className="mt-1">{d.reason}</p>
                    {d.remedy ? <p className="mt-1 text-xs text-signal">{d.remedy}</p> : null}
                    <p className="mt-1 text-xs text-mute">{d.clause}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-[11px] uppercase tracking-wider text-mute">
              Boundary check — make an agent try something it is not allowed to do
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              AHR-01 requires the system to block an agent that attempts to publish, overspend or
              send a catalogue cover live, and to write the blocked action to the log. Ask the guard
              directly and watch it refuse and record.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(
                [
                  ["PUBLISH_CONTENT", "Publish the campaign"],
                  ["SPEND_MEDIA", "Commit eight times the spend cap"],
                  ["EDIT_APPROVED_CLAIM", "Change a cleared claim"],
                  ["CHANGE_CAMPAIGN_SCOPE", "Add a channel to the brief"],
                  ["SKIP_ITEM_SILENTLY", "Drop a channel silently"],
                ] as const
              ).map(([action, label]) => (
                <button
                  key={action}
                  type="button"
                  onClick={() =>
                    void attemptBlocked(campaign.id, action, label).then(setBoundaryResult)
                  }
                  className="rounded-full border border-line px-3 py-1.5 text-xs hover:border-signal hover:text-signal"
                >
                  {label}
                </button>
              ))}
            </div>
            {boundaryResult ? (
              <p className="mt-3 border-l-2 border-signal pl-3 text-sm text-ink-soft">
                {boundaryResult}
              </p>
            ) : null}
          </div>

          <div>
            <h3 className="text-[11px] uppercase tracking-wider text-mute">Tool calls</h3>
            {campaign.toolCalls.length === 0 ? (
              <p className="mt-2 text-sm text-mute">No tools have been called yet.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2 text-sm">
                {[...campaign.toolCalls].reverse().map((t) => (
                  <li key={t.id} className="hairline bg-surface p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "status-chip",
                          t.status === "ok" ? "risk-low" : t.status === "empty" ? "risk-mid" : "risk-high",
                        )}
                      >
                        {t.status}
                      </span>
                      <span className="font-mono text-xs">{t.tool}</span>
                      <span className="text-xs text-mute">
                        {t.agent} · {t.latencyMs}ms
                        {t.evidenceIds.length > 0 ? ` · ${t.evidenceIds.length} evidence row(s)` : ""}
                      </span>
                    </div>
                    <p className="mt-1 text-ink-soft">{t.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
