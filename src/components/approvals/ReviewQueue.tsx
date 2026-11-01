"use client";

import Link from "next/link";
import { useState } from "react";
import { ChecksPanel } from "@/components/ChecksPanel";
import { ResearchDecisions } from "@/components/trend/ResearchDecisions";
import { Empty, RiskBadge } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  approvalsHref,
  reviewQueue,
  reviewTypes,
  type ReviewEntry,
  type ReviewType,
} from "@/lib/approvals/queue";
import { pausedCampaignCanResume } from "@/lib/runtime/resume";
import { channelLabel } from "@/lib/status";
import { useAisle } from "@/lib/store";
import type { Campaign } from "@/lib/types";

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function CampaignLink({ campaign, tab }: { campaign: Campaign; tab: string }) {
  return (
    <Link href={`/campaigns/${campaign.id}?tab=${tab}`} className="font-serif text-xl hover:text-signal">
      {campaign.name}
    </Link>
  );
}

function ComplianceCard({
  campaign,
  inline,
  note,
  onNote,
  showCampaignLink,
}: {
  campaign: Campaign;
  inline: boolean;
  note: string;
  onNote: (value: string) => void;
  showCampaignLink: boolean;
}) {
  const approve = useAisle((s) => s.approve);
  const reject = useAisle((s) => s.reject);
  const requestChanges = useAisle((s) => s.requestChanges);
  const busy = useAisle((s) => s.busy[campaign.id]);
  const report = campaign.complianceReports.at(-1);
  const manual = campaign.complianceAttempts.at(-1)?.outcome === "manual_review";

  return (
    <li className="hairline flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CampaignLink campaign={campaign} tab="compliance" />
          <p className="mt-0.5 text-sm text-ink-soft">{campaign.product}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {manual ? <span className="status-chip risk-high">manual review required</span> : null}
          {report ? <RiskBadge risk={report.risk} /> : null}
        </div>
      </div>
      <ChecksPanel
        campaign={campaign}
        busy={busy}
        inline={inline}
        note={note}
        onNote={onNote}
        onApprove={() => void approve(campaign.id, note)}
        onRequestChanges={() => void requestChanges(campaign.id, note || "Please revise using my notes.")}
        onReject={() => void reject(campaign.id, note || "Rejected.")}
      />
      {showCampaignLink ? (
        <Link href={`/campaigns/${campaign.id}?tab=approvals`} className="self-start text-sm text-mute hover:text-ink">
          Open campaign
        </Link>
      ) : null}
    </li>
  );
}

function SettledCompliance({ campaign }: { campaign: Campaign }) {
  const approve = useAisle((s) => s.approve);
  const reject = useAisle((s) => s.reject);
  const requestChanges = useAisle((s) => s.requestChanges);
  const busy = useAisle((s) => s.busy[campaign.id]);
  const [note, setNote] = useState("");
  return (
    <ChecksPanel
      campaign={campaign}
      busy={busy}
      note={note}
      onNote={setNote}
      onApprove={() => void approve(campaign.id, note)}
      onRequestChanges={() => void requestChanges(campaign.id, note || "Please revise using my notes.")}
      onReject={() => void reject(campaign.id, note || "Rejected.")}
    />
  );
}

function TrendCard({ entry }: { entry: Extract<ReviewEntry, { type: "trends" }> }) {
  const launch = useAisle((s) => s.launch);
  const busy = useAisle((s) => s.busy[entry.campaign.id]);
  const { campaign, notice, pending, pausedDetail } = entry;
  const canResume = pending === 0 && pausedDetail && pausedCampaignCanResume(campaign);

  return (
    <li className="hairline flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CampaignLink campaign={campaign} tab="research" />
          <p className="mt-0.5 text-sm text-ink-soft">{campaign.product}</p>
        </div>
        <span className="status-chip status-wait">{pending > 0 ? "decision needed" : "needs a look"}</span>
      </div>
      {pausedDetail && pending === 0 ? <p className="text-base text-ink-soft">{pausedDetail}</p> : null}
      {notice ? (
        <div>
          <h4 className="font-medium">
            {notice.failed.length} {notice.failed.length === 1 ? "area needs" : "areas need"} another look
            {notice.succeeded.length > 0 ? ` · ${notice.succeeded.length} in order` : ""}
          </h4>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-soft">
            {notice.failed.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {notice.succeeded.length > 0 ? (
            <p className="mt-3 text-sm text-mute">In order: {notice.succeeded.join(", ")}.</p>
          ) : null}
        </div>
      ) : null}
      {pending > 0 ? <ResearchDecisions campaign={campaign} /> : null}
      <div className="flex flex-wrap items-center gap-3">
        {canResume ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void launch(campaign.id)}
            className="rounded-full btn-primary px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            Run research again
          </button>
        ) : null}
        <Link href={`/campaigns/${campaign.id}?tab=research`} className="text-sm text-signal">
          Open research
        </Link>
      </div>
    </li>
  );
}

