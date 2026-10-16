"use client";

import { cn } from "@/lib/cn";
import { formatUsd } from "@/lib/ids";
import { formatCredits, milliForCost } from "@/lib/billing/plan";
import { modelsByProvider, PROVIDERS, snapCampaignDuration, sunsetLabel } from "@/lib/media/catalog";
import { quoteModel } from "@/lib/media/estimate";
import type { MediaKind, ProviderId } from "@/lib/media/types";
import { useMemo, useState, type ReactNode } from "react";
import { providerUsable, useMediaProviders } from "./useMediaProviders";

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
  const status = useMediaProviders();
  const models = useMemo(() => {
    // Usable providers first; greyed-out ones stay listed so the catalog is honest.
    const list = modelsByProvider(kind, provider);
    return [...list].sort((a, b) => Number(providerUsable(status, b.providerId)) - Number(providerUsable(status, a.providerId)));
  }, [kind, provider, status]);
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
          <Chip key={p.id} active={provider === p.id} muted={!providerUsable(status, p.id)} onClick={() => setProvider(p.id)}>
            {p.name}
          </Chip>
        ))}
      </div>
      <ul className="mt-3 max-h-[280px] space-y-1 overflow-y-auto scrollbar-thin">
        {models.map((m) => {
          // Priced at the length this model would really render: the saved one, snapped like the Studio and server do.
          const seconds = kind === "video" ? snapCampaignDuration(m, durationSec ?? 30) : undefined;
          const quote = quoteModel(m.id, { durationSec: seconds });
          const selected = m.id === value;
          const usable = providerUsable(status, m.providerId);
          const sunset = sunsetLabel(m);
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onChange(m.id)}
                disabled={!usable && !selected}
                aria-disabled={!usable}
                title={usable ? undefined : status?.[m.providerId]?.reason}
                className={cn(
                  "w-full border px-3 py-2.5 text-left transition",
                  selected ? "border-ink bg-surface" : "border-transparent hover:bg-surface",
                  !usable && "cursor-not-allowed opacity-45 hover:bg-transparent",
                )}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{m.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-signal">
                    {usable
                      ? `${kind === "video" ? `${formatUsd(quote.costUsd)} / ${seconds}s` : formatUsd(quote.costUsd)}${quote.costUsd > 0 ? ` · ${formatCredits(milliForCost(quote.costUsd))} cr` : " · free"}`
                      : "Not available"}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-mute">
                  {m.provider} · {m.bestFor}
                  {m.durations ? ` · ${m.durations.join("/")}s` : ""}
                  {m.notes ? ` · ${m.notes}` : ""}
                </p>
                {sunset ? <p className="mt-0.5 text-xs text-amber-800">{sunset}. Pick another model for anything long-lived.</p> : null}
                {!usable && selected ? (
                  <p className="mt-0.5 text-xs text-amber-800">
                    {providerUsable(status, "comfy") ? "Not available here — renders on local ComfyUI instead." : "Not available on this server, and local ComfyUI is not reachable. Pick an available model."}
                  </p>
                ) : null}
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
  muted,
  onClick,
  children,
}: {
  active: boolean;
  muted?: boolean;
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
        muted && !active && "opacity-50",
      )}
    >
      {children}
    </button>
  );
}
