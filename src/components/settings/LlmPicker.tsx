import { cn } from "@/lib/cn";
import { formatUsd } from "@/lib/ids";
import { assignmentFor, LLM_PROVIDERS, llmsByProvider } from "@/lib/llm/catalog";
import { quoteLlm } from "@/lib/llm/estimate";
import type { AgentSlot, LlmAssignment } from "@/lib/llm/types";
import type { ReactNode } from "react";

export function LlmPicker({
  value,
  onChange,
  agent,
}: {
  value: LlmAssignment;
  onChange: (next: LlmAssignment) => void;
  agent: AgentSlot;
}) {
  const models = llmsByProvider(value.provider);

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {LLM_PROVIDERS.map((p) => (
          <Chip key={p.id} active={value.provider === p.id} onClick={() => onChange(assignmentFor(p.id, value.modelId))}>
            {p.name}
          </Chip>
        ))}
      </div>
      <ul className="mt-3 max-h-[220px] space-y-1 overflow-y-auto scrollbar-thin">
        {models.map((m) => {
          const quote = quoteLlm(m.id, agent);
          const selected = m.id === value.modelId;
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onChange({ provider: m.providerId, modelId: m.id })}
                className={cn(
                  "w-full border px-3 py-2 text-left transition",
                  selected ? "border-ink bg-surface" : "border-transparent hover:bg-surface",
                )}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{m.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-signal">
                    {m.billing.inputPerM === 0 ? "$0" : `~${formatUsd(quote.costUsd)}`}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-mute">
                  {m.bestFor}
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
