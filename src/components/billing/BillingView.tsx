"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { formatCredits, LIVE_STATUSES, MILLI, PLAN } from "@/lib/billing/plan";
import type { LedgerEntry } from "@/lib/billing/ledger";
import type { BillingSummary } from "@/lib/billing/summary";
import { formatDate, formatUsd } from "@/lib/ids";
import { cn } from "@/lib/cn";
import { creditExamples } from "./examples";
import { BILLING_CHANGED } from "./events";

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "mute" }> = {
  active: { label: "Active", tone: "ok" },
  trialing: { label: "Trial", tone: "ok" },
  past_due: { label: "Payment failed — update your card", tone: "warn" },
  unpaid: { label: "Unpaid — update your card", tone: "warn" },
  incomplete: { label: "Waiting for payment", tone: "warn" },
  incomplete_expired: { label: "Checkout expired", tone: "mute" },
  paused: { label: "Paused", tone: "mute" },
  canceled: { label: "Cancelled", tone: "mute" },
};

const REASON: Record<string, string> = {
  free_grant: "Free credits",
  monthly_reset: "Monthly credits",
  usage: "Cloud usage",
  dev_usage: "Cloud usage (team desk)",
  adjust: "Adjustment",
  expired: "Credits expired",
};

function signed(milli: number) {
  if (milli === 0) return "0";
  return `${milli > 0 ? "+" : "−"}${formatCredits(Math.abs(milli))}`;
}

async function fetchSummary(): Promise<BillingSummary> {
  const res = await fetch("/api/billing", { cache: "no-store" });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(json?.error ?? `Billing returned ${res.status}`);
  return json as BillingSummary;
}

/** How far before this page opened the webhook may have granted (it can beat the redirect, and clocks differ). */
const GRANT_WINDOW_MS = 30 * 60_000;

/**
 * Credits arrive from Stripe's webhook, which can trail the redirect by a few
 * seconds. Only a monthly grant from this checkout counts: newer than the last
 * expiry (a returning subscriber still has last time's grant in the ledger)
 * and not from long before the page opened.
 */
function creditsArrived(summary: BillingSummary, openedAt: number) {
  if (summary.subscription?.status !== "active") return false;
  const time = (e: LedgerEntry) => Date.parse(e.createdAt) || 0;
  const lastExpiry = Math.max(0, ...summary.ledger.filter((e) => e.reason === "expired").map(time));
  const since = Math.max(lastExpiry, openedAt - GRANT_WINDOW_MS);
  return summary.ledger.some((e) => e.reason === "monthly_reset" && time(e) > since);
}

