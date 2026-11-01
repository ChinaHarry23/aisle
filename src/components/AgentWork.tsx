"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { activityLabel, type AgentActivityLine } from "@/lib/runtime/activity";

/** Live agent state under the pipeline. Newest line stays in view while work is running. */
export function AgentWork({ lines, busy }: { lines: AgentActivityLine[]; busy: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [lines, busy]);

  if (!busy && lines.length === 0) return null;

  return (
    <section className="mt-4 overflow-hidden rounded-lg border border-line bg-paper-2" aria-live="polite">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <p className="text-[11px] uppercase tracking-wider text-mute">Agent</p>
        <p className="inline-flex items-center gap-1.5 text-[11px] text-signal">
          <span className={cn("h-1.5 w-1.5 rounded-full bg-signal", busy && "animate-pulse")} />
          {busy ? "Working" : "Idle"}
        </p>
      </div>
      <div ref={scroller} className="max-h-44 overflow-y-auto px-3 py-2">
        <ol className="flex flex-col gap-1 font-mono text-[12px] leading-5">
          {lines.length === 0 ? (
            <li className="text-mute">Starting…</li>
          ) : (
            lines.map((line, index) => {
              const active = busy && index === lines.length - 1;
              return (
                <li key={line.id} className="flex gap-2">
                  <span className={cn("w-16 shrink-0", active ? "text-signal" : "text-mute")}>
                    {activityLabel(line.kind)}
                  </span>
                  <span className={cn("min-w-0", active ? "text-ink" : "text-ink-soft")}>{line.text}</span>
                </li>
              );
            })
          )}
        </ol>
      </div>
    </section>
  );
}
