/**
 * The WhichGrocer refresh token stays in SQL, bound to the Aisle user who
 * signed in. It is never written into the workspace document the browser syncs.
 */

import { getDatabase, isDatabaseUnavailable } from "@/lib/db";
import { kvGet, kvSet } from "@/lib/db/kv";
import { WhichGrocerAuthError, WhichGrocerMcp } from "./mcp";
import {
  exchangeCode,
  oauthMetadata,
  refreshAccessToken,
  registerClient,
  type OauthClient,
  type OauthTokens,
} from "./oauth";
import { comparisonOffers, describeShelf, shelfQuery, type ShelfOffer } from "./query";

export type WhichGrocerConnection = {
  userId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  clientId: string;
  redirectUri: string;
  updatedAt: string;
};

type ConnectionRow = {
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  client_id: string;
  redirect_uri: string;
  updated_at: string;
};

const CLIENT_KEY = "whichgrocer:oauth-client";

function fromRow(row: ConnectionRow): WhichGrocerConnection {
  return {
    userId: row.user_id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    updatedAt: row.updated_at,
  };
}

export async function saveConnection(input: {
  userId: string;
  tokens: OauthTokens;
  clientId: string;
  redirectUri: string;
  previousRefreshToken?: string | null;
}): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  await db.execute(
    `insert into whichgrocer_connections
       (user_id, access_token, refresh_token, expires_at, client_id, redirect_uri, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (user_id) do update set
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       client_id = excluded.client_id,
       redirect_uri = excluded.redirect_uri,
       updated_at = excluded.updated_at`,
    [
      input.userId,
      input.tokens.accessToken,
      input.tokens.refreshToken ?? input.previousRefreshToken ?? null,
      input.tokens.expiresAt,
      input.clientId,
      input.redirectUri,
      now,
    ],
  );
}

export async function readConnection(userId: string): Promise<WhichGrocerConnection | null> {
  const db = await getDatabase();
  const rows = await db.query<ConnectionRow>(
    `select user_id, access_token, refresh_token, expires_at, client_id, redirect_uri, updated_at
     from whichgrocer_connections where user_id = $1`,
    [userId],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function deleteConnection(userId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("delete from whichgrocer_connections where user_id = $1", [userId]);
}

export async function connectionStatus(userId: string): Promise<{ connected: boolean; updatedAt: string | null }> {
  try {
    const row = await readConnection(userId);
    return { connected: Boolean(row), updatedAt: row?.updatedAt ?? null };
  } catch (error) {
    if (isDatabaseUnavailable(error)) return { connected: false, updatedAt: null };
    throw error;
  }
}

export async function clientForRedirect(redirectUri: string): Promise<{ metadata: Awaited<ReturnType<typeof oauthMetadata>>; client: OauthClient }> {
  const metadata = await oauthMetadata();
  const stored = await kvGet<OauthClient>(CLIENT_KEY);
  if (stored?.clientId && stored.redirectUri === redirectUri) return { metadata, client: stored };
  const client = await registerClient(metadata, redirectUri);
  await kvSet(CLIENT_KEY, client);
  return { metadata, client };
}

async function refreshConnection(row: WhichGrocerConnection): Promise<WhichGrocerConnection | null> {
  if (!row.refreshToken) return null;
  try {
    const metadata = await oauthMetadata();
    const tokens = await refreshAccessToken({
      metadata,
      clientId: row.clientId,
      refreshToken: row.refreshToken,
    });
    await saveConnection({
      userId: row.userId,
      tokens,
      clientId: row.clientId,
      redirectUri: row.redirectUri,
      previousRefreshToken: row.refreshToken,
    });
    return readConnection(row.userId);
  } catch {
    await deleteConnection(row.userId).catch(() => undefined);
    return null;
  }
}

export async function accessTokenFor(userId: string): Promise<string | null> {
  const row = await readConnection(userId);
  if (!row) return null;
  const stale = row.expiresAt != null && row.expiresAt <= new Date(Date.now() + 60_000).toISOString();
  if (!stale) return row.accessToken;
  const refreshed = await refreshConnection(row);
  return refreshed?.accessToken ?? null;
}

export async function storeAuthorizationCode(input: {
  userId: string;
  code: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
}): Promise<void> {
  const metadata = await oauthMetadata();
  const tokens = await exchangeCode({
    metadata,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    code: input.code,
    verifier: input.verifier,
  });
  await saveConnection({
    userId: input.userId,
    tokens,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
  });
}

export type ShelfLookup =
  | {
      ok: true;
      query: string;
      offers: ShelfOffer[];
      claim: string;
      detail: string;
      sourceRef: string;
      observedAt: string;
      summary: string;
    }
  | { ok: false; kind: "not_connected" | "outside_au" | "empty" | "unavailable"; reason: string };

/**
 * Live catalogue prices for one product. No user id means the bench and any
 * signed-out run record the gap instead of calling WhichGrocer.
 */
export async function lookupShelfPrices(input: {
  userId?: string;
  product: string;
  category: string;
  country: string;
  at: string;
  query?: string;
}): Promise<ShelfLookup> {
  const query = shelfQuery(input.query || input.product, input.category);
  if (input.country !== "AU") {
    return {
      ok: false,
      kind: "outside_au",
      reason: `WhichGrocer covers Australian retailers. This campaign is ${input.country}.`,
    };
  }
  if (!query) {
    return { ok: false, kind: "empty", reason: "The brief has no product name to price." };
  }
  if (!input.userId) {
    return { ok: false, kind: "not_connected", reason: "WhichGrocer is not connected." };
  }

  let token: string | null;
  try {
    token = await accessTokenFor(input.userId);
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return { ok: false, kind: "unavailable", reason: "The WhichGrocer connection could not be read." };
    }
    throw error;
  }
  if (!token) {
    return { ok: false, kind: "not_connected", reason: "WhichGrocer is not connected." };
  }

  const load = async (bearer: string) => new WhichGrocerMcp(bearer).search(query);
  let searched: { offers: ShelfOffer[] };
  try {
    searched = await load(token);
  } catch (error) {
    if (error instanceof WhichGrocerAuthError) {
      const row = await readConnection(input.userId);
      const refreshed = row ? await refreshConnection(row) : null;
      if (!refreshed) {
        return { ok: false, kind: "not_connected", reason: "WhichGrocer sign-in expired. Connect it again in Settings." };
      }
      try {
        searched = await load(refreshed.accessToken);
      } catch (retry) {
        const reason = retry instanceof Error ? retry.message : "WhichGrocer did not answer.";
        return { ok: false, kind: "unavailable", reason: reason.slice(0, 180) };
      }
    } else {
      const reason = error instanceof Error ? error.message : "WhichGrocer did not answer.";
      return { ok: false, kind: "unavailable", reason: reason.slice(0, 180) };
    }
  }

  const offers = comparisonOffers(searched.offers, query).slice(0, 4);
  if (offers.length === 0) {
    return {
      ok: false,
      kind: "empty",
      reason: `WhichGrocer returned no priced product for "${query}".`,
    };
  }
  const described = describeShelf(query, offers, input.at);
  return {
    ok: true,
    query,
    offers,
    ...described,
    summary: described.claim,
  };
}
