/**
 * Accounts, on SQL.
 *
 * Uniqueness is enforced by the database, not by a read-then-write check: two
 * simultaneous signups for the same address now produce one account and one
 * conflict, instead of two documents racing each other.
 */

import { randomBytes } from "node:crypto";
import { getDatabase, type Database } from "@/lib/db";
import { uid } from "@/lib/ids";
import { isHosted } from "@/lib/billing/hosted";
import { hashPassword, normalizeEmail, validEmail, verifyPassword } from "./password";
import { DEMO_SEED_PASSWORD, SEED_ACCOUNTS, seedPassword } from "./seed-accounts";
import type { AuthUser, PublicUser, SessionUser, UserRole } from "./types";

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  password_hash: string;
  created_at: string;
  password_login?: number | null;
  google_sub?: string | null;
  apple_sub?: string | null;
  session_version?: number | string | null;
};

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role === "dev" ? "dev" : "beta",
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    passwordLogin: row.password_login == null ? true : Number(row.password_login) !== 0,
    googleSub: row.google_sub ?? null,
    appleSub: row.apple_sub ?? null,
    sessionVersion: Number(row.session_version ?? 0),
  };
}

export function publicUser(user: AuthUser): PublicUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

/**
 * Create the shared team desks if they are missing.
 *
 * Each desk is checked individually rather than "seed only when the table is
 * empty", so a database that already holds a self-registered account still gets
 * the team desks — and an existing account is never overwritten.
 *
 * On a hosted install without AISLE_SEED_PASSWORD nothing is created, and a
 * desk seeded earlier that still accepts the published demo password is locked
 * (its password replaced with a random one), so the README's password cannot
 * open a desk on the internet.
 */
let seedChecked = false;

/** Tests only: run the seed check again on the next call. */
export function resetSeedCheck() {
  seedChecked = false;
}

export async function ensureSeedAccounts(): Promise<{ seeded: boolean; password?: string }> {
  if (seedChecked) return { seeded: false };
  const db = await getDatabase();
  const password = seedPassword();
  let lockFailed = false;
  if (isHosted()) {
    // A failed lock check must never break sign-in; it is logged and retried on the next call.
    lockFailed = await lockDemoDesks(db).then(
      () => false,
      (error) => {
        console.error("[auth] demo-desk lock check failed", error instanceof Error ? error.message : error);
        return true;
      },
    );
  }
  if (!password) {
    if (!lockFailed) seedChecked = true;
    return { seeded: false };
  }
  const createdAt = new Date().toISOString();
  const hash = await hashPassword(password);
  let created = 0;

  for (const account of SEED_ACCOUNTS) {
    try {
      await db.execute(
        `insert into users (id, email, name, role, password_hash, created_at)
         select $1, $2, $3, $4, $5, $6
         where not exists (select 1 from users where lower(email) = $2 or id = $1)`,
        [account.id, account.email, account.name, account.role, hash, createdAt],
      );
      const rows = await db.query<{ count: string | number }>(
        "select count(*) as count from users where lower(email) = $1",
        [account.email],
      );
      if (Number(rows[0]?.count ?? 0) > 0) created += 1;
    } catch {
      // Another process seeded first; the unique index is the arbiter.
    }
  }

  seedChecked = true;
  // Only report the password when this call is what put a desk in place.
  return created > 0 ? { seeded: true, password } : { seeded: false };
}

/** Marks that the hosted demo-password check ran, so later cold starts skip the bcrypt work. */
const DEMO_DESKS_CHECKED = "system/demo-desks-locked";

async function lockDemoDesks(db: Database) {
  if (process.env.AISLE_SEED_PASSWORD === DEMO_SEED_PASSWORD) return;
  const done = await db.query("select 1 as done from kv where key = $1", [DEMO_DESKS_CHECKED]);
  if (done.length) return;
  const ids = SEED_ACCOUNTS.map((account) => account.id);
  const rows = await db.query<{ id: string; password_hash: string }>(
    `select id, password_hash from users where id in (${ids.map((_, i) => `$${i + 1}`).join(", ")})`,
    ids,
  );
  for (const row of rows) {
    if (!(await verifyPassword(DEMO_SEED_PASSWORD, row.password_hash))) continue;
    await db.execute(
      "update users set password_hash = $1, session_version = session_version + 1, updated_at = $2 where id = $3",
      [await hashPassword(randomBytes(32).toString("hex")), new Date().toISOString(), row.id],
    );
    console.warn(`[auth] locked seeded desk ${row.id}: it still used the published demo password on a hosted install`);
  }
  await db.execute(
    "insert into kv (key, value, updated_at) values ($1, $2, $3) on conflict (key) do nothing",
    [DEMO_DESKS_CHECKED, "true", new Date().toISOString()],
  );
}

