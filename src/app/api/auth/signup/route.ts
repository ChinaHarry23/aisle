import { NextResponse } from "next/server";
import { createUser } from "@/lib/auth/users";
import { normalizeEmail, validEmail, validPassword } from "@/lib/auth/password";
import { sessionCookieOptions, signSession, SESSION_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";

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

  try {
    const user = await createUser({ name, email, password, role: "beta" });
    const token = await signSession(user);
    const response = NextResponse.json({ user });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create that account.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
