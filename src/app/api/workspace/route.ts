import {withWorkspaceLock,protectResearchSnapshots} from '@/lib/trend/inline-state';
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { loadWorkspace, updateWorkspace, type WorkspaceSnapshot } from "@/lib/auth/workspace";
import { isArchived, retainCampaignLifecycle } from "@/lib/campaign-lifecycle";
import type { Campaign } from "@/lib/types";
import { WorkflowError } from "@/lib/workflow/commands";
import { acceptWorkspaceCampaigns } from "@/lib/workflow/founder-input";
import { workflowEnabled, mergeWorkflowCampaigns, submitWorkflow } from "@/lib/workflow/gateway";

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
  const brand = body.brand as WorkspaceSnapshot["brand"];
  const settings = body.settings as WorkspaceSnapshot["settings"];
  const submitted = body.campaigns;

  // Agent results, approvals and run state come from the stored copy, never the
  // browser; otherwise a client could store "scheduled" plus an approval and
  // then send PUBLISH. The write is a compare-and-set, so it cannot undo an
  // engine result or a poster revision saved while this request was running.
  let trashed: Campaign[] = [];
  let storedCampaigns: Campaign[] = [];
  let saved: boolean;
  try {
    saved = await updateWorkspace(user.id, user.role, async (stored) => {
      const accepted = acceptWorkspaceCampaigns({ brand, settings, campaigns: stored.campaigns }, submitted);
      let campaigns = accepted;
      if (workflowEnabled()) campaigns = (await mergeWorkflowCampaigns(user.id, campaigns)).campaigns;
      else {
        // A stale tab that leaves out a campaign holding stored research must not
        // delete it; deleting goes through retiredCampaignIds.
        const listed = new Set(campaigns.map((c) => c.id));
        campaigns = [...campaigns, ...protectResearchSnapshots([], stored.campaigns).filter((c) => !listed.has(c.id))];
      }
      // The founder's trash and restores win over the durable worker's copy.
      campaigns = retainCampaignLifecycle(accepted, body.retiredCampaignIds ?? [], campaigns);
      const wasTrashed = new Set(stored.campaigns.filter(isArchived).map((c) => c.id));
      trashed = accepted.filter((c) => isArchived(c) && !wasTrashed.has(c.id));
      storedCampaigns = stored.campaigns;
      return { brand, campaigns, settings, retiredCampaignIds: body.retiredCampaignIds };
    });
  } catch (error) {
    const message = workflowEnabled() && error instanceof WorkflowError
      ? "Workflow unavailable. Save refused to protect durable progress."
      : "Storage unavailable. Nothing was saved.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
  if (!saved) return NextResponse.json({ error: "The workspace kept changing. Nothing was saved; try again." }, { status: 409 });

  // A durable job never sees the workspace trash, so a campaign trashed while
  // queued or running is asked to pause at its next step. A campaign with no
  // job refuses the pause, which is fine.
  if (workflowEnabled()) {
    await Promise.all(trashed.map((campaign) =>
      submitWorkflow(user.id, { campaign, campaigns: storedCampaigns, brand, settings, command: { type: "PAUSE", actor: "founder" } }, `trash:${campaign.archivedAt}:${campaign.id}`.slice(0, 150))
        .catch(() => undefined),
    ));
  }
  return NextResponse.json({ ok: true });
}
