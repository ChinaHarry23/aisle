import { NextResponse } from "next/server";
import { countUsers, ensureSeedAccounts, listUsers } from "@/lib/auth/users";
import { getDatabase, isDatabaseUnavailable } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Storage health.
 *
 * Exists so "why can't I sign up" is a request away from an answer instead of a
 * guess. It reports which backend is configured, whether it answered, and how many
 * accounts exist — the three facts needed to tell a missing database apart from a
 * bad password.
 *
 * It also runs the seed, so the team desks exist as soon as the database is
 * reachable rather than only once somebody has tried to sign in.
 */
export async function GET() {
  try {
    const db = await getDatabase();
    const seeded = await ensureSeedAccounts();
    const users = await countUsers();
    return NextResponse.json({
      ok: true,
      database: { kind: db.kind, label: db.label },
      accounts: users,
      seededAccounts: seeded.seeded || users >= 5,
    });
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      console.error(`[health] ${error.message}`);
      return NextResponse.json(
        {
          ok: false,
          code: "storage_unavailable",
          error:
            "No database is configured. In development the app creates a SQLite file automatically; in production set DATABASE_URL.",
          detail: error.reason,
        },
        { status: 503 },
      );
    }
    const message = error instanceof Error ? error.message : "Storage check failed.";
    console.error(`[health] ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** The roster, without hashes, for the team's own sign-in check. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { reveal?: boolean } | null;
  if (!body?.reveal) {
    return NextResponse.json({ error: "Send { reveal: true }." }, { status: 400 });
  }
  try {
    return NextResponse.json({ users: await listUsers() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Storage check failed.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
