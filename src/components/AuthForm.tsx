"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

type Mode = "login" | "signup";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const res = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "login" ? { email, password } : { name, email, password }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(json?.error ?? "Something went wrong.");
        return;
      }
      router.replace(next.startsWith("/") ? next : "/");
      router.refresh();
    } catch {
      setError("Could not reach the desk. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="shell-brand mb-6">
          <span className="shell-brand-mark" aria-hidden>
            <span className="h-5 w-[3px] bg-signal" />
            <span className="h-6 w-[3px] bg-signal/50" />
            <span className="h-4 w-[3px] bg-signal" />
          </span>
          <span className="shell-brand-name">Aisle</span>
        </div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-signal">
          {mode === "login" ? "Founder desk" : "Beta access"}
        </p>
        <h1 className="mt-2 font-serif text-4xl">
          {mode === "login" ? "Sign in." : "Try the beta."}
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          {mode === "login"
            ? "Each account keeps its own campaigns, studio history, and brand settings."
            : "Create a desk and run a campaign. Your work stays on this account."}
        </p>

        <form className="mt-8 flex flex-col gap-4" onSubmit={onSubmit}>
          {mode === "signup" ? (
            <label>
              Name
              <input
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
              />
            </label>
          ) : null}
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </label>
          {error ? <p className="auth-error">{error}</p> : null}
          <button className="auth-submit" type="submit" disabled={pending}>
            {pending ? "Opening…" : mode === "login" ? "Enter the desk" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-sm text-ink-soft">
          {mode === "login" ? (
            <>
              New here?{" "}
              <Link href="/signup" className="text-signal">
                Sign up for the beta
              </Link>
            </>
          ) : (
            <>
              Already have a desk?{" "}
              <Link href="/login" className="text-signal">
                Sign in
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
