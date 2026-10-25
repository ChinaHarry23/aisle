import { cn } from "@/lib/cn";
import type { ConnectionState, ConnectionTestResult } from "@/lib/connections";
import { getByoKey, setByoKey } from "@/lib/media/byo-key";
import type { ProviderId } from "@/lib/media/types";
import { useState, type ReactNode } from "react";

function ConnectionBadge({ state }: { state: ConnectionState }) {
  if (state === "workspace") return <span className="status-chip status-run">Workspace key</span>;
  if (state === "device") return <span className="status-chip status-run">Your key</span>;
  if (state === "endpoint") return <span className="status-chip status-run">Endpoint set</span>;
  return <span className="status-chip status-soft">Not connected</span>;
}

function mask(key: string) {
  return key ? `••••••••${key.slice(-4)}` : "";
}

/** Mounted only after hydration (the settings page renders client-side), so reading localStorage in the initialiser is safe. */
export function MediaKeyEditor({
  provider,
  onChange,
}: {
  provider: ProviderId;
  onChange: (hasKey: boolean) => void;
}) {
  const [stored, setStored] = useState(() => getByoKey(provider));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function commit(next: string) {
    setByoKey(provider, next);
    setStored(next);
    setDraft("");
    setEditing(false);
    onChange(Boolean(next));
  }

  if (stored && !editing) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <code className="rounded-[var(--r-btn)] bg-paper-2 px-2.5 py-1.5 text-xs">{mask(stored)}</code>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-[var(--r-btn)] border border-line px-3 py-1.5 text-xs font-medium hover:bg-paper-2"
        >
          Replace
        </button>
        <button
          type="button"
          onClick={() => commit("")}
          className="rounded-[var(--r-btn)] border border-line px-3 py-1.5 text-xs font-medium text-danger hover:bg-paper-2"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim()) commit(draft.trim());
      }}
    >
      <input
        type="password"
        autoComplete="off"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Paste API key"
        aria-label={`${provider} API key`}
        className="min-w-0 flex-1 border px-3 py-2 text-sm outline-none focus:border-signal"
      />
      <button
        type="submit"
        disabled={!draft.trim()}
        className="btn-primary rounded-[var(--r-btn)] px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        Save
      </button>
      {editing ? (
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-[var(--r-btn)] border border-line px-3 py-2 text-sm"
        >
          Cancel
        </button>
      ) : null}
    </form>
  );
}

/** Shown when the key already lives in the server's .env. The value never reaches the browser, so this is a fixed-length mask. */
export function WorkspaceKeyField({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <input
        type="password"
        readOnly
        disabled
        value="••••••••••••••••"
        aria-label={`${label} key, set in the workspace environment`}
        className="w-full border bg-paper-2 px-3 py-2 text-sm text-ink-soft"
      />
      <p className="text-xs text-mute">Set in the workspace .env. Hidden for security.</p>
    </div>
  );
}

export type TestControl = {
  onRun: () => void;
  busy: boolean;
  result: ConnectionTestResult | null;
};

function TestButton({ test, label }: { test: TestControl; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        onClick={test.onRun}
        disabled={test.busy}
        aria-label={`Test ${label} connection`}
        className="rounded-[var(--r-btn)] border border-line px-3 py-1.5 text-xs font-medium hover:bg-paper-2 disabled:opacity-50"
      >
        {test.busy ? "Testing…" : "Test connection"}
      </button>
      <span role="status" aria-live="polite" className="text-xs">
        {test.result ? (
          <span className={test.result.ok ? "text-ok" : "text-danger"}>
            {test.result.ok ? "✓ " : "✕ "}
            {test.result.message}
            {test.result.ok && test.result.ms ? ` (${test.result.ms} ms)` : ""}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function ProviderRow({
  id,
  name,
  kinds,
  state,
  usedBy = [],
  highlighted = false,
  test,
  children,
}: {
  id: string;
  name: string;
  kinds: string;
  state: ConnectionState;
  usedBy?: string[];
  highlighted?: boolean;
  /** Only passed for providers that have a free call to check a key with. */
  test?: TestControl;
  children?: ReactNode;
}) {
  return (
    <div
      id={id}
      tabIndex={-1}
      className={cn(
        "flex flex-col gap-3 px-4 py-4 outline-none transition-colors md:grid md:grid-cols-[14rem_1fr] md:items-start md:gap-6",
        highlighted && "bg-signal-soft",
      )}
    >
      <div className="flex items-center justify-between gap-3 md:block">
        <div>
          <p className="text-sm font-semibold">{name}</p>
          <p className="text-xs text-mute">{kinds}</p>
        </div>
        <div className="md:mt-2">
          <ConnectionBadge state={state} />
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-2.5">
        {children}
        {test && state !== "none" ? <TestButton test={test} label={name} /> : null}
        <p className="text-xs text-mute">
          {usedBy.length ? `Used by: ${usedBy.join(", ")}` : "Not used by any step yet."}
        </p>
      </div>
    </div>
  );
}
