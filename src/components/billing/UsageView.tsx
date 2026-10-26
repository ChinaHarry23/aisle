"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui";
import type { LedgerEntry } from "@/lib/billing/ledger";
import type { BillingSummary } from "@/lib/billing/summary";
import { CREDIT_PACK, formatCredits, milliForCost } from "@/lib/billing/plan";
import { formatDate, formatUsd } from "@/lib/ids";
import { BuyCreditsButton } from "./BuyCreditsButton";
import { BILLING_CHANGED } from "./events";

const REASON: Record<string, string> = {
  free_grant: "Starting credits",
  monthly_reset: "Monthly credits",
  usage: "Cloud usage",
  dev_usage: "Cloud usage",
  adjust: "Adjustment",
  expired: "Credits expired",
  topup: "Credits bought",
  reversal: "Credits returned",
};

/** Dev rows written before the credit amount was stored still have a provider cost. */
function spentMilli(entry: LedgerEntry): number {
  if (entry.deltaMilli !== 0) return entry.deltaMilli;
  if (entry.reason === "dev_usage" && entry.costUsd != null) return -milliForCost(entry.costUsd);
  return 0;
}

export function UsageView({ checkout }: { checkout: "success" | "cancel" | null }) {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(checkout === "success");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const load = async () => {
      try {
        const res = await fetch("/api/billing", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as (BillingSummary & { error?: string }) | null;
        if (!res.ok || !json) throw new Error(json?.error ?? "Usage is unavailable.");
        if (cancelled) return;
        setSummary(json);
        setError(null);
        window.dispatchEvent(new Event(BILLING_CHANGED));
        tries += 1;
        const arrived = json.ledger?.some((entry) => entry.reason === "topup") ?? false;
        if (checkout === "success" && !arrived && tries < 8) {
          timer = setTimeout(() => void load(), 2500);
        } else {
          setWaiting(false);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Usage is unavailable.");
        setWaiting(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [checkout]);

  const bought = summary?.ledger.some((entry) => entry.reason === "topup") ?? false;

  return (
    <div className="flex flex-col gap-8 text-ink">
      <PageHeader
        eyebrow="Account"
        title="Usage"
        description={
          summary?.unlimited
            ? "This desk is not charged. Every cloud call is still written here in credits, so you can see what it would have cost."
            : "Cloud agents, posters and videos spend the credits on this account. A local model does not."
        }
      />

      {error ? <p className="text-sm text-ink">{error}</p> : null}
      {checkout === "success" && (
        <p className="text-sm text-ink" role="status">
          {bought
            ? `${CREDIT_PACK.credits.toLocaleString("en-US")} credits were added to this account.`
            : waiting
              ? "Thanks — payment received by Stripe. The credits appear here as soon as Stripe confirms it."
              : "Thanks — the credits appear here as soon as Stripe confirms the payment. Refresh to check."}
        </p>
      )}
      {checkout === "cancel" && (
        <p className="text-sm text-ink" role="status">
          Checkout was cancelled. Nothing was charged.
        </p>
      )}

      <section className="hairline bg-surface p-5 text-ink">
        {!summary ? (
          <p className="font-serif text-3xl text-mute">…</p>
        ) : summary.unlimited ? (
          <>
            <p className="text-[11px] uppercase tracking-wider text-mute">Allowance</p>
            <p className="mt-2 font-serif text-3xl">Unlimited</p>
            <p className="mt-1 text-sm text-ink">{formatCredits(summary.spentMilli)} credits logged. Nothing is deducted.</p>
          </>
        ) : (
          <>
            <CreditMeter spentMilli={summary.spentMilli} leftMilli={Math.max(0, summary.balanceMilli)} allowanceMilli={summary.allowanceMilli} />
            <p className="mt-4 text-sm text-ink">
              New accounts start with {summary.plan.freeCredits.toLocaleString("en-US")} trial credits. Buy{" "}
              {CREDIT_PACK.credits.toLocaleString("en-US")} more for ${CREDIT_PACK.priceUsd}.
            </p>
            <div className="mt-3">
              <BuyCreditsButton ready={summary.topupReady} />
            </div>
          </>
        )}
      </section>

      <section>
        <h2 className="font-serif text-xl">Recent calls</h2>
        <UsageTable entries={summary?.ledger ?? []} loading={!summary && !error} unlimited={summary?.unlimited ?? false} />
      </section>
    </div>
  );
}

function CreditMeter({
  spentMilli: spent,
  leftMilli: left,
  allowanceMilli,
}: {
  spentMilli: number;
  leftMilli: number;
  allowanceMilli: number;
}) {
  const allowance = Math.max(allowanceMilli, left + spent, 1);
  const remaining = Math.round((left / allowance) * 100);
  return (
    <div>
      <div className="flex justify-between text-sm tabular-nums text-ink">
        <span>{formatCredits(spent)} used</span>
        <span>{formatCredits(left)} left</span>
      </div>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-paper-2"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={allowance}
        aria-valuenow={left}
        aria-label={`${formatCredits(spent)} credits used, ${formatCredits(left)} left`}
      >
        <div className={`h-full ${remaining < 20 ? "bg-signal" : "bg-ink"}`} style={{ width: `${remaining}%` }} />
      </div>
    </div>
  );
}

function UsageTable({
  entries,
  loading,
  unlimited,
}: {
  entries: LedgerEntry[];
  loading: boolean;
  unlimited: boolean;
}) {
  if (loading) return <p className="mt-3 text-sm text-ink">Loading…</p>;
  if (!entries.length) return <p className="mt-3 text-sm text-ink">Nothing yet. Cloud calls show up here as they run.</p>;
  return (
    <div className="hairline mt-3 overflow-x-auto bg-surface">
      <table className="w-full min-w-[40rem] text-left text-sm text-ink">
        <thead>
          <tr className="border-b border-line text-[11px] uppercase tracking-wider text-mute">
            <th className="px-4 py-3 font-medium">When</th>
            <th className="px-4 py-3 font-medium">What</th>
            <th className="px-4 py-3 text-right font-medium">Credits</th>
            <th className="px-4 py-3 text-right font-medium">{unlimited ? "Charged" : "Balance"}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const milli = spentMilli(entry);
            const spend = entry.reason === "usage" || entry.reason === "dev_usage";
            return (
              <tr key={entry.id} className="border-b border-line last:border-0">
                <td className="whitespace-nowrap px-4 py-3">{formatDate(entry.createdAt, true)}</td>
                <td className="px-4 py-3">
                  <p>{REASON[entry.reason] ?? entry.reason}</p>
                  <p className="text-xs text-ink">
                    {[entry.note, entry.modelId, entry.costUsd != null ? formatUsd(entry.costUsd) : null].filter(Boolean).join(" · ")}
                  </p>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {milli === 0 ? "0" : `${milli > 0 ? "+" : "−"}${formatCredits(Math.abs(milli))}`}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {spend && unlimited ? "Not charged" : entry.balanceAfterMilli == null ? "—" : formatCredits(entry.balanceAfterMilli)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
