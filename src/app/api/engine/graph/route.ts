import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { operationMermaid, tracingStatus } from "@/lib/runtime/operation-graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The compiled campaign graph, for the run desk and for anyone diffing the topology. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const mermaid = await operationMermaid();
  return NextResponse.json({ mermaid, tracing: tracingStatus() });
}
