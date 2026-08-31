import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { pipelineIndex, statusLabel, statusTone } from "@/lib/status";
import type { CampaignStatus, RiskLevel } from "@/lib/types";

export function StatusBadge({ status }: { status: CampaignStatus }) {
  return <span className={statusTone[status]}>{statusLabel[status]}</span>;
}

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  const tone = risk === "high" ? "risk-high" : risk === "medium" ? "risk-mid" : "risk-low";
  return <span className={cn("status-chip capitalize", tone)}>{risk} risk</span>;
}

export function Confidence({ value, label }: { value: number; label?: string }) {
  return (
    <div className="min-w-[88px]">
      <div className="mb-1 flex justify-between text-[10px] uppercase tracking-wider text-mute">
        <span>{label ?? "Confidence"}</span>
        <span className="tabular-nums text-ink">{value}%</span>
      </div>
      <div className="h-1 w-full bg-paper-2">
        <div className="h-1 bg-signal" style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  );
}

const steps = [
  { key: "draft", label: "Create" },
  { key: "analysing", label: "Trend" },
  { key: "generating", label: "Creative" },
  { key: "compliance", label: "Compliance" },
  { key: "awaiting_approval", label: "Founder" },
  { key: "scheduled", label: "Schedule" },
  { key: "published", label: "Published" },
] as const;

export function AgentPipeline({ status }: { status: CampaignStatus }) {
  const idx = pipelineIndex(status);
  return (
    <ol className="grid grid-cols-7 gap-1">
      {steps.map((step, i) => {
        const done = i < idx || status === "published";
        const current = i === idx && status !== "published";
        return (
          <li key={step.key} className="flex flex-col gap-1.5">
            <span
              className={cn(
                "h-1 w-full rounded-full",
                done ? "bg-ink" : current ? "bg-signal" : "bg-line",
              )}
            />
            <span
              className={cn(
                "text-[10px] uppercase tracking-wider",
                current ? "text-signal" : done ? "text-ink" : "text-mute",
              )}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="hairline p-4">
      <p className="text-[11px] uppercase tracking-wider text-mute">{label}</p>
      <p className="mt-2 font-serif text-3xl leading-none">{value}</p>
      {hint ? <p className="mt-2 text-sm text-mute">{hint}</p> : null}
    </div>
  );
}

export function SectionTitle({
  kicker,
  title,
  aside,
}: {
  kicker?: string;
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        {kicker ? (
          <p className="text-[11px] uppercase tracking-[0.18em] text-signal">{kicker}</p>
        ) : null}
        <h2 className="font-serif text-2xl md:text-3xl">{title}</h2>
      </div>
      {aside}
    </div>
  );
}

export function Empty({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="hairline flex flex-col items-start gap-3 p-8">
      <h3 className="font-serif text-xl">{title}</h3>
      <p className="max-w-md text-sm leading-relaxed text-ink-soft">{body}</p>
      {children}
    </div>
  );
}
