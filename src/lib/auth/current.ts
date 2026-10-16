import { cookies } from "next/headers";
import { readSession, SESSION_COOKIE } from "./session";
import type { SessionUser } from "./types";
import { findUserById, publicUser } from "./users";

/**
 * The signed-in account, as the database has it now. The cookie lasts 30 days,
 * so it only names the account: a deleted account, a replaced password or an
 * email claimed by Google/Apple (a newer session version) ends it, and the
 * role comes from the row, not from whatever it was at sign-in.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await readSession(token);
  if (!session) return null;
  const user = await findUserById(session.id);
  if (!user || user.sessionVersion !== (session.sessionVersion ?? 0)) return null;
  return publicUser(user);
}
