import type { ReactNode } from "react";
import { formatNumber, formatUsd } from "@/lib/ids";
import type { MediaGeneration } from "@/lib/media/types";

export function CostHover({
  generation,
  children,
}: {
  generation?: MediaGeneration;
  children: ReactNode;
}) {
  if (!generation) return children;
  const u = generation.usage;
  return (
    <div className="group relative">
      {children}
      <span className="absolute right-3 top-3 z-10 rounded-full bg-ink/85 px-2 py-0.5 text-[10px] tabular-nums text-paper">
        {formatUsd(u.costUsd)}
      </span>
      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 opacity-0 transition duration-150 group-hover:opacity-100">
        <div className="bg-ink/95 p-3 text-paper shadow-lg">
          <p className="text-[10px] uppercase tracking-[0.16em] text-signal">
            {generation.provider} · {generation.status}
          </p>
          <p className="mt-1 font-serif text-lg">{generation.modelName}</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] tabular-nums">
            <div>
              <dt className="text-white/45">Input tokens</dt>
              <dd>{formatNumber(u.inputTokens)}</dd>
            </div>
            <div>
              <dt className="text-white/45">Output tokens</dt>
              <dd>{formatNumber(u.outputTokens)}</dd>
            </div>
            <div>
              <dt className="text-white/45">Total tokens</dt>
              <dd>{formatNumber(u.totalTokens)}</dd>
            </div>
            <div>
              <dt className="text-white/45">Billed</dt>
              <dd>
                {formatNumber(u.units)} {u.unitLabel}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-white/45">Cost</dt>
              <dd className="text-signal">{formatUsd(u.costUsd)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[10px] text-white/45">
            {u.billedAs}
            {u.estimate ? " · estimate" : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
