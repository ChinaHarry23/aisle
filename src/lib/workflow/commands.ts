import type { Command } from "../runtime/types";
import type { Campaign } from "../types";

export class WorkflowError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

/** The public gateway accepts founder commands, never an actor supplied by an agent. */
export function parseCommand(raw: unknown): Command {
  if (!raw || typeof raw !== "object") throw new WorkflowError("A command is required.");
  const c = raw as Record<string, unknown>;
  const note = typeof c.note === "string" ? c.note.slice(0, 4000) : "";
  if (c.type === "ATTEMPT_BLOCKED") {
    const actions = ["PUBLISH_CONTENT", "SPEND_MEDIA", "EDIT_APPROVED_CLAIM", "CHANGE_CAMPAIGN_SCOPE", "IMPORT_UNAUTHORISED_DATA", "SKIP_ITEM_SILENTLY", "APPROVE_OWN_WORK", "READ_INTERNAL_DATA"];
    if (!actions.includes(String(c.actor))) throw new WorkflowError("Unknown boundary-check action.");
    return { type: "ATTEMPT_BLOCKED", actor: c.actor as Extract<Command, {type: "ATTEMPT_BLOCKED"}>["actor"], note };
  }
  if (c.actor !== "founder") throw new WorkflowError("Only the signed-in founder can submit commands.", 403);
  switch (c.type) {
    case "START": case "PAUSE": case "APPROVE": case "REQUEST_CHANGES": case "REJECT": case "PUBLISH":
      return { type: c.type, actor: "founder", note };
    case "ADVANCE": case "COLLECT_FEEDBACK": return { type: c.type, actor: "founder" };
    case "DECIDE_RECOMMENDATION":
      if (!["accepted", "edited", "discarded"].includes(String(c.action))) throw new WorkflowError("Choose accepted, edited or discarded.");
      return { type: c.type, actor: "founder", action: c.action as "accepted" | "edited" | "discarded", text: typeof c.text === "string" ? c.text.slice(0, 8000) : undefined, note };
    case "RESOLVE_CONFLICT":
      if (typeof c.conflictId !== "string") throw new WorkflowError("A conflict ID is required.");
      return { type: c.type, actor: "founder", conflictId: c.conflictId, note };
    default: throw new WorkflowError("Unknown workflow command.");
  }
}

/** Enforce legal transitions against the durable snapshot, not browser fields. */
export function assertTransition(c: Campaign, command: Command) {
  const allowed: Partial<Record<Command["type"], boolean>> = {
    START: c.status === "draft" || c.status === "paused",
    ADVANCE: c.run?.status === "running",
    PAUSE: c.run?.status === "running" || c.status === "paused",
    APPROVE: c.status === "awaiting_approval" && c.creatives.length > 0 && c.complianceAttempts.length > 0,
    REQUEST_CHANGES: c.status === "awaiting_approval" && c.creatives.length > 0,
    REJECT: c.status === "awaiting_approval",
    PUBLISH: c.status === "scheduled" && c.founderDecision?.action === "approve" && !c.scheduleConflicts.some(x => !x.resolved),
    COLLECT_FEEDBACK: c.status === "published",
    DECIDE_RECOMMENDATION: c.status === "published" && !!c.performanceReport,
    RESOLVE_CONFLICT: c.scheduleConflicts.some(x => x.id === (command as Extract<Command, {type: "RESOLVE_CONFLICT"}>).conflictId && !x.resolved),
    ATTEMPT_BLOCKED: true,
  };
  if (!allowed[command.type]) throw new WorkflowError(`${command.type} is not allowed while this campaign is ${c.status}.`, 409);
}
