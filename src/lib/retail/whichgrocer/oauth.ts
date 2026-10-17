/**
 * WhichGrocer signs the MCP connector in with OAuth (authorization code + PKCE).
 * There is no API key to paste. The browser visits their sign-in page, and the
 * callback stores the refresh token for the signed-in Aisle user.
 */

import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { WHICHGROCER_MCP_URL } from "./mcp";

export const WHICHGROCER_SCOPES = "whichgrocer offline_access";
export const OAUTH_COOKIE = "aisle_wg_oauth";
const ISSUER = "https://mcp.whichgrocer.com";

export type OauthMetadata = {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
};

export type OauthClient = {
  clientId: string;
  redirectUri: string;
};

export type OauthTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
};

type OauthState = {
  state: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  uid: string;
};

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set, so WhichGrocer sign-in cannot be started.");
  return new TextEncoder().encode(secret);
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function signOauthState(payload: OauthState): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secretKey());
}

export async function readOauthState(token: string): Promise<OauthState | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const state = typeof payload.state === "string" ? payload.state : "";
    const verifier = typeof payload.verifier === "string" ? payload.verifier : "";
    const redirectUri = typeof payload.redirectUri === "string" ? payload.redirectUri : "";
    const clientId = typeof payload.clientId === "string" ? payload.clientId : "";
    const uid = typeof payload.uid === "string" ? payload.uid : "";
    if (!state || !verifier || !redirectUri || !clientId || !uid) return null;
    return { state, verifier, redirectUri, clientId, uid };
  } catch {
    return null;
  }
}

export async function oauthMetadata(fetchImpl: typeof fetch = fetch): Promise<OauthMetadata> {
  const response = await fetchImpl(`${ISSUER}/.well-known/oauth-authorization-server`, {
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`WhichGrocer auth metadata failed (HTTP ${response.status}).`);
  const body = (await response.json()) as Partial<OauthMetadata>;
  if (!body.authorization_endpoint || !body.token_endpoint || !body.registration_endpoint) {
    throw new Error("WhichGrocer auth metadata is missing an endpoint.");
  }
  return {
    authorization_endpoint: body.authorization_endpoint,
    token_endpoint: body.token_endpoint,
    registration_endpoint: body.registration_endpoint,
  };
}

export async function registerClient(
  metadata: OauthMetadata,
  redirectUri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OauthClient> {
  const response = await fetchImpl(metadata.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "Aisle",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: WHICHGROCER_SCOPES,
    }),
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as { client_id?: string; error?: string } | null;
  if (!response.ok || !body?.client_id) {
    throw new Error(body?.error || `WhichGrocer client registration failed (HTTP ${response.status}).`);
  }
  return { clientId: body.client_id, redirectUri };
}

export function authorizeUrl(input: {
  metadata: OauthMetadata;
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const url = new URL(input.metadata.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", WHICHGROCER_SCOPES);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", WHICHGROCER_MCP_URL);
  return url.toString();
}

async function tokenRequest(
  tokenEndpoint: string,
  body: URLSearchParams,
  fetchImpl: typeof fetch,
): Promise<OauthTokens> {
  const response = await fetchImpl(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } | null;
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || payload?.error || `WhichGrocer token request failed (HTTP ${response.status}).`);
  }
  const expiresAt =
    typeof payload.expires_in === "number" && payload.expires_in > 0
      ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
      : null;
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt,
  };
}

export async function exchangeCode(input: {
  metadata: OauthMetadata;
  clientId: string;
  redirectUri: string;
  code: string;
  verifier: string;
  fetchImpl?: typeof fetch;
}): Promise<OauthTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.verifier,
    resource: WHICHGROCER_MCP_URL,
  });
  return tokenRequest(input.metadata.token_endpoint, body, input.fetchImpl ?? fetch);
}

export async function refreshAccessToken(input: {
  metadata: OauthMetadata;
  clientId: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<OauthTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    resource: WHICHGROCER_MCP_URL,
  });
  return tokenRequest(input.metadata.token_endpoint, body, input.fetchImpl ?? fetch);
}

export function issuerMatches(iss: string | null): boolean {
  return iss == null || iss === "" || iss === ISSUER;
}

export function whichgrocerSettingsUrl(origin: string, status: string, message?: string): URL {
  const url = new URL("/settings", origin);
  url.searchParams.set("whichgrocer", status);
  if (message) url.searchParams.set("message", message.slice(0, 180));
  url.hash = "connections";
  return url;
}

export function oauthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.VERCEL === "1" || process.env.NODE_ENV === "production",
    path: "/api/whichgrocer",
    maxAge: 60 * 10,
  };
}
