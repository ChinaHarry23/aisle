"use client";

/**
 * Browser side of the agent bench.
 *
 * Sends the target campaign and command. The server loads authoritative workspace
 * context; unrelated campaigns, brand and settings need not be uploaded.
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
): Promise<EngineResponse> {
  try {
    const headers = jsonHeadersWithKey(context.settings.imageModelId);
    const res = await fetch("/api/engine", {
      method: "POST",
      headers,
      body: JSON.stringify({
        campaign,
        command,
        requestId:crypto.randomUUID(),
      }),
    });
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
        // The worker checkpoints the decision before running expensive follow-up
        // stages. Acknowledge it now; the independent worker owns continuation.
        if (job.status === 'running' && job.result &&
            ['APPROVE', 'REQUEST_CHANGES', 'REJECT'].includes(command.type)) {
          return { ...job.result, canAdvance: false, message: job.message };
        }
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
