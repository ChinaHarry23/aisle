import { getCurrentUser } from "@/lib/auth/current";
import { loadWorkspace } from "@/lib/auth/workspace";
import { mergeWorkflowCampaigns, workflowEnabled } from "@/lib/workflow/gateway";
import { campaignRenderProgress } from "@/lib/media/progress";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ campaignId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { campaignId } = await context.params;
    const workspace = await loadWorkspace(user.id, user.role);
    const campaigns = workflowEnabled() ? (await mergeWorkflowCampaigns(user.id, workspace.campaigns)).campaigns : workspace.campaigns;
    const campaign = campaigns.find(c => c.id === campaignId);
    if (!campaign) return Response.json({ error: "Campaign not found." }, { status: 404 });
    const progress = await campaignRenderProgress(user.id, campaign);
    return Response.json({ ...progress, ...(progress.jobs.some(job => job.sequence && job.stage === "complete") ? { campaign } : {}) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Progress connection unavailable. The render may still be running; do not restart it." }, { status: 503 });
  }
}
