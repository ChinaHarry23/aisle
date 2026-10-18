"use client";

/**
 * Browser side of the agent bench.
 *
 * The store hands the whole workspace plus one command to the engine route and
 * applies whatever comes back. Because the whole document is round-tripped, the
 * server stays stateless and the founder's workspace remains the single source of
 * truth — the same document the workspace API persists.
 */

import { getByoKey } from "@/lib/media/byo-key";
import { getModel } from "@/lib/media/catalog";
import type { BrandProfile, Campaign } from "@/lib/types";
import type { WorkspaceSettings } from "@/lib/settings";
import type { Command, EngineResult } from "./types";

export type WorkspaceContext = {
  campaigns: Campaign[];
  brand: BrandProfile;
  settings: WorkspaceSettings;
};

export type EngineResponse = EngineResult & { error?: string };

export async function sendCommand(
  context: WorkspaceContext,
  campaign: Campaign,
  command: Command,
  maxSteps?: number,
): Promise<EngineResponse> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    try {
      const key = getByoKey(getModel(context.settings.imageModelId).providerId);
      if (key) headers["x-provider-key"] = key;
    } catch {
      // An unknown image model still lets the text agents run.
    }
    const res = await fetch("/api/engine", {
      method: "POST",
      headers,
      body: JSON.stringify({
        campaign,
        command,
        campaigns: context.campaigns,
        brand: context.brand,
        settings: context.settings,
        maxSteps,
      }),
    });
    const json = (await res.json()) as EngineResponse;
    if (!res.ok) {
      return {
        ...emptyResult(campaign),
        message: json.error ?? "The engine refused that command.",
        error: json.error ?? "The engine refused that command.",
      };
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
