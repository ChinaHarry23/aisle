"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { AgentLog } from "@/components/AgentLog";
import { OperationGraph } from "@/components/OperationGraph";
import { ChecksPanel } from "@/components/ChecksPanel";
import { ComplianceCheckerPanel } from "@/components/ComplianceCheckerPanel";
import { ChannelIcon } from "@/components/ChannelIcon";
import { InstagramPost } from "@/components/InstagramPost";
import { CampaignContent } from "@/components/studio/CampaignContent";
import {
  AgentPipeline,
  Confidence,
  Empty,
  ResultStatusChip,
  SectionTitle,
  Stat,
  StatusBadge,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDate, formatNumber } from "@/lib/ids";
import { channelLabel } from "@/lib/status";
import { isArchived } from "@/lib/campaign-lifecycle";
import { campaignCanAdvance } from "@/lib/runtime/resume";
import { useAisle } from "@/lib/store";

const tabs = [
  "brief",
  "research",
  "studio",
  "compliance",
  "approvals",
  "channels",
  "feedback",
  "runtime",
  "log",
] as const;

type Tab = (typeof tabs)[number];

/** Plain-language names; the ids stay stable so nothing else has to change. */
const tabLabels: Record<Tab, string> = {
  brief: "Overview",
  research: "Trends",
  studio: "Content Generation",
  compliance: "Compliance Checker",
  approvals: "Approvals",
  channels: "Schedule",
  feedback: "Performance",
  log: "Activity",
  runtime: "Technical",
};

/** Collapsed-by-default block for audit trails and other detail most people skip. */
function Details({
  title,
  children,
  open,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details open={open} className="hairline group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-medium">
        {title}
        <span className="text-xs font-normal text-mute group-open:hidden">Show</span>
        <span className="hidden text-xs font-normal text-mute group-open:inline">Hide</span>
      </summary>
      <div className="flex flex-col gap-6 border-t border-line p-4">{children}</div>
    </details>
  );
}

