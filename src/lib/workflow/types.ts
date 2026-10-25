import type { SavedInsight } from "../insights";
import type { BrandProfile, Campaign } from "../types";
import type { WorkspaceSettings } from "../settings";
import type { Command, EngineResult } from "../runtime/types";

type JobStatus = "queued" | "running" | "completed" | "failed" | "interrupted";
export type WorkflowJob = {
  id: string;
  campaignId: string;
  command: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  message: string;
  result: EngineResult | null;
};
export type WorkflowSubmission = {
  campaign: Campaign;
  campaigns: Campaign[];
  brand: BrandProfile;
  settings: WorkspaceSettings;
  command: Command;
  /** Library the founder picks from. Absent means this brief carries no insight. */
  savedInsights?: SavedInsight[];
};
