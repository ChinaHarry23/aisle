"use client";

import { useEffect, useState } from "react";

type Status = { connected: boolean; updatedAt: string | null };

function noticeFromSearch(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const flag = params.get("whichgrocer");
  if (flag === "connected") {
    return "WhichGrocer is connected. The next trend run will cite live catalogue prices.";
  }
  if (flag === "error") {
    return params.get("message") || "WhichGrocer could not be connected.";
  }
  return null;
}

export function WhichGrocerConnect() {
  const [status, setStatus] = useState<Status | null>(null);
  const [notice, setNotice] = useState<string | null>(noticeFromSearch);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/whichgrocer/status")
      .then((response) => (response.ok ? (response.json() as Promise<Status>) : null))
      .then((json) => {
        if (!cancelled && json) setStatus(json);
      })
      .catch(() => {
        if (!cancelled) setStatus({ connected: false, updatedAt: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function disconnect() {
    setBusy(true);
    try {
      const response = await fetch("/api/whichgrocer/disconnect", { method: "POST" });
      if (response.ok) {
        setStatus({ connected: false, updatedAt: null });
        setNotice("WhichGrocer was disconnected. Shelf prices will be recorded as unavailable until you connect again.");
      }
    } finally {
      setBusy(false);
    }
  }

  const connected = status?.connected === true;
  const updated = status?.updatedAt ? status.updatedAt.slice(0, 10) : null;

  return (
    <div id="conn-whichgrocer" className="hairline flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">WhichGrocer</h3>
          <p className="mt-1 max-w-xl text-sm text-ink-soft">
            Trend research reads live Coles, Woolworths and ALDI catalogue prices through the WhichGrocer connector.
            Sign in once with your WhichGrocer account. A new account includes a monthly credit allowance.
          </p>
        </div>
        <span className={connected ? "text-xs font-medium text-ok" : "text-xs font-medium text-mute"}>
          {status == null ? "Checking…" : connected ? "Connected" : "Not connected"}
        </span>
      </div>
      {updated && connected ? <p className="text-xs text-mute">Signed in {updated}.</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        {connected ? (
          <button
            type="button"
            onClick={() => void disconnect()}
            disabled={busy}
            className="rounded-[var(--r-btn)] border border-line px-3 py-1.5 text-xs font-medium hover:bg-paper-2 disabled:opacity-50"
          >
            {busy ? "Disconnecting…" : "Disconnect"}
          </button>
        ) : (
          <a href="/api/whichgrocer/connect" className="btn-primary rounded-[var(--r-btn)] px-4 py-2 text-sm font-medium">
            Connect WhichGrocer
          </a>
        )}
      </div>
      {notice ? (
        <p role="status" className="text-sm text-ink-soft">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
