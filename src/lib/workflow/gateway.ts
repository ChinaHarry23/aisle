import type { Campaign } from "../types";
import type { WorkflowJob, WorkflowSubmission } from "./types";
import { WorkflowError } from "./commands";
import type { StudioMediaUpdate } from "../media/persistence";

export function workflowEnabled() { return Boolean(process.env.AISLE_WORKFLOW_URL); }

async function request<T>(userId: string, endpoint: string, init: RequestInit = {}): Promise<T> {
  const base = process.env.AISLE_WORKFLOW_URL?.replace(/\/$/, "");
  const secret = process.env.AISLE_WORKFLOW_SECRET;
  if (!base || !secret) throw new WorkflowError("Workflow service is not configured.", 503);
  let response: Response;
  try {
    response = await fetch(`${base}${endpoint}`, {
      ...init, cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}`, "X-Aisle-User": userId, ...init.headers },
    });
  } catch { throw new WorkflowError("Workflow service is unavailable. Your saved progress is retained.", 503); }
  const data = await response.json();
  if (!response.ok) throw new WorkflowError(data.error || "Workflow request failed.", response.status);
  return data as T;
}

export const submitWorkflow = (userId: string, input: WorkflowSubmission, key: string) =>
  request<WorkflowJob>(userId, "/jobs", { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(input) });
export const getWorkflowJob = (userId: string, id: string) => request<WorkflowJob>(userId, `/jobs/${encodeURIComponent(id)}`);
export const retryWorkflowJob = (userId: string, id: string) => request<WorkflowJob>(userId, `/jobs/${encodeURIComponent(id)}/retry`, { method: "POST" });
export const listWorkflowJobs = (userId: string) => request<{ jobs: WorkflowJob[]; worker: { online: boolean; lastSeen: string | null } }>(userId, "/jobs");
export const workflowCampaigns = (userId: string) => request<Campaign[]>(userId, "/campaigns");
export const saveWorkflowMedia = (userId: string, id: string, update: StudioMediaUpdate) =>
  request<Campaign>(userId, `/campaigns/${encodeURIComponent(id)}/media`, { method: "POST", body: JSON.stringify(update) });

export async function mergeWorkflowCampaigns(userId: string, existing: Campaign[]) {
  const managed = await workflowCampaigns(userId);
  const authoritative = new Map(managed.map(c => [c.id, c]));
  return {
    campaigns: [...existing.map(c => authoritative.get(c.id) ?? c), ...managed.filter(c => !existing.some(e => e.id === c.id))],
    workflowCampaignIds: managed.map(c => c.id),
  };
}
