import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { whichGrocerApiKey } from "@/lib/retail/whichgrocer/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether this server can read WhichGrocer. The key itself is never returned. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ configured: false });
  return NextResponse.json({ configured: Boolean(whichGrocerApiKey()) });
}
