"use client";

import { ComplianceReviewHistory } from "./ComplianceReviewHistory";
import { excerptExplainer } from "./advertisementLabels";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { channelLabel } from "@/lib/status";
import { formatDate } from "@/lib/ids";
import type { Campaign, ComplianceReport, Creative } from "@/lib/types";

/**
 * Layout, single column, top to bottom:
 *   0. Version-bound compliance reports (ComplianceReviewHistory). With no legacy report and no founder decision, only this renders.
 *   1. Triage strip: what needs attention, in one line.
 *   2. The ad under review with the agent's findings pinned to it, then findings that quote no ad wording.
 *   3. Legacy review history, collapsed.
 *   4. The founder's note, once a decision with a note exists.
 *   5. A decision bar while the founder still has to decide: sticky, except when `inline` (the Approvals list), where it scrolls with the card.
 */

type Flag = {
  id: string;
  tone: "breach" | "judge";
  title: string;
  excerpt?: string;
  explanation: string;
  source: string;
  fix?: string;
};

const founderCopy = {
  approve: { label: "Approved", chip: "risk-low" },
  changes: { label: "Changes requested", chip: "risk-mid" },
  reject: { label: "Rejected", chip: "risk-high" },
} as const;

const redWash = "bg-[color-mix(in_srgb,var(--danger)_8%,var(--surface))]";

function AgentTag() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-soft">
      <span
        aria-hidden
        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-paper-2 text-[10px] font-semibold"
      >
        AI
      </span>
      Compliance agent
    </span>
  );
}

function Marked({ text, flags }: { text: string; flags: string[] }) {
  const lower = text.toLowerCase();
  const hit = flags.find((f) => f.length > 2 && lower.includes(f.toLowerCase()));
  if (!hit) return <>{text}</>;
  const i = lower.indexOf(hit.toLowerCase());
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-[color-mix(in_srgb,var(--danger)_18%,transparent)] px-0.5 text-ink underline decoration-[var(--danger)] decoration-wavy underline-offset-4">
        {text.slice(i, i + hit.length)}
      </mark>
      {text.slice(i + hit.length)}
    </>
  );
}

