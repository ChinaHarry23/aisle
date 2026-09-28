"use client";

/**
 * Browser side of the agent bench.
 *
 * The store hands the whole workspace plus one command to the engine route and
 * applies whatever comes back. Because the whole document is round-tripped, the
 * server stays stateless and the founder's workspace remains the single source of
 * truth — the same document the workspace API persists.
 */

import type { BrandProfile, Campaign } from "@/lib/types";
import type { WorkspaceSettings } from "@/lib/settings";
import type { Command, EngineResult, GuardedAction } from "./types";

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
    const res = await fetch("/api/engine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

export type GuardCheck = {
  verdict: "allow" | "allow_with_note" | "block";
  rule: string;
  clause: string;
  reason: string;
  remedy?: string;
};

/** Ask the policy layer what would happen — used by the boundary check panel. */
export async function checkGuard(
  campaign: Campaign,
  action: GuardedAction,
  target: string,
  amountUsd?: number,
): Promise<GuardCheck | null> {
  try {
    const res = await fetch("/api/engine/guard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaign, action, target, amountUsd, actor: "media" }),
    });
    if (!res.ok) return null;
    return (await res.json()) as GuardCheck;
  } catch {
    return null;
  }
}
