/**
 * Google and Apple sign-in.
 *
 * Both providers finish in the same place: a verified identity becomes an Aisle
 * account and the existing session cookie. Google returns on a top-level redirect.
 * Apple posts the result back, so the short-lived state cookie is SameSite=None
 * on https, which is what a cross-site form post is allowed to send.
 */

import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";
import { sessionCookieOptions, signSession, SESSION_COOKIE } from "./session";
import { signInWithProvider } from "./oauth-users";
import type { SessionUser } from "./types";

export type OAuthProvider = "google" | "apple";

const STATE_COOKIE = "aisle_oauth";
const STATE_MAX_AGE = 60 * 10;

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const appleKeys = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

type PendingOAuth = {
  provider: OAuthProvider;
  state: string;
  nonce: string;
  verifier: string;
  next: string;
};

export function providerConfigured(provider: OAuthProvider) {
  if (provider === "google") {
    return Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
  }
  return Boolean(process.env.AUTH_APPLE_ID);
}

export function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/login")) {
    return "/";
  }
  return value;
}

/** The site origin as users see it: AUTH_URL, else the forwarded host. */
export function publicOrigin(request: Request) {
  const configured = process.env.AUTH_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

function callbackUrl(origin: string, provider: OAuthProvider) {
  return `${origin}/api/auth/${provider}/callback`;
}

function randomToken() {
  return randomBytes(32).toString("base64url");
}

function codeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function stateCookieOptions(request: Request) {
  const secure = publicOrigin(request).startsWith("https://");
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? ("none" as const) : ("lax" as const),
    path: "/",
    maxAge: STATE_MAX_AGE,
  };
}

function readPending(request: NextRequest): PendingOAuth | null {
  const raw = request.cookies.get(STATE_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as PendingOAuth;
    if (!parsed.state || !parsed.nonce || !parsed.verifier || !parsed.provider) return null;
    return parsed;
  } catch {
    return null;
  }
}

function loginError(request: Request, code: string) {
  const response = NextResponse.redirect(new URL(`/login?error=${code}`, publicOrigin(request)));
  response.cookies.set(STATE_COOKIE, "", { ...stateCookieOptions(request), maxAge: 0 });
  return response;
}

async function finish(request: Request, user: SessionUser, next: string) {
  const token = await signSession(user);
  const response = NextResponse.redirect(new URL(next, publicOrigin(request)));
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  response.cookies.set(STATE_COOKIE, "", { ...stateCookieOptions(request), maxAge: 0 });
  return response;
}

export function beginOAuth(request: NextRequest, provider: OAuthProvider) {
  if (!providerConfigured(provider)) {
    return loginError(request, `${provider}_unavailable`);
  }
  const url = new URL(request.url);
  const pending: PendingOAuth = {
    provider,
    state: randomToken(),
    nonce: randomToken(),
    verifier: randomToken(),
    next: safeNext(url.searchParams.get("next")),
  };
  const origin = publicOrigin(request);
  const redirectUri = callbackUrl(origin, provider);
  const location =
    provider === "google"
      ? googleStartUrl(pending, redirectUri)
      : appleStartUrl(pending, redirectUri);
  const response = NextResponse.redirect(location);
  response.cookies.set(
    STATE_COOKIE,
    Buffer.from(JSON.stringify(pending)).toString("base64url"),
    stateCookieOptions(request),
  );
  return response;
}

function googleStartUrl(pending: PendingOAuth, redirectUri: string) {
  const params = new URLSearchParams({
    client_id: process.env.AUTH_GOOGLE_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: codeChallenge(pending.verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function appleStartUrl(pending: PendingOAuth, redirectUri: string) {
  const params = new URLSearchParams({
    client_id: process.env.AUTH_APPLE_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code id_token",
    response_mode: "form_post",
    scope: "name email",
    state: pending.state,
    nonce: pending.nonce,
  });
  return `https://appleid.apple.com/auth/authorize?${params}`;
}

export async function completeGoogle(request: NextRequest) {
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return loginError(request, "oauth_denied");
  const pending = readPending(request);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!pending || pending.provider !== "google" || pending.state !== state || !code) {
    return loginError(request, "oauth_state");
  }
  try {
    const idToken = await exchangeGoogleCode(code, pending.verifier, callbackUrl(publicOrigin(request), "google"));
    const identity = await verifyGoogleToken(idToken, pending.nonce);
    const user = await signInWithProvider(identity);
    return finish(request, user, pending.next);
  } catch (error) {
    console.error("[auth] google", error instanceof Error ? error.message : error);
    const email = error instanceof Error && error.message.includes("email");
    return loginError(request, email ? "oauth_email" : "oauth_failed");
  }
}

export async function completeApple(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const error = form?.get("error");
  if (typeof error === "string" && error) return loginError(request, "oauth_denied");
  const pending = readPending(request);
  const state = form?.get("state");
  const idToken = form?.get("id_token");
  if (!pending || pending.provider !== "apple" || typeof state !== "string" || pending.state !== state) {
    return loginError(request, "oauth_state");
  }
  if (typeof idToken !== "string" || !idToken) return loginError(request, "oauth_failed");
  try {
    const identity = await verifyAppleToken(idToken, pending.nonce);
    const appleUser = appleName(form?.get("user"));
    const user = await signInWithProvider({
      ...identity,
      name: identity.name ?? appleUser,
    });
    return finish(request, user, pending.next);
  } catch (error) {
    console.error("[auth] apple", error instanceof Error ? error.message : error);
    const email = error instanceof Error && error.message.includes("email");
    return loginError(request, email ? "oauth_email" : "oauth_failed");
  }
}

async function exchangeGoogleCode(code: string, verifier: string, redirectUri: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.AUTH_GOOGLE_ID ?? "",
      client_secret: process.env.AUTH_GOOGLE_SECRET ?? "",
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const json = (await response.json().catch(() => null)) as { id_token?: string } | null;
  if (!response.ok || !json?.id_token) {
    throw new Error("Google did not return an identity token.");
  }
  return json.id_token;
}

async function verifyGoogleToken(idToken: string, nonce: string) {
  const { payload } = await jwtVerify(idToken, googleKeys, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: process.env.AUTH_GOOGLE_ID,
  });
  if (payload.nonce !== nonce) throw new Error("Google sign-in nonce did not match.");
  return identityFromPayload("google", payload);
}

async function verifyAppleToken(idToken: string, nonce: string) {
  const { payload } = await jwtVerify(idToken, appleKeys, {
    issuer: "https://appleid.apple.com",
    audience: process.env.AUTH_APPLE_ID,
  });
  if (payload.nonce !== nonce) throw new Error("Apple sign-in nonce did not match.");
  return identityFromPayload("apple", payload);
}

function identityFromPayload(
  provider: OAuthProvider,
  payload: { sub?: string; email?: unknown; email_verified?: unknown; name?: unknown },
) {
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!sub) throw new Error("Provider identity was missing a subject.");
  const email = typeof payload.email === "string" ? payload.email : null;
  const verified = payload.email_verified === true || payload.email_verified === "true";
  const name = typeof payload.name === "string" ? payload.name : null;
  return { provider, sub, email, emailVerified: verified, name };
}

function appleName(raw: FormDataEntryValue | null | undefined) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as { name?: { firstName?: string; lastName?: string } };
    const name = [parsed.name?.firstName, parsed.name?.lastName].filter(Boolean).join(" ").trim();
    return name || null;
  } catch {
    return null;
  }
}
