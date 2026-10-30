import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";

/**
 * The shell is rendered from the session cookie. That check is local JWT
 * verification, so the navigation is in the first HTML byte and does not wait
 * for Postgres. A background read confirms the account still exists.
 */
export default async function StudioLayout({ children }: { children: ReactNode }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await readSession(token) : null;
  if (!session) redirect("/login");
  return (
    <AppShell user={{ id: session.id, email: session.email, name: session.name, role: session.role }}>
      {children}
    </AppShell>
  );
}
