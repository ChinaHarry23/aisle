"use client";

import { useEffect, useState } from "react";
import type { ProviderId } from "@/lib/media/types";

export type ProviderStatus = { id: ProviderId; name: string; usable: boolean; reason?: string };

// One request per page load; which providers the server can call does not change while it runs.
let pending: Promise<ProviderStatus[] | null> | null = null;

function load() {
  pending ??= fetch("/api/studio/providers", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((data: { providers?: ProviderStatus[] } | null) => data?.providers ?? null)
    .catch(() => null)
    .then((providers) => {
      if (!providers) pending = null; // Retry on the next mount rather than caching a failure.
      return providers;
    });
  return pending;
}

/**
 * Media providers this server can actually call. `null` until known (or when
 * the check failed), so callers treat unknown as usable instead of greying
 * everything out on a slow network.
 */
export function useMediaProviders(): Partial<Record<ProviderId, ProviderStatus>> | null {
  const [status, setStatus] = useState<Partial<Record<ProviderId, ProviderStatus>> | null>(null);
  useEffect(() => {
    let live = true;
    void load().then((providers) => {
      if (live && providers) setStatus(Object.fromEntries(providers.map((p) => [p.id, p])));
    });
    return () => {
      live = false;
    };
  }, []);
  return status;
}

/** Whether a provider can render here. Unknown counts as yes until the server says otherwise. */
export function providerUsable(status: Partial<Record<ProviderId, ProviderStatus>> | null, id: ProviderId) {
  return status?.[id]?.usable ?? true;
}
