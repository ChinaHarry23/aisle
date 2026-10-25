import { NextResponse } from "next/server";
import { findUserByEmail, publicUser, recordLogin } from "@/lib/auth/users";
import { normalizeEmail, validEmail, verifyPassword } from "@/lib/auth/password";
import { sessionCookieOptions, signSession, SESSION_COOKIE } from "@/lib/auth/session";
import { DEMO_SEED_PASSWORD, SEED_ACCOUNTS } from "@/lib/auth/seed-accounts";
import { userExtras } from "@/lib/auth/oauth-users";
import { isHosted } from "@/lib/billing/hosted";
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

  if (!user) {
    return NextResponse.json({ error: "Email or password is wrong." }, { status: 401 });
  }
  const extras = await userExtras(user.id);
  // Cindy's AuthUser omits passwordLogin; extras reads the PR #2 column (default on).
  if (extras.passwordLogin === false) {
    return NextResponse.json(
      { error: "This account uses Google or Apple. Continue with that button." },
      { status: 401 },
    );
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ error: "Email or password is wrong." }, { status: 401 });
  }
  // Hosted installs still seed the desks with the demo password unless AISLE_SEED_PASSWORD
  // is set, and nothing else locks them: this check is what keeps the published demo
  // password from opening a team desk on a hosted install (unless the owner deliberately
  // set AISLE_SEED_PASSWORD to it).
  if (
    isHosted() &&
    password === DEMO_SEED_PASSWORD &&
    process.env.AISLE_SEED_PASSWORD !== DEMO_SEED_PASSWORD &&
    SEED_ACCOUNTS.some((account) => account.id === user.id)
  ) {
    return NextResponse.json({ error: "Email or password is wrong." }, { status: 401 });
  }

  const token = await signSession({ ...publicUser(user), sessionVersion: extras.sessionVersion });
  const response = NextResponse.json({ user: publicUser(user) });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  await recordLogin(user.id);
  return response;
}
