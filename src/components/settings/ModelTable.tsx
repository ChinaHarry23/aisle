import { cn } from "@/lib/cn";
import { useMemo, useState } from "react";

export type ModelRow = {
  id: string;
  name: string;
  providerId: string;
  provider: string;
  bestFor: string;
  cost: string;
  /** Whether the provider has a key or endpoint, so the row can say so without leaving the table. */
  connected: boolean;
  note?: string;
};

export function ModelTable({
  label,
  rows,
  value,
  onChange,
}: {
  label: string;
  rows: ModelRow[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("all");

  const providers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) seen.set(r.providerId, r.provider);
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (provider === "all" || r.providerId === provider) &&
        (!q || `${r.name} ${r.provider} ${r.bestFor}`.toLowerCase().includes(q)),
    );
  }, [rows, query, provider]);

  const showFilters = rows.length > 6;

  return (
    <div>
      {showFilters ? (
        <div className="mb-3 flex flex-wrap gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models"
            aria-label={`Search ${label}`}
            className="min-w-0 flex-1 border px-3 py-2 text-sm outline-none focus:border-signal"
          />
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            aria-label="Filter by provider"
            className="border px-3 py-2 text-sm"
          >
            <option value="all">All providers</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div
        role="radiogroup"
        aria-label={label}
        className="divide-y divide-line overflow-hidden rounded-[var(--r-card)] border border-line"
      >
        <div
          aria-hidden
          className="hidden grid-cols-[1.4fr_1.6fr_auto] gap-4 bg-paper-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-mute md:grid"
        >
          <span>Model</span>
          <span>Best for</span>
          <span className="w-28 text-right">Est. cost</span>
        </div>
        {visible.map((r) => {
          const selected = r.id === value;
          return (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(r.id)}
              className={cn(
                "grid w-full grid-cols-[auto_1fr_auto] items-start gap-x-3 gap-y-1 px-4 py-3 text-left transition md:grid-cols-[auto_1.4fr_1.6fr_auto] md:gap-x-4",
                selected ? "bg-signal-soft" : "bg-surface hover:bg-paper-2",
              )}
            >
              <span
                className={cn(
                  "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                  selected ? "border-signal" : "border-line",
                )}
              >
                {selected ? <span className="h-2 w-2 rounded-full bg-signal" /> : null}
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{r.name}</span>
                  {!r.connected ? <span className="status-chip status-soft">Not connected</span> : null}
                </span>
                <span className="block text-xs text-mute">{r.provider}</span>
              </span>
              <span className="col-span-2 col-start-2 text-sm text-ink-soft md:col-span-1 md:col-start-auto">
                {r.bestFor}
                {r.note ? <span className="block text-xs text-mute">{r.note}</span> : null}
              </span>
              <span className="col-start-3 row-start-1 w-28 text-right text-xs tabular-nums text-ink-soft md:col-start-auto md:row-start-auto">
                {r.cost}
              </span>
            </button>
          );
        })}
        {visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-mute">No models match.</p>
        ) : null}
      </div>
    </div>
  );
}