function VariantCard({ creative, findings }: { creative: Creative; findings: Flag[] }) {
  const flags = findings.flatMap((f) => (f.excerpt ? [f.excerpt] : []));
  const flagged = findings.length > 0;
  return (
    <li className={cn("border p-4", flagged ? "border-[var(--danger)]" : "border-line")}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wider text-mute">
          Ad · v{creative.version}
        </p>
        <span className={cn("status-chip", flagged ? "risk-high" : "risk-low")}>
          {flagged ? `${findings.length} to review` : "No issues"}
        </span>
      </div>
      <p className="mt-3 font-serif text-xl leading-snug">
        <Marked text={creative.headline} flags={flags} />
      </p>
      <p className="mt-2 text-sm text-ink-soft">
        <Marked text={creative.subhead} flags={flags} />
      </p>
      <p className="mt-3 text-xs text-mute">
        Button: <span className="font-medium text-ink">{creative.cta}</span>
      </p>
      {findings.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-3">
          {findings.map((f) => (
            <FindingCard key={f.id} f={f} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function FindingCard({ f }: { f: Flag }) {
  const red = f.tone === "breach";
  return (
    <li
      className={cn(
        "border-l-4 p-3",
        red
          ? cn("border-[var(--danger)]", redWash)
          : "border-amber-500 bg-[color-mix(in_srgb,#f59e0b_10%,var(--surface))]",
      )}
    >
      <p
        className={cn(
          "text-xs font-semibold uppercase tracking-wider",
          red ? "text-[var(--danger)]" : "text-amber-800",
        )}
      >
        {red ? "Problem" : "Agent unsure · your call"} · {f.title}
      </p>
      {f.excerpt ? (
        <p className="mt-2 font-serif text-base">
          <mark
            className={cn(
              "px-1",
              red ? "bg-[color-mix(in_srgb,var(--danger)_20%,transparent)]" : "bg-amber-200/70",
            )}
          >
            “{f.excerpt}”
          </mark>
        </p>
      ) : null}
      <p className="mt-2 text-sm">{f.explanation}</p>
      {f.fix ? (
        <p className="mt-2 text-sm">
          <span className="font-semibold">Fix: </span>
          {f.fix}
        </p>
      ) : null}
      <p className="mt-2 text-xs text-mute">{f.source}</p>
    </li>
  );
}

export function ChecksPanel({
  campaign,
  note,
  onNote,
  onApprove,
  onRequestChanges,
  onReject,
  inline = false,
}: {
  campaign: Campaign;
  note: string;
  onNote: (v: string) => void;
  onApprove: () => void;
  onRequestChanges: () => void;
  onReject: () => void;
  /** Inside a list (the Approvals queue): the decision bar scrolls with the card. */
  inline?: boolean;
}) {
  const [noteOpen, setNoteOpen] = useState(false);

  const rounds = useMemo(() => {
    const m = new Map<number, ComplianceReport[]>();
    for (const r of campaign.complianceReports) m.set(r.version, [...(m.get(r.version) ?? []), r]);
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [campaign.complianceReports]);

  const decision = campaign.founderDecision;
  const awaiting = campaign.status === "awaiting_approval";
  const attempt = campaign.complianceAttempts.at(-1) ?? null;
  const latest = rounds.at(-1);
  const earlier = rounds.slice(0, -1);

  // Only what the agent says about the version you are looking at.
  // The report and the attempt store the same issue id. Keep the attempt's
  // copy, which has the recommended fix, so the list does not render it twice.
  const flags: Flag[] = useMemo(() => {
    const byId = new Map<string, Flag>();
    const explainExcerpt = excerptExplainer(campaign.complianceReviewRuns?.at(-1)?.submission.content ?? []);
    for (const i of attempt?.issues ?? []) {
      byId.set(i.id, {
        id: i.id,
        tone: i.basis === "confirmed_breach" ? "breach" : "judge",
        title: i.category.replace(/_/g, " "),
        excerpt: i.excerpt !== "—" ? explainExcerpt(i.excerpt) : undefined,
        explanation: i.explanation,
        source: `${i.rule} · ${i.policySource}`,
        fix: i.recommendedCorrection,
      });
    }
    for (const r of latest?.[1] ?? []) {
      for (const f of r.findings) {
        if (byId.has(f.id)) continue;
        byId.set(f.id, {
          id: f.id,
          tone: "breach",
          title: f.type,
          excerpt: explainExcerpt(f.excerpt),
          explanation: f.explanation,
          source: f.rule,
        });
      }
    }
    return [...byId.values()];
  }, [latest, attempt, campaign.complianceReviewRuns]);

  const problems = flags.filter((f) => f.tone === "breach").length;
  const unsure = flags.length - problems;
  const cleared = !!latest && flags.length === 0 && latest[1].every((r) => r.verdict === "pass");
  // One ad for now: the first creative.
  const ad = campaign.creatives[0];
  const mentionsAd = (e?: string) =>
    !!ad && !!e && e.length > 2 && [ad.headline, ad.subhead, ad.cta].some((t) => t.toLowerCase().includes(e.toLowerCase()));
  const pinned = flags.filter((f) => mentionsAd(f.excerpt));
  // Findings that quote no wording from the ad, so they cannot be pinned to it.
  const general = flags.filter((f) => !mentionsAd(f.excerpt));
  const summary = latest?.[1][0]?.summary ?? attempt?.summary;
  const channelNames = campaign.channels.map((c) => channelLabel[c]).join(", ");

  if (!latest && !decision) {
    return (
      <ComplianceReviewHistory campaign={campaign} />
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <ComplianceReviewHistory campaign={campaign} />
      {/* 1. Triage */}
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 border p-4",
          problems > 0 ? cn("border-[var(--danger)]", redWash) : "border-line bg-surface",
        )}
      >
        <div>
          <h2 className="font-serif text-xl md:text-2xl">
            {decision
              ? `${founderCopy[decision.action].label} by you`
              : problems > 0
                ? `${problems} problem${problems === 1 ? "" : "s"} to look at`
                : unsure > 0
                  ? `${unsure} thing${unsure === 1 ? "" : "s"} the agent is unsure about`
                  : cleared
                    ? "Nothing flagged"
                    : "Review in progress"}
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            {decision
              ? formatDate(decision.at, true)
              : awaiting
                ? "Review the wording and the findings, then decide below."
                : "The agent advises. Only you can release it."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={cn("status-chip", problems > 0 ? "risk-high" : "risk-low")}>
            {problems} problem{problems === 1 ? "" : "s"}
          </span>
          <span className={cn("status-chip", unsure > 0 ? "risk-mid" : "status-soft")}>
            {unsure} unsure
          </span>
        </div>
      </div>

      {/* 2. The ad, with the agent's concerns attached to it */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[11px] uppercase tracking-wider text-mute">What you are approving</h3>
          <AgentTag />
        </div>
        {ad ? (
          <ul className="mt-3">
            <VariantCard creative={ad} findings={pinned} />
          </ul>
        ) : null}
        {general.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-3">
            {general.map((f) => (
              <FindingCard key={f.id} f={f} />
            ))}
          </ul>
        ) : null}
        {flags.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">
            <span className="status-chip risk-low mr-2">Cleared</span>
            {summary ?? "No issues found."}
          </p>
        ) : null}
        {attempt?.outcome === "manual_review" ? (
          <p className="mt-3 text-sm font-medium text-[var(--danger)]">
            The agent could not clear this on its own. The decision is yours.
          </p>
        ) : null}
      </div>

      {/* 3. History, out of the way */}
      {earlier.length > 0 || attempt ? (
        <details className="hairline">
          <summary className="flex cursor-pointer list-none items-center justify-between p-4 text-sm font-medium">
            Review history
            <span className="text-xs font-normal text-mute">
              {rounds.length} round{rounds.length === 1 ? "" : "s"}
            </span>
          </summary>
          <ol className="flex flex-col gap-4 border-t border-line p-4 text-sm">
            {rounds.map(([v, reports]) => {
              const ok = reports.every((r) => r.verdict === "pass");
              return (
                <li key={v}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">v{v}</span>
                    <AgentTag />
                    <span className={cn("status-chip", ok ? "risk-low" : "risk-mid")}>
                      {ok ? "Cleared" : "Sent back"}
                    </span>
                  </div>
                  <p className="mt-1 text-ink-soft">{reports[0].summary}</p>
                  {reports.flatMap((r) => r.findings).map((f, i) => (
                    <p key={`${v}-${f.id}-${i}`} className="mt-1 text-xs text-mute">
                      Flagged “{f.excerpt}” · {f.rule}
                    </p>
                  ))}
                </li>
              );
            })}
            {decision ? (
              <li>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">You</span>
                  <span className={cn("status-chip", founderCopy[decision.action].chip)}>
                    {founderCopy[decision.action].label}
                  </span>
                </div>
                {decision.note ? (
                  <p className="mt-1 italic text-ink-soft">“{decision.note}”</p>
                ) : null}
              </li>
            ) : null}
            {attempt ? (
              <li className="text-xs text-mute">
                Policies: {attempt.policyRefs.join(" · ")} · model {attempt.modelId}
              </li>
            ) : null}
          </ol>
        </details>
      ) : null}

      {/* 4. Founder's note */}
      {decision?.note ? (
        <div className="border border-line p-4 text-sm">
          <p className="text-[11px] uppercase tracking-wider text-mute">Your note</p>
          <p className="mt-1">“{decision.note}”</p>
        </div>
      ) : null}

      {/* 5. Decision bar */}
      {awaiting ? (
        <div
          className={cn(
            "border border-line bg-surface p-3 md:p-4",
            !inline && "sticky bottom-3 z-10 shadow-[0_8px_30px_rgb(15_15_26/0.15)]",
          )}
        >
          {noteOpen ? (
            <textarea
              value={note}
              onChange={(e) => onNote(e.target.value)}
              placeholder="Note for your agents (optional)"
              rows={2}
              autoFocus
              className="mb-3 w-full border border-line px-3 py-2 text-sm outline-none focus:border-signal"
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-[12rem] flex-1 text-sm text-ink-soft">
              <span className="font-medium text-ink">Your decision.</span>{" "}
              {problems > 0
                ? "The agent found problems. Approving overrides it."
                : "Nothing goes out until you approve."}
            </p>
            <button
              type="button"
              onClick={() => setNoteOpen((v) => !v)}
              className="text-sm text-signal hover:underline"
            >
              {noteOpen ? "Hide note" : note ? "Edit note" : "Add note"}
            </button>
            <button
              type="button"
              onClick={onReject}
              className="rounded-full border border-[var(--danger)] px-4 py-2 text-sm text-[var(--danger)]"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={onRequestChanges}
              className="rounded-full border border-line px-4 py-2 text-sm font-medium hover:bg-paper-2"
            >
              Request changes
            </button>
            <button
              type="button"
              onClick={onApprove}
              title={`Releases the wording to: ${channelNames}`}
              className="rounded-full btn-primary px-5 py-2 text-sm font-medium"
            >
              Approve
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
