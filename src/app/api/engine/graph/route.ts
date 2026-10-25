import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { operationMermaid, tracingStatus } from "@/lib/runtime/operation-graph";
import { reachableOperationGraph, studioHref, studioHrefForCampaign } from "@/lib/studio/remote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The compiled campaign graph, for the run desk and for anyone diffing the topology. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const mermaid = await operationMermaid();
  const campaignId = new URL(request.url).searchParams.get("campaign")?.trim() || "";
  const baseUrl = await reachableOperationGraph();
  const studio = baseUrl
    ? { href: campaignId ? await studioHrefForCampaign(baseUrl, campaignId, user.id) : studioHref(baseUrl) }
    : null;
  return NextResponse.json({ mermaid, tracing: tracingStatus(), studio });
}
