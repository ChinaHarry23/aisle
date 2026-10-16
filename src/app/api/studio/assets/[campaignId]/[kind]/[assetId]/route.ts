import { getCurrentUser } from "@/lib/auth/current";
import { loadWorkspace } from "@/lib/auth/workspace";
import { workflowEnabled, mergeWorkflowCampaigns } from "@/lib/workflow/gateway";
import { mediaResponse } from "@/lib/media/assets";
import { MediaNotFoundError, readMedia } from "@/lib/media/store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ campaignId: string; kind: string; assetId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { campaignId, kind, assetId } = await context.params;
  if (kind !== "image" && kind !== "video") return Response.json({ error: "Not found." }, { status: 404 });
  try {
    const workspace = await loadWorkspace(user.id, user.role);
    const campaigns = workflowEnabled() ? (await mergeWorkflowCampaigns(user.id, workspace.campaigns)).campaigns : workspace.campaigns;
    const campaign = campaigns.find(c => c.id === campaignId);
    const asset = kind === "image" ? campaign?.creatives.find(c => c.id === assetId) : campaign?.videos.find(v => v.id === assetId);
    if (!asset?.generation?.url || asset.generation.status !== "ok") return Response.json({ error: "Media not found." }, { status: 404 });
    // Stored cloud media is checked against this user as well as the campaign lookup.
    const { bytes, mime } = await readMedia(asset.generation.url, kind, user.id);
    return mediaResponse(bytes, mime, request.headers.get("range"));
  } catch (error) {
    if (error instanceof MediaNotFoundError) return Response.json({ error: "Media not found." }, { status: 404 });
    return Response.json({ error: "Media is temporarily unavailable; the saved campaign has not been changed." }, { status: 503 });
  }
}
