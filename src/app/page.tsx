import { cookies } from "next/headers";
import { Landing } from "@/components/Landing";
import { Overview } from "@/components/Overview";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";

// Signed-out visitors get the marketing page; signed-in users get their dashboard.
export default async function HomePage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = token ? await readSession(token) : null;
  return user ? <Overview /> : <Landing />;
}
