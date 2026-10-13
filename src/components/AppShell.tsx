"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  CalendarDays,
  LayoutDashboard,
  Megaphone,
  Plus,
  ShieldAlert,
  Store,
  LineChart,
  Clapperboard,
  SlidersHorizontal,
  TrendingUp,
} from "lucide-react";
import { UserMenu } from "@/components/UserMenu";
import { BrandLogo } from "@/components/BrandLogo";
import { WorkspaceSync } from "@/components/WorkspaceSync";
import { cn } from "@/lib/cn";
import type { PublicUser } from "@/lib/auth/types";
import { useAisle } from "@/lib/store";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };

const navGroups: { label?: string; end?: boolean; items: NavItem[] }[] = [
  { items: [{ href: "/", label: "Overview", icon: LayoutDashboard }] },
  {
    label: "Create",
    items: [
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/trends", label: "Trends", icon: TrendingUp },
      { href: "/studio", label: "Content Generation", icon: Clapperboard },
    ],
  },
  {
    label: "Publish & Track",
    items: [
      { href: "/approvals", label: "Approvals", icon: ShieldAlert },
      { href: "/schedule", label: "Schedule", icon: CalendarDays },
      { href: "/performance", label: "Performance", icon: LineChart },
    ],
  },
  {
    label: "Setup",
    end: true,
    items: [
      { href: "/brand", label: "Brand", icon: Store },
      { href: "/settings", label: "Settings", icon: SlidersHorizontal },
    ],
  },
];

function isAuthPath(pathname: string) {
  return pathname === "/login" || pathname === "/signup";
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);
  // Auth pages render straight away; every other route waits for /api/auth/me.
  const [sessionReady, setSessionReady] = useState(() => isAuthPath(pathname));
  const campaigns = useAisle((s) => s.campaigns);
  const hydrated = useAisle((s) => s.hydrated);

  useEffect(() => {
    if (isAuthPath(pathname)) return;
    let cancelled = false;
    void fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : { user: null }))
      .then((json: { user?: PublicUser | null }) => {
        if (cancelled) return;
        if (!json.user) {
          router.replace("/login");
          return;
        }
        setUser(json.user);
        setSessionReady(true);
      })
      .catch(() => {
        if (!cancelled) router.replace("/login");
      });
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* offline: the cookie may survive, so fall through to the redirect and let the proxy decide */
    }
    // A full navigation drops the in-memory workspace so the next account never sees it.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
  }

  if (isAuthPath(pathname)) {
    return (
      <div className="flex min-h-screen flex-col">
        {children}
      </div>
    );
  }

  if (!sessionReady || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper text-mute">
        Opening the studio…
      </div>
    );
  }

  const awaiting = campaigns.filter((c) => c.status === "awaiting_approval").length;

  return (
    <WorkspaceSync user={user}>
      {!hydrated ? (
        <div className="flex min-h-screen items-center justify-center bg-paper text-mute">
          Opening the studio…
        </div>
      ) : (
        <div className="shell">
          <div className="shell-frame">
            <aside className="shell-aside">
              <div className="shell-head">
                <Link href="/" className="shell-brand">
                  <BrandLogo />
                </Link>
                <Link href="/campaigns/new" className="shell-new">
                  <Plus size={16} strokeWidth={2.2} />
                  <span>New campaign</span>
                </Link>
              </div>
              <div className="shell-navs">
                {[navGroups.filter((g) => !g.end), navGroups.filter((g) => g.end)].map((groups, n) => (
                  <nav
                    key={n}
                    className={n === 0 ? "shell-nav" : "shell-foot"}
                    aria-label={n === 0 ? "Main" : "Setup"}
                  >
                    {groups.map((group, i) => (
                      <div key={group.label ?? i} className="shell-group">
                        {group.label ? <p className="shell-group-label">{group.label}</p> : null}
                        {group.items.map((item) => {
                          const active =
                            item.href === "/"
                              ? pathname === "/"
                              : pathname === item.href || pathname.startsWith(`${item.href}/`);
                          const Icon = item.icon;
                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              aria-current={active ? "page" : undefined}
                              className={cn(active && "is-active")}
                            >
                              <Icon size={16} strokeWidth={1.7} />
                              {item.label}
                              {item.href === "/approvals" && awaiting > 0 ? (
                                <span className="ml-auto rounded-full bg-signal px-1.5 text-[10px] font-semibold text-white">
                                  {awaiting}
                                </span>
                              ) : null}
                            </Link>
                          );
                        })}
                      </div>
                    ))}
                  </nav>
                ))}
              </div>
            </aside>
            <div className="min-w-0">
              <div className="flex justify-end px-[var(--page-pad)] pt-4">
                <UserMenu user={user} onSignOut={signOut} />
              </div>
              <div className="shell-page !pt-4">{children}</div>
            </div>
          </div>
        </div>
      )}
    </WorkspaceSync>
  );
}
