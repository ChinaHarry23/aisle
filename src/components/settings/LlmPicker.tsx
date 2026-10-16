import { formatCredits, milliForCost } from "@/lib/billing/plan";
import { cn } from "@/lib/cn";
import { assignmentFor, LLM_PROVIDERS, llmsByProvider, UNAVAILABLE_LLM_PROVIDERS } from "@/lib/llm/catalog";
import { quoteLlm } from "@/lib/llm/estimate";
import type { AgentSlot, LlmAssignment, LlmModel } from "@/lib/llm/types";
import type { ReactNode } from "react";

/** Typical credits for one decision on this model; local models are free. */
export function seatCostLabel(model: LlmModel, agent: AgentSlot) {
  if (model.providerId === "local") return "Free";
  const credits = formatCredits(milliForCost(quoteLlm(model.id, agent).costUsd));
  return `${credits.startsWith("<") ? "" : "~"}${credits} ${credits === "1" ? "credit" : "credits"}`;
}

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
        {UNAVAILABLE_LLM_PROVIDERS.map((p) => (
          <Chip key={p.id} active={false} disabled title={p.reason}>
            {p.name}
          </Chip>
        ))}
      </div>
      <ul className="mt-3 max-h-[220px] space-y-1 overflow-y-auto scrollbar-thin">
        {models.map((m) => {
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
                  <span className="shrink-0 text-xs tabular-nums text-signal">{seatCostLabel(m, agent)}</span>
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
  disabled,
  title,
  children,
}: {
  active: boolean;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px]",
        active ? "bg-ink text-paper" : "border border-line bg-surface text-ink-soft",
        disabled && "cursor-not-allowed line-through opacity-50",
      )}
    >
      {children}
    </button>
  );
}
