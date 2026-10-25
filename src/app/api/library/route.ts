import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { indexAccountAssets, listAssets, type LibraryAsset } from "@/lib/media/library";
import { accountCampaigns } from "@/lib/workflow/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function published(asset: LibraryAsset) {
  return {
    id: asset.id,
    kind: asset.kind,
    mime: asset.mime,
    campaignId: asset.campaignId,
    campaignName: asset.campaignName,
    product: asset.product,
    label: asset.label,
    prompt: asset.prompt,
    modelName: asset.modelName,
    createdAt: asset.createdAt,
    costUsd: asset.costUsd,
    costEstimated: asset.costEstimated,
    inputTokens: asset.inputTokens,
    outputTokens: asset.outputTokens,
    review: asset.review,
    reasons: asset.reasons,
  };
}

/** Every generated image and video kept for this account. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const campaigns = await accountCampaigns(user.id, user.role);
    await indexAccountAssets(user.id, campaigns);
    const assets = await listAssets(user.id, campaigns);
    return NextResponse.json({ assets: assets.map(published) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The library could not be read.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
