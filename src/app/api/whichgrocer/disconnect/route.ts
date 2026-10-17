import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { deleteConnection } from "@/lib/retail/whichgrocer/connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  await deleteConnection(user.id);
  return NextResponse.json({ connected: false });
}
