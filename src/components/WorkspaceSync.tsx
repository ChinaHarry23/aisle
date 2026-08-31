"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { PublicUser } from "@/lib/auth/types";
import { useAisle } from "@/lib/store";

export function WorkspaceSync({
  user,
  children,
}: {
  user: PublicUser;
  children: ReactNode;
}) {
  const hydrateFromServer = useAisle((s) => s.hydrateFromServer);
  const skipSave = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    skipSave.current = true;
    useAisle.persist.setOptions({ name: `aisle-ws-${user.id}` });

    async function load() {
      try {
        const res = await fetch("/api/workspace");
        if (!res.ok) throw new Error("workspace");
        const data = (await res.json()) as Pick<
          ReturnType<typeof useAisle.getState>,
          "brand" | "campaigns" | "settings"
        >;
        if (cancelled) return;
        hydrateFromServer(data);
      } catch {
        if (cancelled) return;
        await useAisle.persist.rehydrate();
        useAisle.getState().setHydrated();
      } finally {
        skipSave.current = false;
      }
    }

    void load();

    const unsub = useAisle.subscribe((state, prev) => {
      if (skipSave.current) return;
      if (
        state.brand === prev.brand &&
        state.campaigns === prev.campaigns &&
        state.settings === prev.settings
      ) {
        return;
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const snap = useAisle.getState();
        void fetch("/api/workspace", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brand: snap.brand,
            campaigns: snap.campaigns,
            settings: snap.settings,
          }),
        });
      }, 700);
    });

    return () => {
      cancelled = true;
      unsub();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [hydrateFromServer, user.id]);

  return children;
}
