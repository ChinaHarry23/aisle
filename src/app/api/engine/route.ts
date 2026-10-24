import {withWorkspaceLock,requestInlinePause,resumeInlineResearch,inlineResearchAllowed} from '@/lib/trend/inline-state';
import {recordStoredTrend} from '@/lib/trend/quality';
import {retailUploadSchema} from '@/lib/trend/internal-retail';
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { demoWorkspace, loadWorkspace, saveWorkspace, type WorkspaceSnapshot } from "@/lib/auth/workspace";
import { renderCampaignPoster } from "@/lib/media/campaign-poster";
import { lookupShelfPrices } from "@/lib/retail/whichgrocer/connection";
import { runEngine } from "@/lib/runtime/engine";
import { setShelfPriceLookup } from "@/lib/runtime/tools";

setShelfPriceLookup(lookupShelfPrices);
import { withRuntimeDefaults } from "@/lib/runtime/defaults";
import type { Command } from "@/lib/runtime/types";
import type { Campaign } from "@/lib/types";
import { workflowEnabled, submitWorkflow } from "@/lib/workflow/gateway";
import { parseCommand, WorkflowError } from "@/lib/workflow/commands";
import { createServerResearchRuntime } from "@/lib/agents/trend-server";
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
export async function POST(request:Request){
 const owner=await getCurrentUser();if(!owner)return NextResponse.json({error:'Sign in first.'},{status:401});
 const preview=await request.clone().json().catch(()=>null);
 if(['PAUSE','CANCEL_TREND'].includes(preview?.command?.type)&&typeof preview?.campaign?.id==='string')requestInlinePause(owner.id,preview.campaign.id);
 return withWorkspaceLock(owner.id,()=>handlePost(request));
}
async function handlePost(request: Request) {
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
  const brand = stored.brand;
  const settings = stored.settings;
  // Prior advice and neighbouring campaigns come from platform storage, never
  // a browser-supplied acceptance/report record.
  const campaigns = stored.campaigns.map(withRuntimeDefaults);
  const existing=stored.campaigns.find(c=>c.id===body.campaign!.id);
  const protectedResearch=existing?.trendQuality||existing?.researchMode==='agent';
  const target = withRuntimeDefaults(existing&&existing.status!=='draft'?structuredClone(existing):body.campaign);
  let command:Command;
  try{
    command=parseCommand(body.command);
    if(!existing&&command.type!=='START')throw new WorkflowError('Start and store the campaign before submitting workflow or feedback decisions.',409);
    if(protectedResearch&&(command.type==='RESOLVE_TREND'||command.type==='CANCEL_TREND'||command.type==='START')){
      if(command.type==='RESOLVE_TREND'&&command.action==='provide_data'&&body.campaign.internalDataAuthorised&&body.campaign.retailUpload){
        target.retailUpload=retailUploadSchema.parse(body.campaign.retailUpload);target.internalDataAuthorised=true;
      }
    }
    if(!existing&&body.campaign.trendQuality)throw new WorkflowError('No stored research version exists for this campaign.',409);
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Invalid command.'},{status:409});}

  const maxSteps =
    typeof body.maxSteps === "number" && Number.isFinite(body.maxSteps)
      ? Math.min(Math.max(0, Math.floor(body.maxSteps)), MAX_STEPS_PER_REQUEST)
      : 1;
  const userKey = request.headers.get("x-provider-key")?.trim() || undefined;

  try {
    if(command.type==='START'||command.type==='RESOLVE_TREND')resumeInlineResearch(user.id,target.id);
    const llm = createServerResearchRuntime(await billingForSession(user));
    const result = await runEngine(
      { campaigns, now: new Date().toISOString() },
      target,
      command,
      settings,
      brand,
      {
        maxSteps,
        ownerUserId: user.id,
        researchAllowed: () => !request.signal.aborted && inlineResearchAllowed(user.id,target.id),
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
      recordStoredTrend(result.campaign);
      const latest = await loadWorkspace(user.id, user.role);
      const rest = latest.campaigns.filter((item) => item.id !== result.campaign.id);
      await saveWorkspace(user.id, { ...latest, campaigns: [result.campaign, ...rest] });
    } catch {
      if(result.campaign.trendQuality){
        result.campaign.trendQuality.storedVersion=null;
        result.campaign.status='paused';result.campaign.running=false;result.run.status='paused';
        result.run.haltedReason='Research storage failed; current work retained. Retry storage before handoff.';
        result.canAdvance=false;result.message=result.run.haltedReason;
      }
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
