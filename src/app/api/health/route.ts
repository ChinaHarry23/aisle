import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { SEED_ACCOUNTS } from "@/lib/auth/seed-accounts";
import { countUsers, ensureSeedAccounts, listUsers } from "@/lib/auth/users";
import { isHosted } from "@/lib/billing/hosted";
import { billingFor, isUnlimited } from "@/lib/billing/meter";
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
 * The route is public, so on a hosted install an anonymous caller only learns
 * whether storage answered. The database host or file, the account count and
 * error details are shown locally, or to a signed-in unlimited team desk.
 *
 * It also runs the seed, so the team desks exist as soon as the database is
 * reachable rather than only once somebody has tried to sign in.
 */
async function showDetails() {
  if (!isHosted()) return true;
  const viewer = await getCurrentUser().catch(() => null);
  return Boolean(viewer && isUnlimited(billingFor(viewer)));
}

export async function GET() {
  try {
    const db = await getDatabase();
    const seeded = await ensureSeedAccounts();
    if (!(await showDetails())) return NextResponse.json({ ok: true, database: { kind: db.kind } });
    const users = await countUsers();
    return NextResponse.json({
      ok: true,
      database: { kind: db.kind, label: db.label },
      accounts: users,
      seededAccounts: seeded.seeded || users >= SEED_ACCOUNTS.length,
    });
  } catch (error) {
    const details = !isHosted();
    if (isDatabaseUnavailable(error)) {
      console.error(`[health] ${error.message}`);
      return NextResponse.json(
        {
          ok: false,
          code: "storage_unavailable",
          error:
            "No database is configured. In development the app creates a SQLite file automatically; in production set DATABASE_URL.",
          ...(details ? { detail: error.reason } : {}),
        },
        { status: 503 },
      );
    }
    const message = error instanceof Error ? error.message : "Storage check failed.";
    console.error(`[health] ${message}`);
    return NextResponse.json({ ok: false, error: details ? message : "Storage check failed." }, { status: 500 });
  }
}

/**
 * The roster, without hashes, for the team's own sign-in check. Only a team
 * desk that is unlimited here (any desk locally; on a hosted install only the
 * ones in AISLE_UNLIMITED_USERS) may read it.
 */
export async function POST(request: Request) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { reveal?: boolean } | null;
  if (!body?.reveal) {
    return NextResponse.json({ error: "Send { reveal: true }." }, { status: 400 });
  }
  try {
    if (!isUnlimited(billingFor(session))) {
      return NextResponse.json({ error: "Only the team's desks can list accounts." }, { status: 403 });
    }
    return NextResponse.json({ users: await listUsers() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Storage check failed.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
