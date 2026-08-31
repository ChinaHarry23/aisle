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
};

export function AgentLog({ events, dense }: { events: AgentEvent[]; dense?: boolean }) {
  const list = [...events].reverse();
  return (
    <ol className={cn("flex flex-col", dense ? "gap-3" : "gap-4")}>
      {list.map((event) => (
        <li key={event.id} className="flex gap-3">
          <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", agentMark[event.agent])} />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-mute">
              {agentLabel[event.agent]} · {event.kind} · {formatDate(event.at, true)}
            </p>
            <p className="mt-0.5 text-sm font-medium text-ink">{event.title}</p>
            <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">{event.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
