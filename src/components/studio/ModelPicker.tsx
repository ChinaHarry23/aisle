import { cn } from "@/lib/cn";
import { formatUsd } from "@/lib/ids";
import { modelsByProvider, PROVIDERS } from "@/lib/media/catalog";
import { quoteModel } from "@/lib/media/estimate";
import type { MediaKind, ProviderId } from "@/lib/media/types";
import { useMemo, useState, type ReactNode } from "react";

export function ModelPicker({
  kind,
  value,
  onChange,
  durationSec,
}: {
  kind: MediaKind;
  value: string;
  onChange: (id: string) => void;
  durationSec?: number;
}) {
  const [provider, setProvider] = useState<ProviderId | "all">("all");
  const models = useMemo(() => modelsByProvider(kind, provider), [kind, provider]);
  const providers = PROVIDERS.filter((p) =>
    modelsByProvider(kind, p.id).length > 0,
  );

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        <Chip active={provider === "all"} onClick={() => setProvider("all")}>
          All
        </Chip>
        {providers.map((p) => (
          <Chip key={p.id} active={provider === p.id} onClick={() => setProvider(p.id)}>
            {p.name}
          </Chip>
        ))}
      </div>
      <ul className="mt-3 max-h-[280px] space-y-1 overflow-y-auto scrollbar-thin">
        {models.map((m) => {
          const quote = quoteModel(m.id, { durationSec });
          const selected = m.id === value;
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onChange(m.id)}
                className={cn(
                  "w-full border px-3 py-2.5 text-left transition",
                  selected ? "border-ink bg-surface" : "border-transparent hover:bg-surface",
                )}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{m.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-signal">
                    {kind === "video"
                      ? `${formatUsd(quote.costUsd)} / ${durationSec ?? 8}s`
                      : formatUsd(quote.costUsd)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-mute">
                  {m.provider} · {m.bestFor}
                  {m.notes ? ` · ${m.notes}` : ""}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px]",
        active ? "bg-ink text-paper" : "border border-line bg-surface text-ink-soft",
      )}
    >
      {children}
    </button>
  );
}
