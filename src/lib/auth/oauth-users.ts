/**
 * OAuth account linking lives next to Cindy's password users module rather than
 * inside it: her `users.ts` is restored exactly, and Google/Apple sign-in is a
 * PR #2 addition.
 */

import { randomBytes } from "node:crypto";
import { getDatabase } from "@/lib/db";
import { uid } from "@/lib/ids";
import { hashPassword, normalizeEmail, validEmail } from "./password";
import type { SessionUser } from "./types";
import {
  ensureSeedAccounts,
  findUserByEmail,
  findUserById,
  isUniqueViolation,
  publicUser,
  recordLogin,
} from "./users";

/** Columns PR #2 added; Cindy's `toAuthUser` does not map them. */
type UserExtras = {
  passwordLogin: boolean;
  googleSub: string | null;
  appleSub: string | null;
  sessionVersion: number;
};

export async function userExtras(userId: string): Promise<UserExtras> {
  const db = await getDatabase();
  const rows = await db.query<{
    password_login?: number | boolean | null;
    google_sub?: string | null;
    apple_sub?: string | null;
    session_version?: number | null;
  }>("select password_login, google_sub, apple_sub, session_version from users where id = $1", [userId]);
  const row = rows[0];
  const raw = row?.password_login;
  return {
    passwordLogin: raw !== 0 && raw !== false,
    googleSub: row?.google_sub ?? null,
    appleSub: row?.apple_sub ?? null,
    sessionVersion: Number(row?.session_version ?? 0),
  };
}

export async function signInWithProvider(input: {
  provider: "google" | "apple";
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}): Promise<SessionUser> {
  await ensureSeedAccounts();
  const db = await getDatabase();
  const column = input.provider === "google" ? "google_sub" : "apple_sub";
  const bySub = await db.query<{
    id: string;
    email: string;
  }>(`select id, email from users where ${column} = $1`, [input.sub]);
  if (bySub[0]) {
    await recordLogin(bySub[0].id);
    const user = (await findUserById(bySub[0].id)) ?? (await findUserByEmail(bySub[0].email));
    if (!user) throw new Error("Signed-in account could not be loaded.");
    const extras = await userExtras(user.id);
    return { ...publicUser(user), sessionVersion: extras.sessionVersion };
  }

  const email = input.email ? normalizeEmail(input.email) : "";
  if (!email || !validEmail(email) || !input.emailVerified) {
    throw new Error("The provider did not share a confirmed email.");
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    if (existing.role === "dev") throw new Error("Team desks sign in with their password.");
    const extras = await userExtras(existing.id);
    const linked = input.provider === "google" ? extras.googleSub : extras.appleSub;
    if (linked && linked !== input.sub) {
      throw new Error("That email is already linked to a different sign-in.");
    }
    if (!linked) {
      await db.execute(`update users set ${column} = $1, updated_at = $2 where id = $3`, [
        input.sub,
        new Date().toISOString(),
        existing.id,
      ]);
    }
    await recordLogin(existing.id);
    const fresh = (await findUserById(existing.id)) ?? existing;
    const after = await userExtras(fresh.id);
    return { ...publicUser(fresh), sessionVersion: after.sessionVersion };
  }

  const name = (input.name ?? "").trim().slice(0, 80) || email.split("@")[0] || "Aisle";
  const createdAt = new Date().toISOString();
  const id = uid("usr");
  const googleSub = input.provider === "google" ? input.sub : null;
  const appleSub = input.provider === "apple" ? input.sub : null;
  try {
    await db.execute(
      `insert into users
         (id, email, name, role, password_hash, created_at, password_login, google_sub, apple_sub)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        email,
        name,
        "beta",
        await hashPassword(randomBytes(32).toString("hex")),
        createdAt,
        0,
        googleSub,
        appleSub,
      ],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await findUserByEmail(email);
      if (raced) return publicUser(raced);
      throw new Error("That email already has an account. Sign in instead.");
    }
    throw error;
  }
  await recordLogin(id);
  return { id, email, name, role: "beta", sessionVersion: 0 };
}
