import { NextResponse } from "next/server";
import { createUser } from "@/lib/auth/users";
import { normalizeEmail, validEmail, validPassword } from "@/lib/auth/password";
import { sessionCookieOptions, signSession, SESSION_COOKIE } from "@/lib/auth/session";
import { describeStorageFailure } from "@/lib/auth/storage-errors";
import { claimSignupSlot, SIGNUPS_PER_IP_HOUR } from "@/lib/billing/ledger";

export const runtime = "nodejs";

/**
 * The caller's address, from headers only a trusted proxy can set. On Vercel
 * the edge overwrites x-vercel-forwarded-for / x-real-ip / x-forwarded-for, so
 * they are the client's. Anywhere else a client can send any of them, so none
 * is trusted unless the owner names the header their own proxy sets
 * (AISLE_CLIENT_IP_HEADER, e.g. x-real-ip behind nginx); without it every
 * signup shares one bucket.
 */
function clientIp(request: Request): string {
  const h = request.headers;
  const first = (value: string | null) => value?.split(",")[0]?.trim() || "";
  if (process.env.VERCEL === "1") {
    return first(h.get("x-vercel-forwarded-for")) || first(h.get("x-real-ip")) || first(h.get("x-forwarded-for")) || "unknown";
  }
  const trusted = process.env.AISLE_CLIENT_IP_HEADER?.trim().toLowerCase();
  return (trusted && first(h.get(trusted))) || "unknown";
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { name?: string; email?: string; password?: string }
    | null;
  const name = (body?.name ?? "").trim();
  const email = normalizeEmail(body?.email ?? "");
  const password = body?.password ?? "";

  if (name.length < 2 || name.length > 80) {
    return NextResponse.json({ error: "Name should be at least 2 characters." }, { status: 400 });
  }
  if (!validEmail(email)) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }
  if (!validPassword(password)) {
    return NextResponse.json({ error: "Password must be 8–72 characters." }, { status: 400 });
  }

  const ip = clientIp(request);
  try {
    // New accounts are where free credits come from, so scripted signups are capped per address.
    // The attempt is recorded before it is counted, so a parallel burst cannot slip past the limit.
    const slot = await claimSignupSlot(ip);
    if (!slot.allowed) {
      return NextResponse.json(
        { error: `Too many new accounts from this network. Try again in an hour (limit ${SIGNUPS_PER_IP_HOUR} per hour).` },
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    }
    let user;
    try {
      user = await createUser({ name, email, password, role: "beta" });
    } catch (error) {
      // No account was made (a duplicate email, say): the slot goes back.
      await slot.release().catch(() => {});
      throw error;
    }
    const token = await signSession(user);
    const response = NextResponse.json({ user });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (error) {
    const failure = describeStorageFailure(error, `signup ${email}`);
    if (failure.unavailable) {
      // Operator problem, not a user problem: log the detail, say something useful.
      console.error(`[auth] ${failure.detail}`);
      return NextResponse.json(
        { error: failure.message, code: "storage_unavailable" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: failure.message }, { status: 409 });
  }
}