export async function findUserByEmail(email: string): Promise<AuthUser | null> {
  await ensureSeedAccounts();
  const db = await getDatabase();
  const rows = await db.query<UserRow>("select * from users where lower(email) = $1", [
    normalizeEmail(email),
  ]);
  return rows.length > 0 ? toAuthUser(rows[0]) : null;
}

export async function findUserById(id: string): Promise<AuthUser | null> {
  const db = await getDatabase();
  const rows = await db.query<UserRow>("select * from users where id = $1", [id]);
  return rows.length > 0 ? toAuthUser(rows[0]) : null;
}

export async function countUsers(): Promise<number> {
  const db = await getDatabase();
  const rows = await db.query<{ count: string | number }>("select count(*) as count from users");
  return Number(rows[0]?.count ?? 0);
}

export async function createUser(input: {
  email: string;
  name: string;
  password: string;
  role?: UserRole;
}): Promise<PublicUser> {
  await ensureSeedAccounts();
  const db = await getDatabase();
  const user: AuthUser = {
    id: uid("usr"),
    email: normalizeEmail(input.email),
    name: input.name.trim(),
    role: input.role ?? "beta",
    createdAt: new Date().toISOString(),
    passwordHash: await hashPassword(input.password),
    passwordLogin: true,
    googleSub: null,
    appleSub: null,
    sessionVersion: 0,
  };

  try {
    await db.execute(
      "insert into users (id, email, name, role, password_hash, created_at) values ($1, $2, $3, $4, $5, $6)",
      [user.id, user.email, user.name, user.role, user.passwordHash, user.createdAt],
    );
  } catch (error) {
    // A duplicate is a domain answer, not a crash: the caller shows it on the form.
    if (isUniqueViolation(error)) {
      throw new Error("That email already has a desk. Sign in instead.");
    }
    throw error;
  }
  return publicUser(user);
}

/**
 * Open or create the account behind a verified Google or Apple identity.
 *
 * A confirmed email that already has a password account is linked, not duplicated.
 * An identity with no confirmed email cannot take over an existing desk.
 */
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
  const bySub = await db.query<UserRow>(`select * from users where ${column} = $1`, [input.sub]);
  if (bySub[0]) {
    await recordLogin(bySub[0].id);
    const user = toAuthUser(bySub[0]);
    return { ...publicUser(user), sessionVersion: user.sessionVersion };
  }

  const email = input.email ? normalizeEmail(input.email) : "";
  if (!email || !validEmail(email) || !input.emailVerified) {
    throw new Error("The provider did not share a confirmed email.");
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    // A desk holds the owner's unlimited credits; whoever controls its mailbox must not inherit it.
    if (existing.role === "dev") throw new Error("Team desks sign in with their password.");
    const linked = input.provider === "google" ? existing.googleSub : existing.appleSub;
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
    return { ...publicUser(fresh), sessionVersion: fresh.sessionVersion };
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
  return { id, email, name, role: "beta" };
}

export async function recordLogin(id: string): Promise<void> {
  try {
    const db = await getDatabase();
    await db.execute("update users set last_login_at = $1 where id = $2", [
      new Date().toISOString(),
      id,
    ]);
  } catch {
    // Login bookkeeping must never block a successful sign-in.
  }
}

export async function setPassword(email: string, password: string): Promise<boolean> {
  const db = await getDatabase();
  const rows = await db.query<{ id: string }>("select id from users where lower(email) = $1", [
    normalizeEmail(email),
  ]);
  if (rows.length === 0) return false;
  // A new password ends every session signed with the old one.
  await db.execute(
    "update users set password_hash = $1, session_version = session_version + 1, updated_at = $2 where id = $3",
    [await hashPassword(password), new Date().toISOString(), rows[0].id],
  );
  return true;
}

export async function listUsers(): Promise<PublicUser[]> {
  const db = await getDatabase();
  const rows = await db.query<UserRow>("select * from users order by created_at");
  return rows.map((row) => publicUser(toAuthUser(row)));
}

/**
 * SQLite says "UNIQUE constraint failed", Postgres says "duplicate key value".
 * Both mean the same thing to the caller.
 */
export function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const code = (error as { code?: string } | null)?.code;
  return (
    message.includes("unique constraint") ||
    message.includes("duplicate key") ||
    code === "23505" ||
    code === "SQLITE_CONSTRAINT_UNIQUE" ||
    code === "SQLITE_CONSTRAINT_PRIMARYKEY"
  );
}
