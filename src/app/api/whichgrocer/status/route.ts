import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { connectionStatus } from "@/lib/retail/whichgrocer/connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ connected: false, updatedAt: null });
  const status = await connectionStatus(user.id);
  return NextResponse.json(status);
}
