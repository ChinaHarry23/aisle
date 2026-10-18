"use client";

import { useEffect, useState } from "react";

type Status = { configured: boolean };

export function WhichGrocerConnect() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/whichgrocer/status")
      .then((response) => (response.ok ? (response.json() as Promise<Status>) : null))
      .then((json) => {
        if (!cancelled && json && typeof json.configured === "boolean") setStatus(json);
      })
      .catch(() => {
        if (!cancelled) setStatus({ configured: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const configured = status?.configured === true;

  return (
    <div id="conn-whichgrocer" className="hairline flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">WhichGrocer</h3>
          <p className="mt-1 max-w-xl text-sm text-ink-soft">
            Trend research reads live Coles, Woolworths and ALDI catalogue prices from the WhichGrocer API.
            The key stays on the server.
          </p>
        </div>
        <span className={configured ? "text-xs font-medium text-ok" : "text-xs font-medium text-mute"}>
          {status == null ? "Checking…" : configured ? "Key set" : "Key missing"}
        </span>
      </div>
      {status && !configured ? (
        <p className="text-sm text-ink-soft">
          Set WHICHGROCER_API_KEY in the server environment and restart. Shelf prices stay unavailable until then.
        </p>
      ) : null}
    </div>
  );
}
