import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { sessionCookieOptions, signSession, SESSION_COOKIE } from "@/lib/auth/session";
import { updateUserName } from "@/lib/auth/users";

export const runtime = "nodejs";

const MAX_NAME = 80;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  return NextResponse.json({ user });
}

export async function PATCH(request: Request) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ user: null }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  if (!name) return NextResponse.json({ error: "Enter a name." }, { status: 400 });
  if (name.length > MAX_NAME) {
    return NextResponse.json({ error: `Keep it under ${MAX_NAME} characters.` }, { status: 400 });
  }

  const user = await updateUserName(current.id, name).catch(() => null);
  if (!user) return NextResponse.json({ error: "Couldn't save your name." }, { status: 500 });

  // The name lives in the session token too, so reissue it or the header keeps the old one.
  const response = NextResponse.json({ user });
  // Keep the account's session version, or the new cookie would stop signing in.
  response.cookies.set(SESSION_COOKIE, await signSession({ ...user, sessionVersion: current.sessionVersion }), sessionCookieOptions());
  return response;
}
