"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatCredits } from "@/lib/billing/plan";
import { cn } from "@/lib/cn";
import { BILLING_CHANGED } from "./events";

type Brief = { unlimited: boolean; balanceMilli: number; spentMilli?: number; allowanceMilli?: number };

/**
 * Used and remaining credits in the top bar. Refreshes on navigation, on focus
 * and when a page announces a change; a failed read just hides the meter.
 */
export function CreditsBadge({ pathname }: { pathname: string }) {
  const [brief, setBrief] = useState<Brief | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void fetch("/api/billing?brief=1", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((json: Brief | null) => {
          if (!cancelled) setBrief(json && typeof json.balanceMilli === "number" ? json : null);
        })
        .catch(() => {
          if (!cancelled) setBrief(null);
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener(BILLING_CHANGED, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
      window.removeEventListener(BILLING_CHANGED, refresh);
    };
  }, [pathname]);

  if (!brief) return null;
  if (brief.unlimited) {
    const logged = Math.max(0, brief.spentMilli ?? 0);
    return (
      <Link href="/account/usage" title="Usage" className="flex flex-col items-end gap-0.5 text-ink">
        <span className="text-[11px] uppercase tracking-[0.14em]">Unlimited</span>
        <span className="text-[10px] tabular-nums text-ink">{formatCredits(logged)} logged</span>
      </Link>
    );
  }

  const left = Math.max(0, brief.balanceMilli);
  const spent = Math.max(0, brief.spentMilli ?? 0);
  const allowance = Math.max(brief.allowanceMilli ?? left + spent, left + spent, 1);
  const remaining = Math.round((left / allowance) * 100);

  return (
    <Link href="/account/usage" title="Usage" className="flex w-44 flex-col gap-1 text-ink">
      <span className="flex justify-between text-[10px] uppercase tracking-wider tabular-nums">
        <span>{formatCredits(spent)} used</span>
        <span>{formatCredits(left)} left</span>
      </span>
      <span
        className="h-1.5 overflow-hidden rounded-full bg-paper-2"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={allowance}
        aria-valuenow={left}
        aria-label={`${formatCredits(spent)} credits used, ${formatCredits(left)} left`}
      >
        <span className={cn("block h-full bg-ink", remaining < 20 && "bg-signal")} style={{ width: `${remaining}%` }} />
      </span>
    </Link>
  );
}
