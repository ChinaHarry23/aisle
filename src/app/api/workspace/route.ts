import {withWorkspaceLock,protectResearchSnapshots} from '@/lib/trend/inline-state';
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { loadWorkspace, saveWorkspace, type WorkspaceSnapshot } from "@/lib/auth/workspace";
import { retainCampaignLifecycle } from "@/lib/campaign-lifecycle";
import { workflowEnabled, mergeWorkflowCampaigns } from "@/lib/workflow/gateway";
import type { Campaign } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const workspace = await loadWorkspace(user.id, user.role);
  if (workflowEnabled()) {
    try {
      const merged = await mergeWorkflowCampaigns(user.id, workspace.campaigns);
      const campaigns = retainCampaignLifecycle(workspace.campaigns, workspace.retiredCampaignIds ?? [], merged.campaigns);
      return NextResponse.json({ ...workspace, campaigns, workflowCampaignIds: merged.workflowCampaignIds, workflow: true });
    }
    catch { return NextResponse.json({ error: "Workflow unavailable. Saved campaigns were not overwritten." }, { status: 503 }); }
  }
  return NextResponse.json(workspace);
}

export async function PUT(request:Request){
 const owner=await getCurrentUser();if(!owner)return NextResponse.json({error:'Sign in first.'},{status:401});
 return withWorkspaceLock(owner.id,()=>handlePut(request));
}
async function handlePut(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Partial<WorkspaceSnapshot> | null;
  if (!body) return NextResponse.json({ error: "Missing workspace." }, { status: 400 });
  if (!Array.isArray(body.campaigns) || !body.brand || !body.settings) return NextResponse.json({ error: "Brand, campaigns and settings are required." }, { status: 400 });
  let campaigns = body.campaigns as Campaign[];
  if (workflowEnabled()) {
    try { campaigns = (await mergeWorkflowCampaigns(user.id, campaigns)).campaigns; }
    catch { return NextResponse.json({ error: "Workflow unavailable. Save refused to protect durable progress." }, { status: 503 }); }
  }
  if (!workflowEnabled()) {
    const stored = await loadWorkspace(user.id, user.role);
    campaigns = protectResearchSnapshots(campaigns, stored.campaigns);
  }
  campaigns = retainCampaignLifecycle(body.campaigns as Campaign[], body.retiredCampaignIds ?? [], campaigns);
  await saveWorkspace(user.id, {
    brand: body.brand as WorkspaceSnapshot["brand"],
    campaigns,
    settings: body.settings as WorkspaceSnapshot["settings"],
    retiredCampaignIds: body.retiredCampaignIds,
  });
  return NextResponse.json({ ok: true });
}
