/** A line in the live agent window. The model returns a finished reply; these lines are the actions in between. */

export type AgentActivityKind = "think" | "tool" | "write" | "status";

export type AgentActivityLine = {
  id: string;
  phase: string;
  kind: AgentActivityKind;
  text: string;
};

const TOOL_PHASE = /^(web|stats|retail|calendar)\./;

export function activityKind(phase: string): AgentActivityKind {
  if (TOOL_PHASE.test(phase)) return "tool";
  if (phase === "creative" || phase === "media" || phase === "trend.brief" || phase === "strategy") return "write";
  if (
    phase === "research-model" ||
    phase === "quality" ||
    phase === "compliance" ||
    phase === "trend.quality" ||
    phase === "trend.research" ||
    phase === "research"
  ) {
    return "think";
  }
  return "status";
}

export function activityLabel(kind: AgentActivityKind): string {
  if (kind === "tool") return "Tool";
  if (kind === "write") return "Writing";
  if (kind === "think") return "Thinking";
  return "State";
}
