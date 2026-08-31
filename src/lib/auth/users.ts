import { DEV_ACCOUNTS } from "./dev-accounts";
import { kvGet, kvSet } from "./kv";
import { hashPassword, normalizeEmail } from "./password";
import type { AuthUser, PublicUser, UserRole } from "./types";
import { uid } from "@/lib/ids";

function emailKey(email: string) {
  return `email/${normalizeEmail(email)}`;
}

function userKey(id: string) {
  return `user/${id}`;
}

function toPublic(user: AuthUser): PublicUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

let seeded = false;

export async function ensureDevAccounts() {
  if (seeded) return;
  await Promise.all(
    DEV_ACCOUNTS.map(async (account) => {
      const existing = await kvGet<string>(emailKey(account.email));
      if (existing) return;
      await kvSet(userKey(account.id), account);
      await kvSet(emailKey(account.email), account.id);
    }),
  );
  seeded = true;
}

export async function findUserByEmail(email: string): Promise<AuthUser | null> {
  await ensureDevAccounts();
  const id = await kvGet<string>(emailKey(email));
  if (!id) return null;
  return kvGet<AuthUser>(userKey(id));
}

export async function findUserById(id: string): Promise<AuthUser | null> {
  await ensureDevAccounts();
  return kvGet<AuthUser>(userKey(id));
}

export async function createUser(input: {
  email: string;
  name: string;
  password: string;
  role?: UserRole;
}): Promise<PublicUser> {
  await ensureDevAccounts();
  const email = normalizeEmail(input.email);
  if (await kvGet<string>(emailKey(email))) {
    throw new Error("That email is already on a desk.");
  }
  const user: AuthUser = {
    id: uid("usr"),
    email,
    name: input.name.trim(),
    role: input.role ?? "beta",
    createdAt: new Date().toISOString(),
    passwordHash: await hashPassword(input.password),
  };
  await kvSet(userKey(user.id), user);
  await kvSet(emailKey(email), user.id);
  return toPublic(user);
}

export function publicUser(user: AuthUser): PublicUser {
  return toPublic(user);
}