function ChannelCard({
  entry,
  note,
  onNote,
}: {
  entry: Extract<ReviewEntry, { type: "channels" }>;
  note: string;
  onNote: (value: string) => void;
}) {
  const resolveConflict = useAisle((s) => s.resolveConflict);
  const busy = useAisle((s) => s.busy[entry.campaign.id]);
  const { campaign, conflict } = entry;

  return (
    <li className="hairline flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="status-chip risk-mid">{entry.title}</span>
        <Link href={`/campaigns/${campaign.id}?tab=channels`} className="font-medium hover:text-signal">
          {campaign.name}
        </Link>
        {conflict ? <span className="text-sm text-mute">{channelLabel[conflict.channel]}</span> : null}
      </div>
      <p className="text-base text-ink-soft">{entry.detail}</p>
      {conflict ? (
        <>
          <input
            value={note}
            onChange={(event) => onNote(event.target.value)}
            placeholder="Note (optional)"
            className="w-full border border-line px-3 py-2.5 text-base outline-none focus:border-signal"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void resolveConflict(campaign.id, conflict.id, note || "Accepted by the founder.")}
              className="rounded-full btn-primary px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              Accept this slot
            </button>
            <Link href={`/campaigns/${campaign.id}?tab=channels`} className="px-3 py-2 text-sm text-mute hover:text-ink">
              Open the schedule
            </Link>
          </div>
        </>
      ) : (
        <Link href={`/campaigns/${campaign.id}?tab=channels`} className="self-start text-sm text-signal">
          Open the schedule
        </Link>
      )}
    </li>
  );
}

function OtherCard({ entry }: { entry: Extract<ReviewEntry, { type: "other" }> }) {
  const collectFeedback = useAisle((s) => s.collectFeedback);
  const decideRecommendation = useAisle((s) => s.decideRecommendation);
  const busy = useAisle((s) => s.busy[entry.campaign.id]);
  const report = entry.campaign.performanceReport;
  const [text, setText] = useState(report?.recommendationText ?? report?.summary ?? "");
  const tab = entry.kind === "brief" ? "brief" : "feedback";

  return (
    <li className="hairline flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="status-chip status-wait">{entry.title}</span>
        <Link href={`/campaigns/${entry.campaign.id}?tab=${tab}`} className="font-medium hover:text-signal">
          {entry.campaign.name}
        </Link>
      </div>
      <p className="text-base text-ink-soft">{entry.detail}</p>
      {entry.kind === "brief" && entry.campaign.validationProblems.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          {entry.campaign.validationProblems.map((problem) => (
            <li key={`${problem.field}-${problem.message}`}>{problem.message}</li>
          ))}
        </ul>
      ) : null}
      {entry.kind === "collect" ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void collectFeedback(entry.campaign.id)}
          className="self-start rounded-full btn-primary px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? "Collecting…" : "Collect results"}
        </button>
      ) : null}
      {entry.kind === "recommendation" && report?.recommendationUnsupported ? (
        <div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void decideRecommendation(entry.campaign.id, "discarded")}
            className="rounded-full border border-signal px-4 py-2 text-sm text-signal disabled:opacity-50"
          >
            Discard
          </button>
          <p className="mt-2 text-xs text-mute">
            There is not enough data to give reliable advice, so none was made up.
          </p>
        </div>
      ) : null}
      {entry.kind === "recommendation" && report && !report.recommendationUnsupported ? (
        <div>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            className="w-full border border-line px-3 py-2 text-sm outline-none focus:border-signal"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void decideRecommendation(entry.campaign.id, "accepted", text)}
              className="rounded-full btn-primary px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              Accept
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decideRecommendation(entry.campaign.id, "edited", text)}
              className="rounded-full border border-line px-4 py-2 text-sm font-medium hover:bg-paper-2 disabled:opacity-50"
            >
              Save edit
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decideRecommendation(entry.campaign.id, "discarded")}
              className="rounded-full border border-signal px-4 py-2 text-sm text-signal disabled:opacity-50"
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}
      <Link href={`/campaigns/${entry.campaign.id}?tab=${tab}`} className="self-start text-sm text-mute hover:text-ink">
        Open campaign
      </Link>
    </li>
  );
}

