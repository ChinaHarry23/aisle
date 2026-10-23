"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, Receipt, SlidersHorizontal } from "lucide-react";
import type { PublicUser } from "@/lib/auth/types";

export function UserMenu({
  user,
  onSignOut,
}: {
  user: PublicUser;
  onSignOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = (user.name.trim()[0] ?? "?").toUpperCase();

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-2.5 text-sm text-ink hover:bg-paper-2"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-signal text-xs font-semibold text-white">
          {initial}
        </span>
        <span className="hidden max-w-[10rem] truncate font-medium sm:block">{user.name}</span>
        <ChevronDown size={14} className="text-mute" />
      </button>
      {open ? (
        <div
          role="menu"
          className="hairline absolute right-0 top-full z-40 mt-2 w-60 p-1.5 shadow-lg"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-mute">{user.email}</p>
          </div>
          <div className="my-1 h-px bg-line" />
          <Link
            href="/account/usage"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-paper-2"
          >
            <Receipt size={14} />
            Usage
          </Link>
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-paper-2"
          >
            <SlidersHorizontal size={14} />
            Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              await onSignOut();
              setPending(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-paper-2 disabled:opacity-60"
          >
            <LogOut size={14} />
            {pending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