export default function CampaignWorkspace() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const campaign = useAisle((s) => s.campaigns.find((c) => c.id === id));
  const brand = useAisle((s) => s.brand);
  const launch = useAisle((s) => s.launch);
  const continueAgents = useAisle((s) => s.continueAgents);
  const engineError = useAisle((s) => s.engineError);
  const pause = useAisle((s) => s.pause);
  const approve = useAisle((s) => s.approve);
  const reject = useAisle((s) => s.reject);
  const requestChanges = useAisle((s) => s.requestChanges);
  const publish = useAisle((s) => s.publish);
  const collectFeedback = useAisle((s) => s.collectFeedback);
  const decideRecommendation = useAisle((s) => s.decideRecommendation);
  const resolveConflict = useAisle((s) => s.resolveConflict);
  const attemptBlocked = useAisle((s) => s.attemptBlocked);
  const archiveCampaign = useAisle((s) => s.archiveCampaign);
  const restoreCampaign = useAisle((s) => s.restoreCampaign);
  const deleteCampaign = useAisle((s) => s.deleteCampaign);
  const busy = useAisle((s) => s.busy[id] ?? false);
  const [pickedTab, setTab] = useState<Tab | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [note, setNote] = useState("");
  const [recommendationDraft, setRecommendationDraft] = useState<string | null>(null);
  const [boundaryResult, setBoundaryResult] = useState<string | null>(null);

  const evidenceById = useMemo(
    () => new Map((campaign?.evidence ?? []).map((e) => [e.id, e])),
    [campaign],
  );
  const run = campaign?.run ?? null;
  /** The creative that goes out on social: the approved one, else the first. */
  const postCreative =
    campaign?.creatives.find((c) => c.status === "approved") ?? campaign?.creatives[0] ?? null;
  const scheduleChannels = useMemo(
    () =>
      [...new Set([...(campaign?.adaptations ?? []).map((a) => a.channel), ...(campaign?.schedule ?? []).map((x) => x.channel)])],
    [campaign],
  );
  const recommendText =
    recommendationDraft ??
    campaign?.performanceReport?.recommendationText ??
    campaign?.performanceReport?.summary ??
    "";

  if (!campaign) {
    return (
      <Empty title="Campaign not found" body="It may have been deleted or cleared.">
        <Link href="/campaigns" className="text-sm text-signal">
          Back to board
        </Link>
      </Empty>
    );
  }

  // When the campaign is waiting on the founder, open on the legal check.
  const tab: Tab = pickedTab ?? (campaign.status === "awaiting_approval" ? "compliance" : "brief");
  const archived = isArchived(campaign);
  const canLaunch = !archived && ["draft", "paused", "rejected"].includes(campaign.status);
  const needsYou = campaign.status === "awaiting_approval";
  const canPublish = campaign.status === "scheduled";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href={archived ? "/campaigns/trash" : "/campaigns"} className="text-sm text-mute hover:text-signal">
          {archived ? "← Trash" : "← Board"}
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-[18rem] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-serif text-2xl tracking-tight md:text-3xl">{campaign.name}</h1>
              <StatusBadge status={campaign.status} />
            </div>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
              {campaign.product} · {campaign.targetAudience} ·{" "}
              {campaign.country}
            </p>
            {campaign.imageRevisionNote && campaign.complianceReports.length > 0 ? (
              <p className="mt-2 max-w-xl text-sm text-ink-soft">
                The pictures were revised after the compliance report. Check the new images before approving.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 md:pt-1">
            {canLaunch ? (
              <button
                type="button"
                onClick={() => void launch(campaign.id)}
                className="rounded-full btn-primary px-4 py-2 text-sm font-medium"
              >
                Launch agents
              </button>
            ) : null}
            {!archived && campaign.running ? (
              <button
                type="button"
                onClick={() => void pause(campaign.id)}
                className="rounded-full border border-line px-4 py-2 text-sm font-medium hover:bg-paper-2"
              >
                Pause
              </button>
            ) : null}
            {engineError && campaignCanAdvance(campaign) ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void continueAgents(campaign.id)}
                className="rounded-full btn-primary px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {busy ? "Working…" : "Continue agents"}
              </button>
            ) : null}
            {!archived && canPublish ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void publish(campaign.id)}
                className="rounded-full btn-primary px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {busy ? "Working…" : "Publish now"}
              </button>
            ) : null}
            {!archived && campaign.status === "published" && !campaign.performanceReport ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void collectFeedback(campaign.id)}
                className="rounded-full border border-line px-4 py-2 text-sm font-medium hover:bg-paper-2 disabled:opacity-50"
              >
                {busy ? "Collecting…" : "Collect results"}
              </button>
            ) : null}
            {archived ? (
              <>
                <button
                  type="button"
                  onClick={() => restoreCampaign(campaign.id)}
                  className="rounded-full btn-primary px-4 py-2 text-sm font-medium"
                >
                  Restore
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!confirmDelete) {
                      setConfirmDelete(true);
                      return;
                    }
                    deleteCampaign(campaign.id);
                  }}
                  className="rounded-full border border-signal px-4 py-2 text-sm font-medium text-signal hover:bg-paper-2"
                >
                  {confirmDelete ? "Delete forever" : "Delete"}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void archiveCampaign(campaign.id)}
                className="rounded-full border border-line px-4 py-2 text-sm font-medium hover:bg-paper-2"
              >
                Move to trash
              </button>
            )}
          </div>
        </div>
        {archived ? (
          <p className="mt-3 max-w-xl text-sm text-ink-soft">
            This campaign is in the trash. The agents will not keep working on it.
          </p>
        ) : null}
        <div className="mt-5">
          <AgentPipeline status={campaign.status} />
        </div>
        {engineError && campaignCanAdvance(campaign) ? (
          <p className="mt-3 text-sm text-signal">{engineError}</p>
        ) : null}
        {run?.status === "running" || campaign.spend.blockedAttempts > 0 ? (
          <p className="mt-3 text-xs text-mute">
            {run?.status === "running" ? "Agents are working on this now. " : ""}
            {campaign.spend.blockedAttempts > 0 ? (
              <button
                type="button"
                onClick={() => setTab("runtime")}
                className="text-signal hover:underline"
              >
                {campaign.spend.blockedAttempts} action(s) blocked by safety rules
              </button>
            ) : null}
          </p>
        ) : null}
        {campaign.validationProblems.length > 0 ? (
          <div className="mt-4 border border-signal/40 bg-surface p-4 text-sm">
            <p className="font-medium text-signal">This campaign can&apos;t launch yet</p>
            <ul className="mt-1.5 list-disc pl-5 text-ink-soft">
              {campaign.validationProblems.map((p) => (
                <li key={`${p.field}-${p.message}`}>{p.message}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="-mt-2 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "shrink-0 px-3 py-2 text-sm",
              t === "runtime" && "ml-auto text-xs",
              t === "approvals" && needsYou && "font-semibold text-signal",
              tab === t ? "border-b-2 border-signal text-ink" : "text-mute hover:text-ink",
            )}
          >
            {tabLabels[t]}
            {t === "approvals" && needsYou ? (
              <span className="status-chip status-wait ml-2">Needs your approval</span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "brief" ? (
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="hairline p-4">
            <SectionTitle kicker="Shared context" title="What every agent can see" />
            <dl className="mt-4 grid gap-3 text-sm">
              <Row k="Retailer" v={campaign.sharedContext.retailer} />
              <Row k="Product" v={campaign.sharedContext.product} />
              {campaign.productImageUrl ? (
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-mute">Product photo</dt>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={campaign.productImageUrl} alt="" className="mt-1 h-20 w-20 border border-line object-cover" />
                </div>
              ) : null}
              <Row k="Audience" v={campaign.sharedContext.audience} />
              <Row k="Objective" v={campaign.sharedContext.objective} />
              <Row
                k="Your cost"
                v={campaign.unitCostAud != null ? `$${campaign.unitCostAud.toFixed(2)}` : "Not entered"}
              />
              <Row
                k="Your price"
                v={campaign.currentPriceAud != null ? `$${campaign.currentPriceAud.toFixed(2)}` : "Not entered"}
              />
              <Row
                k="Recommended discount"
                v={
                  campaign.priceRecommendation
                    ? campaign.priceRecommendation.discountPct > 0
                      ? `${campaign.priceRecommendation.discountPct}% off, to $${campaign.priceRecommendation.recommendedPriceAud.toFixed(2)}`
                      : "No discount"
                    : "Waiting on Trend Analyser"
                }
              />
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
                k="Your notes"
                v={
                  campaign.sharedContext.founderNotes.length
                    ? campaign.sharedContext.founderNotes.join(" / ")
                    : "—"
                }
              />
            </dl>
          </div>
          <div className="hairline p-4">
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
          {campaign.priceRecommendation ? (
            <div className="hairline p-4">
              <SectionTitle
                kicker="Clearance price"
                title={
                  campaign.priceRecommendation.discountPct > 0
                    ? `${campaign.priceRecommendation.discountPct}% off`
                    : "Hold the current price"
                }
              />
              <p className="mt-3 text-sm leading-relaxed text-ink-soft">{campaign.priceRecommendation.rationale}</p>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-mute">Your cost</dt>
                  <dd>${campaign.priceRecommendation.unitCostAud.toFixed(2)}</dd>
                </div>
                <div>
                  <dt className="text-mute">Your price</dt>
                  <dd>${campaign.priceRecommendation.currentPriceAud.toFixed(2)}</dd>
                </div>
                <div>
                  <dt className="text-mute">Similar shelf</dt>
                  <dd>{campaign.priceRecommendation.marketLabel}</dd>
                </div>
                <div>
                  <dt className="text-mute">Recommended</dt>
                  <dd>${campaign.priceRecommendation.recommendedPriceAud.toFixed(2)}</dd>
                </div>
              </dl>
            </div>
          ) : null}
          <div>
            <SectionTitle kicker="Trends" title="What is worth promoting right now" />
            <ul className="mt-4 grid gap-3 md:grid-cols-2">
              {campaign.trends.map((t) => (
                <li key={t.id} className="hairline p-4">
                  <p className="text-[11px] uppercase tracking-wider text-mute">{t.source}</p>
                  <h3 className="mt-1 font-serif text-lg md:text-xl">{t.topic}</h3>
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

          <div className="order-last">
          <Details title="Sources, findings and limitations">
          {campaign.trendFindings.length > 0 ? (
            <div>
              <SectionTitle
                kicker="Findings"
                title="What is backed by a source, and what is an assumption"
              />
              <ul className="mt-4 grid gap-3">
                {campaign.trendFindings.map((f) => (
                  <li key={f.id} className="hairline p-4">
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
                    <h3 className="mt-2 font-serif text-lg md:text-xl">{f.topic}</h3>
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
                kicker="Limitations"
                title="What the research could not establish"
                aside={
                  campaign.trendGaps.some((g) => g.needsFounder) ? (
                    <span className="status-chip status-wait">needs your input</span>
                  ) : null
                }
              />
              <ul className="mt-4 flex flex-col gap-2">
                {campaign.trendGaps.map((g) => (
                  <li key={g.id} className="hairline p-3 text-sm">
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
                kicker="Sources"
                title={`${campaign.evidence.length} source${campaign.evidence.length === 1 ? "" : "s"} used`}
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
          </Details>
          </div>

          <div>
            <SectionTitle kicker="Opportunities" title="Best ideas for this campaign" />
            <ol className="mt-4 flex flex-col gap-3">
              {campaign.opportunities.map((o) => (
                <li key={o.id} className="hairline flex gap-4 p-4">
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
            <SectionTitle kicker="Audience" title="Who this is written for" />
            <ul className="mt-4 grid gap-3 md:grid-cols-2">
              {campaign.personas.map((p) => (
                <li key={p.id} className="hairline p-4">
                  <h3 className="font-serif text-lg md:text-xl">{p.name}</h3>
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

      {tab === "studio" ? <CampaignContent campaign={campaign} /> : null}

      {tab === "compliance" ? <ComplianceCheckerPanel campaign={campaign} /> : null}

      {tab === "approvals" ? (
        <ChecksPanel
          campaign={campaign}
          note={note}
          onNote={setNote}
          onApprove={() => void approve(campaign.id, note)}
          onRequestChanges={() => void requestChanges(campaign.id, note || "Please revise to founder notes.")}
          onReject={() => void reject(campaign.id, note || "Killed by founder.")}
        />
      ) : null}

      {tab === "channels" ? (
        <section className="flex flex-col gap-4">
          <SectionTitle kicker="Preview" title="How it will look and when it goes out" />
          {scheduleChannels.length === 0 ? (
            <p className="text-sm text-mute">
              The schedule appears once the campaign is approved. Posting times are chosen from
              audience behaviour and past results.
            </p>
          ) : (
            <ul className="grid gap-3">
              {scheduleChannels.map((ch) => {
                const a = campaign.adaptations.find((x) => x.channel === ch);
                const item = campaign.schedule.find((x) => x.channel === ch);
                const status = item?.status ?? "proposed";
                const chip = (
                  <span
                    className={cn(
                      "status-chip",
                      status === "published"
                        ? "risk-low"
                        : status === "failed"
                          ? "risk-high"
                          : status === "proposed"
                            ? "status-wait"
                            : "status-run",
                    )}
                  >
                    {status}
                  </span>
                );
                const when = item ? formatDate(item.at, true) : a?.postingTime;
                if (ch === "instagram" && postCreative) {
                  return (
                    <li key={ch} className="hairline grid gap-6 overflow-hidden md:grid-cols-[auto_1fr]">
                      <div className="flex justify-center bg-paper-2 px-6 py-8">
                        <InstagramPost brand={brand} creative={postCreative} campaignId={campaign.id} />
                      </div>
                      <div className="flex flex-col gap-4 p-5 md:py-8">
                        <div className="flex items-center gap-3">
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-signal/10 text-signal">
                            <ChannelIcon channel={ch} size={18} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <h3 className="font-medium">Instagram post</h3>
                            <p className="text-xs text-mute">Feed preview</p>
                          </div>
                          {chip}
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-wider text-mute">Goes out</p>
                          <p className="mt-0.5 font-serif text-xl">{when}</p>
                          {item?.note ? <p className="text-sm text-ink-soft">{item.note}</p> : null}
                        </div>
                        {a ? (
                          <div>
                            <p className="text-[11px] uppercase tracking-wider text-mute">Why then</p>
                            <p className="mt-0.5 text-sm text-ink-soft">{a.postingReason}</p>
                          </div>
                        ) : null}
                        {!item ? (
                          <p className="text-xs text-mute">
                            Nothing is scheduled until you approve the campaign.
                          </p>
                        ) : null}
                      </div>
                    </li>
                  );
                }
                return (
                  <li key={ch} className="hairline p-4">
                    <div className="flex items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-signal/10 text-signal">
                        <ChannelIcon channel={ch} size={18} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-medium">{channelLabel[ch]}</h3>
                        <p className="text-xs text-mute">{when}</p>
                      </div>
                      {chip}
                    </div>
                    {a ? (
                      <div className="mt-4 border-t border-line pt-3">
                        <p className="font-serif text-lg">{a.headline}</p>
                        <p className="mt-1 text-sm text-ink-soft">{a.body}</p>
                        <p className="mt-3 text-xs text-mute">Why this time: {a.postingReason}</p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {campaign.channelVersions.length > 0 ? (
            <Details title="Approved wording per channel">
              <ul className="flex flex-col gap-2">
                {campaign.channelVersions.map((v) => (
                  <li key={v.id} className="hairline p-3 text-sm">
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
                      {v.captionSource
                        ? ` · caption: ${v.captionSource === "model" ? "AI-generated" : "template"}`
                        : ""}
                    </p>
                    {v.embedHtml ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-mute">
                          Website embed — paste into your site
                        </summary>
                        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/5 p-2 text-[11px] leading-snug">
                          {v.embedHtml}
                        </pre>
                      </details>
                    ) : null}
                    {v.failure ? <p className="mt-1 text-xs text-signal">{v.failure}</p> : null}
                  </li>
                ))}
              </ul>
            </Details>
          ) : null}

          {campaign.scheduleConflicts.length > 0 ? (
            <div>
              <h3 className="text-[11px] uppercase tracking-wider text-mute">
                Scheduling conflicts to review
              </h3>
              <ul className="mt-2 flex flex-col gap-2">
                {campaign.scheduleConflicts.map((c) => (
                  <li key={c.id} className="hairline p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="status-chip risk-mid">{c.kind.replace(/_/g, " ")}</span>
                      <span className="font-medium">{channelLabel[c.channel]}</span>
                      <span className="text-xs text-mute">{formatDate(c.at, true)}</span>
                      {c.resolved ? (
                        <span className="status-chip risk-low">resolved</span>
                      ) : (
                        <span className="status-chip status-wait">needs your input</span>
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
                        className="mt-2 rounded-full border border-line font-medium hover:bg-paper-2 px-3 py-1 text-xs"
                      >
                        Accept and continue
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {campaign.performanceReport ? (
            <button
              type="button"
              onClick={() => setTab("feedback")}
              className="hairline p-4 text-left hover:border-signal"
            >
              <p className="text-xs font-medium text-signal">See the results →</p>
              <p className="mt-1 text-sm text-ink-soft">{campaign.performanceReport.summary}</p>
            </button>
          ) : null}
        </section>
      ) : null}

      {tab === "feedback" ? (
        <section className="flex flex-col gap-4">
          <SectionTitle
            kicker="Performance"
            title="How it performed"
            aside={
              campaign.status === "published" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void collectFeedback(campaign.id)}
                  className="rounded-full border border-line font-medium hover:bg-paper-2 px-3 py-1.5 text-sm disabled:opacity-50"
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
                  ? "The campaign is published. Collect results to build the summary."
                  : "Results appear once the campaign has been approved and published."
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

              <div className="hairline p-4">
                <p className="text-[11px] uppercase tracking-wider text-mute">Summary</p>
                <p className="mt-2 text-sm leading-relaxed">{campaign.performanceReport.summary}</p>
              </div>

              <Details title="Results by channel" open>
                <ul className="flex flex-col gap-2">
                  {campaign.performanceReport.results.map((r) => (
                    <li key={r.channel} className="hairline p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-2 font-medium">
                          <ChannelIcon channel={r.channel} className="text-signal" />
                          {channelLabel[r.channel]}
                        </span>
                        <ResultStatusChip status={r.status} />
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
              </Details>

              <div className="hairline p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] uppercase tracking-wider text-mute">
                    What to do next time
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
                    There isn&apos;t enough data to give reliable advice, so none was made up. The
                    summary above stands on its own.
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
                      className="w-full border border-line px-3 py-2 text-sm outline-none focus:border-signal"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void decideRecommendation(campaign.id, "accepted", recommendText)
                        }
                        className="rounded-full btn-primary px-4 py-2 text-sm font-medium disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void decideRecommendation(campaign.id, "edited", recommendText)
                        }
                        className="rounded-full border border-line px-4 py-2 text-sm font-medium hover:bg-paper-2 disabled:opacity-50"
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
                      An accepted or edited note is added to your next campaign. A discarded one
                      never is.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      ) : null}

      {tab === "runtime" ? (
        <section className="flex flex-col gap-4">
          <SectionTitle
            kicker="Technical"
            title="Run history, safety rules and tool calls"
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

          <OperationGraph step={run?.step} campaignId={campaign.id} />

          {run?.awaiting ? (
            <div className="hairline border-l-4 border-signal p-4 text-sm">
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
                  <li key={step.id} className="hairline flex flex-wrap items-baseline gap-x-3 p-3 text-sm">
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
                  <li key={d.id} className="hairline p-3 text-sm">
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
              Agents are never allowed to publish, overspend or change cleared wording on their own.
              Try one of these to see the safety rules refuse it and record the attempt.
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
                  <li key={t.id} className="hairline p-3">
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
          <SectionTitle kicker="Activity" title="What the agents and you have done" />
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
