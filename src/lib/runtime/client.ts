"use client";

/**
 * Browser side of the agent bench.
 *
 * The store hands the whole workspace plus one command to the engine route and
 * applies whatever comes back. Because the whole document is round-tripped, the
 * server stays stateless and the founder's workspace remains the single source of
 * truth — the same document the workspace API persists.
 */

import { jsonHeadersWithKey } from "@/lib/media/byo-key";
import type { BrandProfile, Campaign } from "@/lib/types";
import type { WorkspaceSettings } from "@/lib/settings";
import type { WorkflowJob } from "@/lib/workflow/types";
import type { Command, EngineResult } from "./types";

type WorkspaceContext = {
  campaigns: Campaign[];
  brand: BrandProfile;
  settings: WorkspaceSettings;
};

export type EngineResponse = EngineResult & { error?: string };

export async function sendCommand(
  context: WorkspaceContext,
  campaign: Campaign,
  command: Command,
  onProgress?: (detail: string) => void,
): Promise<EngineResponse> {
  try {
    const headers = { ...jsonHeadersWithKey(context.settings.imageModelId), Accept: "text/event-stream" };
    const res = await fetch("/api/engine", {
      method: "POST",
      headers,
      body: JSON.stringify({
        campaign,
        command,
        requestId:crypto.randomUUID(),
        campaigns: context.campaigns,
        brand: context.brand,
        settings: context.settings,
      }),
    });
    if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
      return readEngineStream(res, campaign, onProgress);
    }
    const json = (await res.json()) as EngineResponse & {job?:WorkflowJob};
    if (!res.ok) {
      return {
        ...emptyResult(campaign),
        message: json.error ?? "The engine refused that command.",
        error: json.error ?? "The engine refused that command.",
      };
    }
    if(res.status===202&&json.job){
      let job=json.job;
      // Closing the page stops observation, not the independent worker. A timed
      // out poll never resubmits or automatically retries a paid provider call.
      const until=Date.now()+700000;
      while(['queued','running'].includes(job.status)&&Date.now()<until){
        await new Promise(resolve=>setTimeout(resolve,1000));
        const response=await fetch(`/api/engine/jobs/${encodeURIComponent(job.id)}`,{cache:'no-store'});
        if(!response.ok)throw Error('The saved job could not be read. Open Workflow operations; do not relaunch it.');
        job=await response.json() as WorkflowJob;
      }
      if(job.result)return {...job.result,canAdvance:false,...(job.status==='failed'||job.status==='interrupted'?{error:job.message}:{}),message:job.message};
      throw Error(job.message||'Workflow saved. Check Workflow operations for progress.');
    }
    return json;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Engine route unavailable.";
    return { ...emptyResult(campaign), message, error: message };
  }
}

async function readEngineStream(
  res: Response,
  campaign: Campaign,
  onProgress?: (detail: string) => void,
): Promise<EngineResponse> {
  if (!res.ok || !res.body) {
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    const message = json?.error ?? "The engine refused that command.";
    return { ...emptyResult(campaign), message, error: message };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: EngineResponse | null = null;
  let failed = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = frame.match(/^event: (.+)$/m)?.[1] ?? "message";
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      const payload = JSON.parse(data) as { detail?: string; error?: string };
      if (event === "progress" && payload.detail) onProgress?.(payload.detail);
      if (event === "error") failed = payload.error ?? "The engine failed.";
      if (event === "result") result = payload as EngineResponse;
    }
  }
  if (result) return result;
  const message = failed || "The engine ended without a result.";
  return { ...emptyResult(campaign), message, error: message };
}

function emptyResult(campaign: Campaign): EngineResult {
  return {
    campaign,
    run:
      campaign.run ?? {
        id: "run_unavailable",
        campaignId: campaign.id,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "halted",
        step: "intake.validate",
        stepsTaken: 0,
        maxSteps: 0,
        revisionAttempts: 0,
        toolsUsed: [],
        haltedReason: "Engine route unavailable.",
        awaiting: "failure",
        awaitingDetail: "The bench could not reach the server. Nothing was changed.",
      },
    events: [],
    runSteps: [],
    policyDecisions: [],
    canAdvance: false,
    message: "Engine route unavailable.",
  };
}
