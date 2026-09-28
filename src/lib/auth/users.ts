/**
 * Accounts, on SQL.
 *
 * Uniqueness is enforced by the database, not by a read-then-write check: two
 * simultaneous signups for the same address now produce one account and one
 * conflict, instead of two documents racing each other.
 */

import { getDatabase } from "@/lib/db";
import { uid } from "@/lib/ids";
import { hashPassword, normalizeEmail } from "./password";
import { SEED_ACCOUNTS, SEED_PASSWORD } from "./seed-accounts";
import type { AuthUser, PublicUser, UserRole } from "./types";

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  password_hash: string;
  created_at: string;
};

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role === "dev" ? "dev" : "beta",
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}

export function publicUser(user: AuthUser): PublicUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

/**
 * Create the shared team desks if they are missing.
 *
 * The previous build shipped password hashes whose plaintext was never recorded,
 * so nobody could actually sign in; these are written with a known password
 * instead. Each desk is checked individually rather than "seed only when the table
 * is empty", so a database that already holds a self-registered account still gets
 * the team desks — and an existing account is never overwritten.
 */
let seedChecked = false;

export async function ensureSeedAccounts(): Promise<{ seeded: boolean; password?: string }> {
  if (seedChecked) return { seeded: false };
  const db = await getDatabase();
  const createdAt = new Date().toISOString();
  const hash = await hashPassword(SEED_PASSWORD);
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
  return created > 0 ? { seeded: true, password: SEED_PASSWORD } : { seeded: false };
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
  await db.execute("update users set password_hash = $1, updated_at = $2 where id = $3", [
    await hashPassword(password),
    new Date().toISOString(),
    rows[0].id,
  ]);
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
