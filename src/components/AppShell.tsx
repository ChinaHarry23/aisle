"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  CalendarDays,
  LayoutDashboard,
  Megaphone,
  ShieldAlert,
  Sparkles,
  Store,
  LineChart,
  Clapperboard,
  SlidersHorizontal,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/cn";
import { applyTheme, isUiTheme } from "@/lib/theme";
import { useAisle } from "@/lib/store";

const nav = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/studio", label: "Studio", icon: Clapperboard },
  { href: "/approvals", label: "Approvals", icon: ShieldAlert },
  { href: "/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/performance", label: "Performance", icon: LineChart },
  { href: "/brand", label: "Brand", icon: Store },
  { href: "/settings", label: "Settings", icon: SlidersHorizontal },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const campaigns = useAisle((s) => s.campaigns);
  const brand = useAisle((s) => s.brand);
  const theme = useAisle((s) => s.settings.theme);
  const setHydrated = useAisle((s) => s.setHydrated);

  useEffect(() => {
    let cancelled = false;
    const done = () => {
      if (cancelled) return;
      setHydrated();
      setReady(true);
    };
    void Promise.resolve(useAisle.persist.rehydrate()).then(done, done);
    return () => {
      cancelled = true;
    };
  }, [setHydrated]);

  useEffect(() => {
    if (isUiTheme(theme)) applyTheme(theme);
  }, [theme]);

  const awaiting = campaigns.filter((c) => c.status === "awaiting_approval").length;
  const live = campaigns.some((c) =>
    ["analysing", "generating", "compliance", "revising", "scheduling"].includes(c.status),
  );

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper text-mute">
        Opening the studio…
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="shell-bar">
        <p className="shell-bar-meta truncate">
          {brand.retailerName}
          {live ? " · agents live" : ""}
          {awaiting > 0 ? ` · ${awaiting} waiting` : ""}
        </p>
        <ThemeToggle />
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
              Founder desk
            </p>
            <p className="mt-1 font-serif text-lg">{brand.retailerName}</p>
            <p className="text-xs" style={{ color: "var(--aside-muted)" }}>
              {brand.tagline}
            </p>
          </div>
        </aside>
        <div className="min-w-0">
          <div className="shell-page">{children}</div>
        </div>
      </div>
    </div>
  );
}
