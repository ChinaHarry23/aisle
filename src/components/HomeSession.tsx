"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { Overview } from "@/components/Overview";
import { readSignedInHint, rememberSignedIn, subscribeSignedInHint } from "@/lib/auth/client";
import type { PublicUser } from "@/lib/auth/types";

/**
 * The signed-out home page is static HTML. A browser that already signed in
 * swaps to the studio after hydration, using the saved account rather than
 * waiting for the database. A cookie without that hint (an OAuth return) is
 * confirmed in the background.
 */
export function HomeSession({ children }: { children: ReactNode }) {
  const hint = useSyncExternalStore(subscribeSignedInHint, readSignedInHint, () => null);

  useEffect(() => {
    if (hint) return;
    let cancelled = false;
    void fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { user?: PublicUser | null } | null) => {
        if (!cancelled && json?.user) rememberSignedIn(json.user);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hint]);

  if (hint) {
    return (
      <AppShell user={hint}>
        <Overview />
      </AppShell>
    );
  }
  return children;
}
