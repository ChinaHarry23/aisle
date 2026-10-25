import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { demoWorkspace, loadWorkspace, updateWorkspace, type WorkspaceSnapshot } from "@/lib/auth/workspace";
import { renderCampaignPoster } from "@/lib/media/campaign-poster";
import { lookupShelfPrices } from "@/lib/retail/whichgrocer/connection";
import { runEngine } from "@/lib/runtime/engine";
import { setShelfPriceLookup } from "@/lib/runtime/tools";
import { GraphRequestError, invokeOperationGraph, reachableOperationGraph } from "@/lib/studio/remote";

setShelfPriceLookup(lookupShelfPrices);
import { isArchived } from "@/lib/campaign-lifecycle";
import { withRuntimeDefaults } from "@/lib/runtime/defaults";
import type { Command } from "@/lib/runtime/types";
import type { Campaign } from "@/lib/types";
import { workflowEnabled, submitWorkflow } from "@/lib/workflow/gateway";
import { parseCommand, WorkflowError } from "@/lib/workflow/commands";
import { createServerTrendRuntime } from "@/lib/agents/trend-server";
import { billingForSession } from "@/lib/billing/meter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One request runs one agent step. A poster pass is two cloud renders, up to
 * about 240 s each. Chaining that with compliance and a revision used to exceed
 * maxDuration, the response never arrived, and the image step was lost. The
 * browser asks for the next step.
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
async function loadWorkspaceStrict(
  userId: string,
  role: Parameters<typeof loadWorkspace>[1],
): Promise<{ snapshot: WorkspaceSnapshot; readable: boolean }> {
  try {
    return { snapshot: await loadWorkspace(userId, role), readable: true };
  } catch {
    return { snapshot: demoWorkspace(), readable: false };
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
      const kept = stored.campaigns.find((item) => item.id === body.campaign!.id);
      if (isArchived(kept ?? {}) || isArchived(body.campaign)) {
        return NextResponse.json({ error: "This campaign is in the trash. Restore it before the agents can continue." }, { status: 409 });
      }
      const job = await submitWorkflow(user.id, {
        campaign: body.campaign, command, campaigns: stored.campaigns,
        brand: stored.brand, settings: stored.settings,
      }, body.requestId || "");
      return NextResponse.json({ job }, { status: 202 });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Workflow unavailable." }, { status: error instanceof WorkflowError ? error.status : 503 });
    }
  }

  const loaded = await loadWorkspaceStrict(user.id, user.role);
  const stored = loaded.snapshot;
  const brand = (body.brand as typeof stored.brand) ?? stored.brand;
  const settings = stored.settings;
  const campaigns = (body.campaigns ?? []).map(withRuntimeDefaults);
  const target = withRuntimeDefaults(body.campaign);
  const storedCampaign = stored.campaigns.find((item) => item.id === target.id);
  if (isArchived(storedCampaign ?? {}) || isArchived(target)) {
    const campaign = { ...(storedCampaign ?? target), archivedAt: storedCampaign?.archivedAt ?? target.archivedAt, running: false };
    return NextResponse.json({
      campaign,
      run: campaign.run,
      events: [],
      runSteps: [],
      policyDecisions: campaign.policyDecisions ?? [],
      canAdvance: false,
      message: "This campaign is in the trash. Restore it before the agents can continue.",
    });
  }

  const maxSteps =
    typeof body.maxSteps === "number" && Number.isFinite(body.maxSteps)
      ? Math.min(Math.max(0, Math.floor(body.maxSteps)), MAX_STEPS_PER_REQUEST)
      : 1;
  const userKey = request.headers.get("x-provider-key")?.trim() || undefined;

  try {
    const billing = await billingForSession(user);
    const graphUrl = loaded.readable ? await reachableOperationGraph() : null;
    if (graphUrl) {
      let savedInput = false;
      try {
        // A compare-and-set on the latest copy, so this cannot undo another save.
        savedInput = await updateWorkspace(user.id, user.role, (latest) => ({
          ...latest,
          brand,
          campaigns: [target, ...latest.campaigns.filter((item) => item.id !== target.id)],
        }));
      } catch {
        // The graph hydrates from the workspace. If that write fails, run here instead.
      }
      if (savedInput) {
        const outcome = await invokeOperationGraph({
          url: graphUrl,
          campaignId: target.id,
          userId: user.id,
          maxSteps,
          command: body.command,
        });
        const latest = await loadWorkspace(user.id, user.role);
        const saved = latest.campaigns.find((item) => item.id === target.id);
        const run = saved?.run;
        if (!saved || !run) {
          throw new GraphRequestError("The operation graph did not return a run.", false);
        }
        const campaign = withRuntimeDefaults(saved);
        return NextResponse.json({
          campaign,
          run,
          events: [],
          runSteps: [],
          policyDecisions: campaign.policyDecisions,
          canAdvance: outcome.canAdvance,
          message: outcome.message,
        });
      }
    }
    const llm = createServerTrendRuntime(billing);
    const result = await runEngine(
      { campaigns, now: new Date().toISOString() },
      target,
      body.command,
      settings,
      brand,
      {
        maxSteps,
        ownerUserId: user.id,
        billing,
        llm,
        renderPoster: (input) =>
          renderCampaignPoster({
            campaign: input.campaign,
            creative: input.creative,
            modelId: input.modelId,
            ownerId: user.id,
            userKey,
          }),
      },
    );
    try {
      // A compare-and-set on the latest copy, so a concurrent save cannot undo this result.
      const saved = await updateWorkspace(user.id, user.role, (latest) => ({
        ...latest,
        campaigns: [result.campaign, ...latest.campaigns.filter((item) => item.id !== result.campaign.id)],
      }));
      if (!saved) throw new Error("the workspace kept changing");
    } catch (error) {
      // PUT /api/workspace keeps agent results from the stored copy, so the browser
      // cannot save this result for us. Reporting it as done would leave the browser
      // ahead of the server; say it failed and leave the campaign as it was.
      console.error("[engine] result could not be saved", error instanceof Error ? error.message : error);
      return NextResponse.json({ error: "The result could not be saved. Nothing changed; try again." }, { status: 503 });
    }
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
