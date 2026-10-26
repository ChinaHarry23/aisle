"use client";

import { useState } from "react";
import { CREDIT_PACK } from "@/lib/billing/plan";

/** Opens Stripe Checkout for the one-time credit pack. */
export function BuyCreditsButton({ ready }: { ready: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buy() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/topup", { method: "POST" });
      const json = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !json?.url) throw new Error(json?.error ?? `Request failed (${res.status}).`);
      window.location.assign(json.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={!ready || busy}
        onClick={() => void buy()}
        className="rounded-full bg-ink px-4 py-2 text-sm text-paper hover:bg-ink-soft disabled:opacity-50"
      >
        {busy
          ? "Opening Stripe…"
          : `Buy ${CREDIT_PACK.credits.toLocaleString("en-US")} credits — $${CREDIT_PACK.priceUsd}`}
      </button>
      {!ready && <p className="mt-2 text-xs text-mute">Card checkout is not switched on for this server yet.</p>}
      {error && <p className="mt-2 text-xs text-signal">{error}</p>}
    </div>
  );
}
