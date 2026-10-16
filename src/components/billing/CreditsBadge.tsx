"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatCredits } from "@/lib/billing/plan";
import { cn } from "@/lib/cn";
import { BILLING_CHANGED } from "./events";

type Brief = { unlimited: boolean; balanceMilli: number };

/**
 * The balance in the top bar. Refreshes on navigation, on focus and when a
 * page announces a change; a failed read just hides the badge.
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
  const low = !brief.unlimited && brief.balanceMilli < 50 * 1000;
  return (
    <Link
      href="/billing"
      title="Credits — open Billing"
      className={cn(
        "whitespace-nowrap text-[11px] uppercase tracking-[0.14em] tabular-nums hover:underline",
        low && "text-signal",
      )}
    >
      {brief.unlimited ? "Unlimited" : `${formatCredits(brief.balanceMilli)} credits`}
    </Link>
  );
}
