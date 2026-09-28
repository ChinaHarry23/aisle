"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  CalendarDays,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessagesSquare,
  ShieldAlert,
  Sparkles,
  Store,
  LineChart,
  Clapperboard,
  SlidersHorizontal,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { WorkspaceSync } from "@/components/WorkspaceSync";
import { DeveloperContact } from "@/components/DeveloperContact";
import { cn } from "@/lib/cn";
import type { PublicUser } from "@/lib/auth/types";
import { applyTheme, isUiTheme } from "@/lib/theme";
import { useAisle } from "@/lib/store";

const nav = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/whatsapp", label: "WhatsApp", icon: MessagesSquare },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/studio", label: "Studio", icon: Clapperboard },
  { href: "/approvals", label: "Approvals", icon: ShieldAlert },
  { href: "/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/performance", label: "Performance", icon: LineChart },
  { href: "/brand", label: "Brand", icon: Store },
  { href: "/settings", label: "Settings", icon: SlidersHorizontal },
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
  const brand = useAisle((s) => s.brand);
  const theme = useAisle((s) => s.settings.theme);
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

  useEffect(() => {
    if (isUiTheme(theme)) applyTheme(theme);
  }, [theme]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    useAisle.persist.setOptions({ name: "aisle-ws-pending" });
    useAisle.setState({ hydrated: false });
    router.replace("/login");
    router.refresh();
  }

  if (isAuthPath(pathname)) {
    return (
      <div className="flex min-h-screen flex-col">
        {children}
        <DeveloperContact />
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
  const live = campaigns.some((c) =>
    ["analysing", "generating", "compliance", "revising", "scheduling"].includes(c.status),
  );

  return (
    <WorkspaceSync user={user}>
      {!hydrated ? (
        <div className="flex min-h-screen items-center justify-center bg-paper text-mute">
          Opening the studio…
        </div>
      ) : (
        <div className="shell">
          <header className="shell-bar">
            <p className="shell-bar-meta truncate">
              {brand.retailerName}
              {live ? " · agents live" : ""}
              {awaiting > 0 ? ` · ${awaiting} waiting` : ""}
            </p>
            <div className="flex items-center gap-3">
              <p className="hidden max-w-[14rem] truncate text-[11px] uppercase tracking-[0.14em] sm:block">
                {user.name}
                {user.role === "dev" ? " · desk" : " · beta"}
              </p>
              <ThemeToggle />
            </div>
          </header>
          <div className="shell-frame">
            <aside className="shell-aside">
              <div className="flex items-center justify-between px-5 py-5 lg:block">
                <Link href="/" className="shell-brand">
                  <span className="shell-brand-mark" aria-hidden>
                    <span className="h-5 w-[3px] bg-signal" />
                    <span className="h-6 w-[3px] bg-signal/50" />
                    <span className="h-4 w-[3px] bg-signal" />
                  </span>
                  <span className="shell-brand-name">Aisle</span>
                </Link>
                <p className="shell-kicker">One-person marketing company</p>
              </div>
              <nav className="shell-nav">
                {nav.map((item) => {
                  const active =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const Icon = item.icon;
                  return (
                    <Link key={item.href} href={item.href} className={cn(active && "is-active")}>
                      <Icon size={16} strokeWidth={1.7} />
                      {item.label}
                      {item.href === "/approvals" && awaiting > 0 ? (
                        <span className="ml-auto rounded-full bg-signal px-1.5 text-[10px] text-paper">
                          {awaiting}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </nav>
              <div className="shell-foot">
                <p className="flex items-center gap-2 text-xs" style={{ color: "var(--aside-muted)" }}>
                  <Sparkles size={14} />
                  {user.role === "dev" ? "Team desk" : "Beta desk"}
                </p>
                <p className="mt-1 font-serif text-lg">{user.name}</p>
                <p className="text-xs" style={{ color: "var(--aside-muted)" }}>
                  {user.email}
                </p>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs"
                  style={{ color: "var(--aside-muted)" }}
                >
                  <LogOut size={13} />
                  Sign out
                </button>
              </div>
            </aside>
            <div className="min-w-0">
              <div className="shell-page">{children}</div>
              <DeveloperContact />
            </div>
          </div>
        </div>
      )}
    </WorkspaceSync>
  );
}
