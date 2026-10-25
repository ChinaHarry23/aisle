import { agentLabel } from "@/lib/status";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/ids";
import type { AgentEvent } from "@/lib/types";

const agentMark: Record<AgentEvent["agent"], string> = {
  founder: "bg-ink",
  trend: "bg-sky-700",
  creative: "bg-violet-700",
  compliance: "bg-signal",
  media: "bg-teal-800",
  intake: "bg-amber-700",
};

const kindTone: Partial<Record<AgentEvent["kind"], string>> = {
  policy: "text-signal",
  escalation: "text-signal",
  gap: "text-amber-700",
  tool: "text-mute",
};

export function AgentLog({ events }: { events: AgentEvent[] }) {
  const list = [...events].reverse();
  return (
    <ol className="flex flex-col gap-4">
      {list.map((event) => (
        <li key={event.id} className="flex gap-3">
          <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", agentMark[event.agent])} />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-mute">
              <span className={kindTone[event.kind]}>{event.kind}</span> ·{" "}
              {agentLabel[event.agent]} · {formatDate(event.at, true)}
            </p>
            <p className="mt-0.5 text-sm font-medium text-ink">{event.title}</p>
            <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">{event.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
