import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { demoWorkspace, loadWorkspace, type WorkspaceSnapshot } from "@/lib/auth/workspace";
import { runEngine } from "@/lib/runtime/engine";
import { withRuntimeDefaults } from "@/lib/runtime/defaults";
import type { Command } from "@/lib/runtime/types";
import type { Campaign } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read the stored workspace without letting storage take the bench down.
 *
 * The client already sends its own workspace with every command, so the stored
 * document is only a fallback for brand rules and model settings. If the store is
 * unreachable — a revoked blob token, a cold deployment — running the pipeline
 * with the client's copy is strictly better than failing the request, because the
 * alternative is a campaign that cannot advance at all.
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
  settings?: unknown;
  maxSteps?: number;
};

/**
 * One transition of the agent bench.
 *
 * The client holds the workspace document; this route runs the engine on the
 * server, where the LLM keys, the outbound HTTP tools and the deterministic
 * adapters live, and hands back the updated campaign plus the lines the command
 * produced. Keeping the engine here (rather than in the browser) is what lets a
 * run continue while the tab is closed and lets the same code be tested directly.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.campaign || !body.command) {
    return NextResponse.json({ error: "campaign and command are required." }, { status: 400 });
  }

  const stored = await loadWorkspaceSafely(user.id, user.role);
  const brand = (body.brand as typeof stored.brand) ?? stored.brand;
  const settings = (body.settings as typeof stored.settings) ?? stored.settings;
  const campaigns = (body.campaigns ?? []).map(withRuntimeDefaults);
  const target = withRuntimeDefaults(body.campaign);

  try {
    const result = await runEngine(
      { campaigns, now: new Date().toISOString() },
      target,
      body.command,
      settings,
      brand,
      { maxSteps: body.maxSteps },
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
