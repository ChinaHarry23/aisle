"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

type Mode = "login" | "signup";

const oauthErrors: Record<string, string> = {
  google_unavailable: "Google sign-in is not set up on this deployment yet.",
  apple_unavailable: "Apple sign-in is not set up on this deployment yet.",
  oauth_denied: "Sign-in was cancelled.",
  oauth_state: "That sign-in expired. Try again.",
  oauth_email: "Google or Apple did not share a confirmed email address.",
  oauth_failed: "Sign-in did not complete. Try again.",
};

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/";
  const oauthError = oauthErrors[search.get("error") ?? ""] ?? "";
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
        <h1 className="mt-2 font-serif text-4xl">
          {mode === "login" ? "Sign in" : "Create your account"}
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          Your campaigns, brand, and approvals stay on this account.
        </p>

        <div className="mt-8 flex flex-col gap-2">
          <a className="auth-provider" href={`/api/auth/google?next=${encodeURIComponent(next)}`}>
            <GoogleMark />
            Continue with Google
          </a>
          <a className="auth-provider" href={`/api/auth/apple?next=${encodeURIComponent(next)}`}>
            <AppleMark />
            Continue with Apple
          </a>
        </div>
        <p className="auth-divider">or use email</p>

        {oauthError ? <p className="auth-error">{oauthError}</p> : null}

        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
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
            {pending ? "Opening…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-sm text-ink-soft">
          {mode === "login" ? (
            <>
              New here?{" "}
              <Link href="/signup" className="text-signal">
                Create an account
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
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

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.98 10.72A5.4 5.4 0 0 1 3.7 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3.02-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.02 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden>
      <path
        fill="currentColor"
        d="M13.2 9.5c0-2.1 1.7-3.1 1.8-3.2-1-1.4-2.5-1.6-3-1.7-1.3-.1-2.5.8-3.1.8s-1.6-.7-2.7-.7c-1.4 0-2.7.8-3.4 2.1-1.5 2.5-.4 6.3 1 8.4.7 1 1.5 2.1 2.6 2.1 1 0 1.4-.7 2.7-.7s1.6.7 2.7.7 1.8-1 2.5-2c.8-1.1 1.1-2.2 1.1-2.3-.1 0-2.2-.8-2.2-3.3zM11.1 3.4c.6-.7 1-1.7.9-2.7-1 .1-2.1.6-2.8 1.4-.6.7-1.1 1.7-.9 2.6 1 .1 2.1-.5 2.8-1.3z"
      />
    </svg>
  );
}