export function BillingView({ checkout }: { checkout: "success" | "cancel" | null }) {
  const router = useRouter();
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(checkout === "success");
  const [openedAt] = useState(() => Date.now());
  const examples = useMemo(() => creditExamples(), []);

  const load = useCallback(async () => {
    try {
      const next = await fetchSummary();
      setSummary(next);
      setError(null);
      window.dispatchEvent(new Event(BILLING_CHANGED));
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Billing is unavailable.");
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const tick = async () => {
      const next = await load();
      if (cancelled) return;
      tries += 1;
      // After checkout, poll a few times for the webhook, then stop and say so.
      if (checkout === "success" && !(next && creditsArrived(next, openedAt)) && tries < 8) {
        timer = setTimeout(() => void tick(), 2500);
      } else {
        setWaiting(false);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [checkout, load, openedAt]);

  async function go(kind: "checkout" | "portal") {
    setBusy(kind);
    setActionError(null);
    try {
      const res = await fetch(`/api/billing/${kind}`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !json?.url) throw new Error(json?.error ?? `Request failed (${res.status}).`);
      window.location.assign(json.url);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(null);
    }
  }

  const sub = summary?.subscription ?? null;
  const status = sub ? (STATUS[sub.status] ?? { label: sub.status, tone: "mute" as const }) : null;
  const live = sub && LIVE_STATUSES.includes(sub.status);
  const arrived = summary ? creditsArrived(summary, openedAt) : false;
  const plan = summary?.plan ?? PLAN;

  return (
    <div className="flex flex-col gap-10">
      <header className="max-w-2xl">
        <p className="text-[11px] uppercase tracking-[0.2em] text-signal">Account</p>
        <h1 className="font-serif text-4xl">Billing.</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          Cloud agents, posters and ad videos run on Aisle&apos;s own provider keys and are paid for in
          credits. You never paste an API key. Local models on this Mac (Qwen3.8 on MTPLX, ComfyUI) are
          always free.
        </p>
      </header>

      {checkout === "success" && (
        <Banner tone={arrived ? "ok" : "info"} onDismiss={() => router.replace("/billing")}>
          {arrived
            ? `You're subscribed. ${PLAN.monthlyCredits.toLocaleString("en-US")} credits are ready to use.`
            : waiting
              ? "Thanks — payment received by Stripe. Your credits appear here as soon as Stripe confirms the invoice…"
              : "Thanks — your credits appear here as soon as Stripe confirms the invoice. This can take a minute; refresh to check."}
        </Banner>
      )}
      {checkout === "cancel" && (
        <Banner tone="info" onDismiss={() => router.replace("/billing")}>
          Checkout was cancelled. Nothing was charged.
        </Banner>
      )}
      {error && <Banner tone="warn">{error}</Banner>}

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="hairline bg-surface p-5">
          <p className="text-[11px] uppercase tracking-[0.16em] text-signal">Plan</p>
          <p className="mt-1 font-serif text-3xl">
            ${PLAN.priceUsd}
            <span className="text-base text-mute"> / month</span>
          </p>
          <p className="text-xs text-mute">{PLAN.name}</p>
          <ul className="mt-4 space-y-1.5 text-sm text-ink-soft">
            <li>{PLAN.monthlyCredits.toLocaleString("en-US")} credits every month, reset on each payment (no rollover)</li>
            {plan.freeCredits > 0 && <li>{plan.freeCredits} free credits to start, once per person</li>}
            <li>
              1 credit = ${PLAN.usdPerCredit.toFixed(2)}, charged at {PLAN.markup}× what the provider bills
            </li>
            <li>Local models are free and never use credits</li>
          </ul>
        </article>

        <article className="hairline bg-surface p-5">
          <p className="text-[11px] uppercase tracking-[0.16em] text-signal">Balance</p>
          {!summary ? (
            <p className="mt-1 font-serif text-3xl text-mute">{error ? "—" : "…"}</p>
          ) : summary.unlimited ? (
            <>
              <p className="mt-1 font-serif text-3xl">Unlimited</p>
              <p className="text-xs text-mute">Team desk — nothing is deducted. Each cloud call is still logged in credits.</p>
            </>
          ) : (
            <>
              <p className={cn("mt-1 font-serif text-3xl tabular-nums", summary.balanceMilli <= 0 && "text-signal")}>
                {formatCredits(summary.balanceMilli)}
                <span className="text-base text-mute"> credits</span>
              </p>
              <p className="text-xs text-mute">
                {summary.balanceMilli <= 0
                  ? "Out of credits — cloud calls fall back to local models."
                  : "Spent as cloud agents, posters and videos run."}
              </p>
            </>
          )}

          {summary && !summary.unlimited && (
            <div className="mt-4 border-t border-line pt-4 text-sm">
              {status ? (
                <p>
                  Subscription:{" "}
                  <span
                    className={cn(
                      status.tone === "ok" && "text-ok",
                      status.tone === "warn" && "text-signal",
                      status.tone === "mute" && "text-mute",
                    )}
                  >
                    {status.label}
                  </span>
                </p>
              ) : (
                <p className="text-ink-soft">No subscription yet.</p>
              )}
              {sub?.currentPeriodEnd && live && (
                <p className="mt-1 text-xs text-mute">
                  {sub.cancelPending ? "Ends" : "Renews"} {formatDate(sub.currentPeriodEnd)}
                  {sub.cancelPending ? " — no further charges" : ` with ${PLAN.monthlyCredits.toLocaleString("en-US")} fresh credits`}
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {!live && (
                  <button
                    type="button"
                    // Just back from a paid checkout: wait for Stripe's confirmation instead of offering a second subscription.
                    disabled={!summary.stripeReady || busy !== null || waiting}
                    onClick={() => void go("checkout")}
                    className="rounded-full bg-ink px-4 py-2 text-sm text-paper hover:bg-ink-soft disabled:opacity-50"
                  >
                    {busy === "checkout"
                      ? "Opening Stripe…"
                      : waiting
                        ? "Confirming your payment…"
                        : `Subscribe — $${PLAN.priceUsd}/month`}
                  </button>
                )}
                {sub && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void go("portal")}
                    className="rounded-full border border-line px-4 py-2 text-sm text-ink hover:border-ink disabled:opacity-50"
                  >
                    {busy === "portal" ? "Opening Stripe…" : "Manage billing"}
                  </button>
                )}
              </div>
              {!summary.stripeReady && !live && (
                <p className="mt-2 text-xs text-mute">
                  Subscriptions are not switched on for this server yet. Local models still work.
                </p>
              )}
              {actionError && <p className="mt-2 text-xs text-signal">{actionError}</p>}
            </div>
          )}
        </article>
      </section>

      <section>
        <p className="text-[11px] uppercase tracking-wider text-mute">Prices</p>
        <h2 className="font-serif text-3xl">What credits buy.</h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-soft">
          Typical costs at current list prices. You are charged for what the provider actually bills,
          so a real call can land a little above or below.
        </p>
        <div className="hairline mt-4 overflow-x-auto bg-surface">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-mute">
                <th className="px-4 py-3 font-normal">Task</th>
                <th className="px-4 py-3 text-right font-normal">Credits</th>
                <th className="px-4 py-3 text-right font-normal">Per {PLAN.monthlyCredits.toLocaleString("en-US")}</th>
              </tr>
            </thead>
            <tbody>
              {examples.map((row) => (
                <tr key={row.label} className="border-t border-line">
                  <td className="px-4 py-3">
                    <p>{row.label}</p>
                    <p className="text-xs text-mute">{row.detail}</p>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCredits(Math.round(row.credits * MILLI))}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-soft">
                    {row.credits > 0 ? `≈ ${Math.floor(PLAN.monthlyCredits / row.credits).toLocaleString("en-US")}` : "—"}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-line">
                <td className="px-4 py-3">
                  <p>Anything on the Local backend</p>
                  <p className="text-xs text-mute">Qwen3.8 on MTPLX, ComfyUI posters and videos</p>
                </td>
                <td className="px-4 py-3 text-right text-ok">Free</td>
                <td className="px-4 py-3 text-right text-ink-soft">Unlimited</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <p className="text-[11px] uppercase tracking-wider text-mute">History</p>
        <h2 className="font-serif text-3xl">Usage.</h2>
        <UsageTable entries={summary?.ledger ?? []} loading={!summary && !error} />
      </section>
    </div>
  );
}

function UsageTable({ entries, loading }: { entries: LedgerEntry[]; loading: boolean }) {
  if (loading) return <p className="mt-3 text-sm text-mute">Loading…</p>;
  if (!entries.length) {
    return <p className="mt-3 text-sm text-mute">Nothing yet. Cloud calls show up here as they run.</p>;
  }
  return (
    <div className="hairline mt-4 overflow-x-auto bg-surface">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-mute">
            <th className="px-4 py-3 font-normal">When</th>
            <th className="px-4 py-3 font-normal">What</th>
            <th className="px-4 py-3 text-right font-normal">Credits</th>
            <th className="px-4 py-3 text-right font-normal">Balance</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-t border-line align-top">
              <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{formatDate(entry.createdAt, true)}</td>
              <td className="px-4 py-3">
                <p>{REASON[entry.reason] ?? entry.reason}</p>
                <p className="text-xs text-mute">
                  {[entry.note, entry.modelId, entry.costUsd != null ? `provider ${formatUsd(entry.costUsd)}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </td>
              <td
                className={cn(
                  "px-4 py-3 text-right tabular-nums",
                  entry.deltaMilli > 0 ? "text-ok" : entry.deltaMilli < 0 ? "text-ink" : "text-mute",
                )}
              >
                {signed(entry.deltaMilli)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-ink-soft">
                {entry.balanceAfterMilli == null ? "—" : formatCredits(entry.balanceAfterMilli)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Banner({
  tone,
  children,
  onDismiss,
}: {
  tone: "ok" | "info" | "warn";
  children: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="status"
      className={cn(
        "hairline flex items-start justify-between gap-4 bg-surface px-5 py-4 text-sm",
        tone === "ok" && "text-ok",
        tone === "warn" && "text-signal",
      )}
    >
      <p>{children}</p>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="shrink-0 text-xs text-mute hover:text-ink">
          Dismiss
        </button>
      )}
    </div>
  );
}
