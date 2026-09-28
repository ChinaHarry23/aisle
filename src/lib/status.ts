import type { AgentId, CampaignStatus, Channel, RiskLevel } from "./types";

export const statusLabel: Record<CampaignStatus, string> = {
  draft: "Draft",
  analysing: "Trend analysis",
  generating: "Creative generation",
  compliance: "Compliance review",
  revising: "Revision loop",
  awaiting_approval: "Awaiting founder",
  rejected: "Rejected",
  scheduling: "Scheduling",
  scheduled: "Scheduled",
  published: "Published",
  paused: "Paused",
};

export const statusTone: Record<CampaignStatus, string> = {
  draft: "status-chip status-draft",
  analysing: "status-chip status-run",
  generating: "status-chip status-run",
  compliance: "status-chip status-run",
  revising: "status-chip status-run",
  awaiting_approval: "status-chip status-wait",
  rejected: "status-chip status-live",
  scheduling: "status-chip status-run",
  scheduled: "status-chip status-run",
  published: "status-chip status-live",
  paused: "status-chip status-soft",
};

export const agentLabel: Record<AgentId, string> = {
  founder: "Human Founder",
  trend: "AI Trend Analyser",
  creative: "AI Image Generation",
  compliance: "AI Compliance Checker",
  media: "AI Media Manager",
  intake: "Inbound intake",
};

export const agentRole: Record<AgentId, string> = {
  founder: "Operator",
  trend: "Market researcher",
  creative: "Creative studio",
  compliance: "Legal & brand risk",
  media: "Distribution",
  intake: "WhatsApp and inbound briefs",
};

export const channelLabel: Record<Channel, string> = {
  instagram: "Instagram",
  web: "Website",
  email: "Email",
  print: "Print catalogue",
  digital_signage: "In-store signage",
};

export const riskLabel: Record<RiskLevel, string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
};

export const pipelineOrder: CampaignStatus[] = [
  "draft",
  "analysing",
  "generating",
  "compliance",
  "awaiting_approval",
  "scheduled",
  "published",
];

export function pipelineIndex(status: CampaignStatus): number {
  if (status === "revising") return 3;
  if (status === "scheduling") return 5;
  if (status === "paused") return 0;
  if (status === "rejected") return 4;
  const i = pipelineOrder.indexOf(status);
  return i === -1 ? 0 : i;
}
