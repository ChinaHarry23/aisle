import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { demoWorkspace, loadWorkspace, type WorkspaceSnapshot } from "@/lib/auth/workspace";
import { lookupShelfPrices } from "@/lib/retail/whichgrocer/connection";
import { runEngine } from "@/lib/runtime/engine";
import { setShelfPriceLookup } from "@/lib/runtime/tools";

setShelfPriceLookup(lookupShelfPrices);
import { withRuntimeDefaults } from "@/lib/runtime/defaults";
import type { Command } from "@/lib/runtime/types";
import type { Campaign } from "@/lib/types";
import { workflowEnabled, submitWorkflow } from "@/lib/workflow/gateway";
import { parseCommand, WorkflowError } from "@/lib/workflow/commands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One ADVANCE chains up to 12 steps. The slowest single step is a poster pass
 * (two cloud renders at up to 240 s each, ~480 s); a decision is at most 120 s.
 * No new step starts after STEP_BUDGET_S, so the last one still finishes (and
 * settles its credit hold) inside maxDuration. The client advances again.
 */
export const maxDuration = 800;
const MAX_STEPS_PER_REQUEST = 12;

/**
 * Read the stored workspace without letting storage take the bench down.
 *
 * The client already sends its own workspace with every command, so the stored
 * document is only a fallback for brand rules. Model settings always come from
 * the store: they decide which paid provider runs on the owner's keys. If the
 * store is unreachable — a revoked blob token, a cold deployment — the demo
 * workspace (all local) stands in, because the alternative is a campaign that
 * cannot advance at all.
 */
async function loadWorkspaceSafely(
  userId: string,
  role: Parameters<typeof loadWorkspace>[1],
): Promise<WorkspaceSnapshot> {
  try {
    return await loadWorkspace(userId, role);
  } catch {
    return demoWorkspace();
  }
}

type Body = {
  campaign?: Campaign;
  command?: Command;
  /** Workspace context so the engine can check brand rules and other campaigns. */
  campaigns?: Campaign[];
  brand?: unknown;
  /** Ignored: settings pick paid models, so only the stored copy is trusted. */
  settings?: unknown;
  maxSteps?: number;
  requestId?: string;
};

/**
 * One transition of the agent bench.
 *
 * The client holds the workspace document; this route runs the engine on the
 * server, where the LLM keys, the outbound HTTP tools and the deterministic
 * adapters live, and hands back the updated campaign plus the lines the command
 * produced. Inline mode still depends on browser ADVANCE requests. Service mode
 * submits durable jobs to the independent worker, which survives closing the tab.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.campaign || !body.command) {
    return NextResponse.json({ error: "campaign and command are required." }, { status: 400 });
  }

  if (workflowEnabled()) {
    try {
      // Authentication owns the tenant; browser approvals and runtime output are not trusted.
      const command = parseCommand(body.command);
      const stored = await loadWorkspace(user.id, user.role);
      const job = await submitWorkflow(user.id, {
        campaign: body.campaign, command, campaigns: stored.campaigns,
        brand: stored.brand, settings: stored.settings,
      }, body.requestId || "");
      return NextResponse.json({ job }, { status: 202 });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Workflow unavailable." }, { status: error instanceof WorkflowError ? error.status : 503 });
    }
  }

  const stored = await loadWorkspaceSafely(user.id, user.role);
  const brand = (body.brand as typeof stored.brand) ?? stored.brand;
  const settings = stored.settings;
  const campaigns = (body.campaigns ?? []).map(withRuntimeDefaults);
  const target = withRuntimeDefaults(body.campaign);

  const maxSteps =
    typeof body.maxSteps === "number" && Number.isFinite(body.maxSteps)
      ? Math.min(Math.max(0, Math.floor(body.maxSteps)), MAX_STEPS_PER_REQUEST)
      : undefined;

  try {
    const result = await runEngine(
      { campaigns, now: new Date().toISOString() },
      target,
      body.command,
      settings,
      brand,
      { maxSteps, ownerUserId: user.id },
    );
    return NextResponse.json({
      campaign: result.campaign,
      run: result.run,
      events: result.events,
      runSteps: result.runSteps,
      policyDecisions: result.policyDecisions,
      canAdvance: result.canAdvance,
      message: result.message,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The engine failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
