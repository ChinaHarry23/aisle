"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { OPERATION_NODES, operationNodeForStep, type OperationNodeId } from "@/lib/runtime/operation-diagram";

type GraphPayload = {
  mermaid: string;
  tracing: { enabled: boolean; project: string | null };
};

export function OperationGraph({ step }: { step: string | null | undefined }) {
  const current = operationNodeForStep(step);
  const [graph, setGraph] = useState<GraphPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/engine/graph")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: GraphPayload | null) => {
        if (!cancelled && json?.mermaid) setGraph(json);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="hairline p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[11px] uppercase tracking-wider text-mute">Operation graph</h3>
        <p className="text-xs text-mute">
          {graph?.tracing.enabled
            ? `Tracing to LangSmith · ${graph.tracing.project}`
            : "LangSmith tracing is off"}
        </p>
      </div>
      <ol className="mt-3 flex flex-wrap items-center gap-1.5">
        {OPERATION_NODES.map((node, index) => (
          <li key={node.id} className="flex items-center gap-1.5">
            <NodeBox id={node.id} label={node.label} current={current} />
            {index < OPERATION_NODES.length - 1 ? <span className="text-mute">→</span> : null}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-ink-soft">
        Compliance can send the draft back through{" "}
        <NodeBox id="revise" label="Revise" current={current} /> up to three times, then it waits
        at Founder. Schedule waits when a channel conflicts.
      </p>
      {graph?.mermaid ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-mute">LangGraph definition</summary>
          <pre className="mt-2 overflow-x-auto text-[11px] leading-relaxed text-ink-soft">{graph.mermaid}</pre>
        </details>
      ) : null}
    </div>
  );
}

function NodeBox({
  id,
  label,
  current,
}: {
  id: OperationNodeId;
  label: string;
  current: OperationNodeId | null;
}) {
  const on = current === id;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-wider",
        on ? "border-signal bg-signal text-white" : "border-line text-ink-soft",
      )}
    >
      {label}
    </span>
  );
}
