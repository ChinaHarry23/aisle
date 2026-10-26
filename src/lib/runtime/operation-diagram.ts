/**
 * The operation the founder sees, in the same order the LangGraph runs it.
 *
 * Founder and schedule are wait points: the graph stops and the next command
 * (approve, publish, collect) enters again. Revise is the compliance loop.
 */

export const OPERATION_NODES = [
  { id: "intake", label: "Intake" },
  { id: "trend", label: "Trend" },
  { id: "creative", label: "Creative" },
  { id: "compliance", label: "Compliance" },
  { id: "founder", label: "Founder" },
  { id: "media", label: "Media" },
  { id: "schedule", label: "Schedule" },
  { id: "publish", label: "Publish" },
  { id: "feedback", label: "Feedback" },
] as const;

export type OperationNodeId = (typeof OPERATION_NODES)[number]["id"] | "revise";

/** Which box is the run's current step. */
export function operationNodeForStep(step: string | null | undefined): OperationNodeId | null {
  switch (step) {
    case "intake.validate":
      return "intake";
    case "trend.receive":
    case "trend.quality":
    case "trend.handoff":
    case "trend.brief":
      return "trend";
    case "creative.receive":
    case "creative.generate":
      return "creative";
    case "creative.revise":
      return "revise";
    case "compliance.receive":
    case "compliance.review":
      return "compliance";
    case "founder.gate":
      return "founder";
    case "media.receive":
    case "media.adapt":
      return "media";
    case "media.schedule":
      return "schedule";
    case "feedback.collect":
    case "feedback.summarise":
      return "feedback";
    default:
      return null;
  }
}
