import { NextResponse } from "next/server";
import { findUserByEmail, publicUser, recordLogin } from "@/lib/auth/users";
import { normalizeEmail, validEmail, verifyPassword } from "@/lib/auth/password";
import { sessionCookieOptions, signSession, SESSION_COOKIE } from "@/lib/auth/session";
import { describeStorageFailure } from "@/lib/auth/storage-errors";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { email?: string; password?: string }
    | null;
  const email = normalizeEmail(body?.email ?? "");
  const password = body?.password ?? "";
  if (!validEmail(email) || !password) {
    return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  }

  let user;
  try {
    user = await findUserByEmail(email);
  } catch (error) {
    const failure = describeStorageFailure(error, `login ${email}`);
    console.error(`[auth] ${failure.detail}`);
    return NextResponse.json(
      { error: failure.message, code: "storage_unavailable" },
      { status: 503 },
    );
  }

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ error: "Email or password is wrong." }, { status: 401 });
  }

  const token = await signSession(publicUser(user));
  const response = NextResponse.json({ user: publicUser(user) });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  await recordLogin(user.id);
  return response;
}
