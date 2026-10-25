import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { billingSummary } from "@/lib/billing/summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Plan, balance, subscription and recent usage. `?brief=1` skips the ledger (the header badge). */
export async function GET(request: Request) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const brief = new URL(request.url).searchParams.get("brief") === "1";
    return NextResponse.json(
      await billingSummary({ id: session.id, role: session.role, email: session.email }, { ledger: !brief }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Billing is unavailable.";
    console.error(`[billing] ${message}`);
    return NextResponse.json({ error: "Billing is unavailable right now." }, { status: 503 });
  }
}
