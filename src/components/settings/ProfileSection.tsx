"use client";

import { Check, Copy, LogOut, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import type { PublicUser, UserRole } from "@/lib/auth/types";
import { signOutAndReload } from "@/lib/auth/client";

/** Only roles worth showing get a label; beta accounts show none. */
const ROLE_LABEL: Partial<Record<UserRole, string>> = { dev: "Admin" };

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; user: PublicUser };

function initialsOf(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.slice(0, 2) ?? email.slice(0, 1)).toUpperCase();
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked: nothing useful to do */
        }
      }}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-mute hover:bg-paper-2 hover:text-ink"
    >
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
    </button>
  );
}

function NameEditor({ user, onSaved }: { user: PublicUser; onSaved: (u: PublicUser) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(user.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const next = draft.trim();
    if (!next || next === user.name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      const json = (await res.json().catch(() => null)) as
        | { user?: PublicUser; error?: string }
        | null;
      if (!res.ok || !json?.user) {
        setError(json?.error ?? "Couldn't save your name.");
        return;
      }
      onSaved(json.user);
      setEditing(false);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-4 px-5 py-2">
        <dt className="text-mute">Name</dt>
        <dd className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{user.name}</span>
          <button
            type="button"
            onClick={() => {
              setDraft(user.name);
              setEditing(true);
            }}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-signal hover:bg-paper-2"
          >
            <Pencil size={12} aria-hidden />
            Edit
          </button>
        </dd>
      </div>
    );
  }

  return (
    <div className="px-5 py-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label htmlFor="profile-name" className="w-16 text-mute">
          Name
        </label>
        <input
          id="profile-name"
          autoFocus
          value={draft}
          maxLength={80}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
          aria-invalid={error ? true : undefined}
          className="min-w-0 flex-1 border px-3 py-1.5 text-sm outline-none focus:border-signal"
        />
        <button
          type="submit"
          disabled={saving || !draft.trim()}
          className="btn-primary rounded-[var(--r-btn)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-[var(--r-btn)] border border-line px-3 py-1.5 text-sm"
        >
          Cancel
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="hairline p-5" aria-busy="true" aria-label="Loading profile">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 animate-pulse rounded-full bg-paper-2" />
        <div className="flex flex-1 flex-col gap-2">
          <div className="h-4 w-40 animate-pulse bg-paper-2" />
          <div className="h-3 w-56 animate-pulse bg-paper-2" />
        </div>
      </div>
    </div>
  );
}

export function ProfileSection() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { user?: PublicUser | null } | null) => {
        if (cancelled) return;
        setLoad(json?.user ? { status: "ready", user: json.user } : { status: "error" });
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    setSigningOut(true);
    await signOutAndReload();
  }

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="profile-heading" className="flex flex-col gap-4">
        <div>
          <h2 id="profile-heading" className="font-serif text-lg">
            Profile
          </h2>
          <p className="mt-1 text-sm text-ink-soft">How you appear in this workspace.</p>
        </div>

        {load.status === "loading" ? <Skeleton /> : null}

        {load.status === "error" ? (
          <div role="alert" className="hairline p-5 text-sm text-ink-soft">
            We couldn&rsquo;t load your profile. Refresh the page, or sign in again if the problem
            continues.
          </div>
        ) : null}

        {load.status === "ready" ? (
          <div className="hairline">
            <div className="flex items-center gap-4 p-5">
              <span
                aria-hidden
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-signal text-xl font-semibold text-white"
              >
                {initialsOf(load.user.name, load.user.email)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">{load.user.name}</p>
                <p className="truncate text-sm text-ink-soft">{load.user.email}</p>
                {ROLE_LABEL[load.user.role] ? (
                  <span className="mt-2 inline-block rounded-full border border-line px-2 py-0.5 text-xs text-ink-soft">
                    {ROLE_LABEL[load.user.role]}
                  </span>
                ) : null}
              </div>
            </div>
            <dl className="divide-y divide-line border-t border-line text-sm">
              <NameEditor
                user={load.user}
                onSaved={(user) => setLoad({ status: "ready", user })}
              />
              <div className="flex items-center justify-between gap-4 px-5 py-2">
                <dt className="text-mute">Email</dt>
                <dd className="flex min-w-0 items-center gap-1">
                  <span className="truncate font-medium">{load.user.email}</span>
                  <CopyButton value={load.user.email} label="email" />
                </dd>
              </div>
              {ROLE_LABEL[load.user.role] ? (
                <div className="flex items-center justify-between gap-4 px-5 py-3">
                  <dt className="text-mute">Role</dt>
                  <dd className="font-medium">{ROLE_LABEL[load.user.role]}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="session-heading" className="flex flex-col gap-4">
        <div>
          <h2 id="session-heading" className="font-serif text-lg">
            Session
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            Sign out on this device. Keys you saved in this browser stay here.
          </p>
        </div>
        <div>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="inline-flex items-center gap-2 border border-line px-4 py-2 text-sm font-medium hover:bg-paper-2 disabled:opacity-60"
          >
            <LogOut size={14} aria-hidden />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </section>
    </div>
  );
}
