import { cookies } from "next/headers";
import { readSession, SESSION_COOKIE } from "./session";
import type { SessionUser } from "./types";

export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return readSession(token);
}
