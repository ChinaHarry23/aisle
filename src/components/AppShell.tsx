"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import {
  CalendarDays,
  LayoutDashboard,
  Megaphone,
  Plus,
  ShieldAlert,
  Store,
  LineChart,
  Clapperboard,
  Images,
  SlidersHorizontal,
  TrendingUp,
} from "lucide-react";
import { CreditsBadge } from "@/components/billing/CreditsBadge";
import { UserMenu } from "@/components/UserMenu";
import { BrandLogo } from "@/components/BrandLogo";
import { WorkspaceSync } from "@/components/WorkspaceSync";
import { cn } from "@/lib/cn";
import { clearSignedInHint, rememberSignedIn, signOutAndReload } from "@/lib/auth/client";
import type { PublicUser } from "@/lib/auth/types";
import { isArchived } from "@/lib/campaign-lifecycle";
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
      { href: "/library", label: "Library", icon: Images },
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

export function AppShell({ children, user }: { children: ReactNode; user: PublicUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const campaigns = useAisle((s) => s.campaigns);
  const hydrated = useAisle((s) => s.hydrated);

  useEffect(() => {
    rememberSignedIn(user);
    let cancelled = false;
    // The shell is already on screen. This only revokes a cookie the database no longer accepts.
    void fetch("/api/auth/me")
      .then((res) => {
        if (cancelled || res.status !== 401) return;
        clearSignedInHint();
        router.replace("/login");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [router, user.id, user.email, user.name, user.role]);

  const awaiting = campaigns.filter((c) => !isArchived(c) && c.status === "awaiting_approval").length;

  return (
    <WorkspaceSync user={user}>
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
              <div className="flex items-center justify-end gap-4 px-[var(--page-pad)] pt-4">
                <CreditsBadge pathname={pathname} />
                <UserMenu user={user} onSignOut={signOutAndReload} />
              </div>
              <div className="shell-page !pt-4">
                {hydrated ? (
                  children
                ) : (
                  <p className="text-sm text-mute">Loading your campaigns…</p>
                )}
              </div>
            </div>
          </div>
        </div>
    </WorkspaceSync>
  );
}