export function ReviewQueue({
  campaigns,
  type = "all",
  onType,
  includeSettledCompliance = false,
}: {
  campaigns: Campaign[];
  type?: ReviewType | "all";
  onType?: (next: ReviewType | "all") => void;
  /** Keep the compliance record on a campaign's Approvals tab after the decision is made. */
  includeSettledCompliance?: boolean;
}) {
  const [localType, setLocalType] = useState<ReviewType | "all">("all");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const selected = onType ? type : localType;
  const choose = onType ?? setLocalType;
  const entries = reviewQueue(campaigns);
  const visible = selected === "all" ? entries : entries.filter((entry) => entry.type === selected);
  const selectedType = reviewTypes.find((item) => item.id === selected);
  const lone = campaigns.length === 1 ? campaigns[0] : null;
  const complianceWaiting = entries.some((entry) => entry.type === "compliance");
  const hasComplianceRecord = Boolean(
    lone &&
      (lone.complianceReports.length > 0 ||
        lone.complianceAttempts.length > 0 ||
        (lone.complianceReviewRuns?.length ?? 0) > 0 ||
        lone.founderDecision),
  );
  const showRecord =
    includeSettledCompliance &&
    hasComplianceRecord &&
    !complianceWaiting &&
    (selected === "all" || selected === "compliance");

  const noteFor = (id: string) => notes[id] ?? "";
  const setNote = (id: string, value: string) => setNotes((current) => ({ ...current, [id]: value }));

  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label="Decision types" className="flex flex-wrap gap-2">
        <TypeChip
          label="All"
          count={entries.length}
          pressed={selected === "all"}
          onClick={() => choose("all")}
        />
        {reviewTypes.map((item) => (
          <TypeChip
            key={item.id}
            label={item.label}
            count={entries.filter((entry) => entry.type === item.id).length}
            pressed={selected === item.id}
            onClick={() => choose(item.id)}
          />
        ))}
      </div>

      {visible.length === 0 && !showRecord ? (
        <Empty
          title={selected === "all" ? "Nothing needs your review" : `No ${selectedType ? `${selectedType.noun}s` : "decisions"}`}
          body={
            selected === "all"
              ? "If the agents cannot settle compliance, research, a distribution channel, or any other decision, it appears here."
              : "Nothing of this type is waiting. The other types stay in this list."
          }
        />
      ) : null}

      {reviewTypes.map((item) => {
        if (selected !== "all" && selected !== item.id) return null;
        const group = visible.filter((entry) => entry.type === item.id);
        const record = item.id === "compliance" && showRecord && lone;
        if (group.length === 0 && !record) return null;
        const highRisk = group.filter(
          (entry) => entry.type === "compliance" && entry.campaign.complianceReports.at(-1)?.risk === "high",
        ).length;
        return (
          <section key={item.id} className="flex flex-col gap-3" aria-label={item.label}>
            {selected === "all" ? (
              <h3 className="text-sm font-medium text-ink-soft">
                {item.label}
                {group.length > 0 ? ` (${group.length})` : ""}
                {highRisk > 0 ? ` · ${highRisk} high risk` : ""}
              </h3>
            ) : null}
            {group.length > 0 ? (
              <ul className="flex flex-col gap-4">
                {group.map((entry) => {
                  if (entry.type === "compliance") {
                    return (
                      <ComplianceCard
                        key={entry.id}
                        campaign={entry.campaign}
                        inline={!includeSettledCompliance}
                        showCampaignLink={!includeSettledCompliance}
                        note={noteFor(entry.campaign.id)}
                        onNote={(value) => setNote(entry.campaign.id, value)}
                      />
                    );
                  }
                  if (entry.type === "trends") return <TrendCard key={entry.id} entry={entry} />;
                  if (entry.type === "channels") {
                    return (
                      <ChannelCard
                        key={entry.id}
                        entry={entry}
                        note={noteFor(entry.id)}
                        onNote={(value) => setNote(entry.id, value)}
                      />
                    );
                  }
                  return <OtherCard key={entry.id} entry={entry} />;
                })}
              </ul>
            ) : null}
            {record && lone ? <SettledCompliance campaign={lone} /> : null}
          </section>
        );
      })}
    </div>
  );
}

function TypeChip({
  label,
  count,
  pressed,
  onClick,
}: {
  label: string;
  count: number;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={pressed}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm",
        pressed ? "border-signal bg-signal text-white" : "border-line bg-surface text-ink-soft hover:text-ink",
      )}
    >
      {label}
      <span className={cn("ml-1.5 tabular-nums", pressed ? "text-white/80" : "text-mute")}>{count}</span>
    </button>
  );
}

export function reviewSummary(campaigns: Campaign[]) {
  const entries = reviewQueue(campaigns);
  return reviewTypes
    .map((type) => ({ ...type, count: entries.filter((entry) => entry.type === type.id).length, href: approvalsHref(type.id) }))
    .filter((type) => type.count > 0);
}

export { plural };
