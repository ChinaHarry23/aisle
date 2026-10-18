import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { loadWorkspace } from "@/lib/auth/workspace";
import { mediaResponse } from "@/lib/media/assets";
import { readAsset, removeAsset } from "@/lib/media/library";
import { MediaNotFoundError, readMedia } from "@/lib/media/store";
import { mergeWorkflowCampaigns, workflowEnabled } from "@/lib/workflow/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function campaignsFor(userId: string, role: Parameters<typeof loadWorkspace>[1]) {
  const workspace = await loadWorkspace(userId, role);
  if (!workflowEnabled()) return workspace.campaigns;
  return (await mergeWorkflowCampaigns(userId, workspace.campaigns)).campaigns;
}

/** The file itself. The id is this account's catalogue row, not a campaign creative. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await context.params;
  try {
    const asset = await readAsset(user.id, id);
    if (!asset) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const { bytes, mime } = await readMedia(asset.mediaUrl, asset.kind, user.id);
    return mediaResponse(bytes, mime, request.headers.get("range"));
  } catch (error) {
    if (error instanceof MediaNotFoundError) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ error: "The image could not be opened." }, { status: 503 });
  }
}

/** Hide the take from this account. The file stays if a campaign still shows it. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await context.params;
  try {
    const campaigns = await campaignsFor(user.id, user.role);
    const removed = await removeAsset(user.id, id, campaigns);
    if (!removed) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The image could not be removed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
