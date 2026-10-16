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
    let serviceMode = false;
    skipSave.current = true;
    useAisle.persist.setOptions({ name: `aisle-ws-${user.id}` });

    async function load() {
      try {
        const res = await fetch("/api/workspace");
        if (!res.ok) throw new Error("workspace");
        const data = (await res.json()) as Pick<
          ReturnType<typeof useAisle.getState>,
          "brand" | "campaigns" | "settings"
        > & { workflow?: boolean };
        if (cancelled) return;
        serviceMode = data.workflow === true;
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

    const refresh = setInterval(async () => {
      if (!serviceMode || cancelled) return;
      try {
        const response = await fetch("/api/workspace", { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const data = await response.json() as { campaigns: ReturnType<typeof useAisle.getState>["campaigns"]; workflowCampaignIds: string[] };
        if (cancelled) return;
        const managed = new Map(data.campaigns.filter(c => data.workflowCampaignIds.includes(c.id)).map(c => [c.id, c]));
        skipSave.current = true;
        useAisle.setState(s => ({ campaigns: [...s.campaigns.map(c => managed.get(c.id) ?? c), ...[...managed.values()].filter(c => !s.campaigns.some(x => x.id === c.id))] }));
      } catch { /* Keep the last confirmed snapshot until the service is reachable. */ }
      finally { skipSave.current = false; }
    }, 2000);

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
      clearInterval(refresh);
      unsub();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [hydrateFromServer, user.id]);

  return children;
}
