/**
 * WhichGrocer catalogue via the developer API.
 *
 * The MCP connector only accepts sign-in callbacks for Claude, ChatGPT, Cursor,
 * and localhost. Aisle calls https://api.whichgrocer.com/v2 with WHICHGROCER_API_KEY
 * instead. The key stays on the server.
 */

import { GROCERY_STORES, offersFromPayload, type ShelfOffer } from "./query";

const API_ORIGIN = "https://api.whichgrocer.com";

export class WhichGrocerApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "WhichGrocerApiError";
    this.status = status;
  }
}

export function whichGrocerApiKey(): string | null {
  const key = process.env.WHICHGROCER_API_KEY?.trim();
  return key || null;
}

function messageFrom(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return null;
}

async function getJson(
  path: string,
  query: Record<string, string>,
  fetchImpl: typeof fetch,
  onCredits?: (value: number | null) => void,
): Promise<unknown> {
  const key = whichGrocerApiKey();
  if (!key) throw new WhichGrocerApiError("WhichGrocer API key is not set.", 0);
  const url = new URL(path, API_ORIGIN);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as unknown;
  const credits = body && typeof body==='object' ? (body as {meta?:{credits_charged?:unknown}}).meta?.credits_charged : undefined;
  onCredits?.(typeof credits==='number'&&Number.isFinite(credits)&&credits>=0?credits:null);
  if (!response.ok) {
    const message = messageFrom(body) || `WhichGrocer request failed (HTTP ${response.status}).`;
    throw new WhichGrocerApiError(message, response.status);
  }
  return body;
}

/** Search the catalogue, then ask for other retailers when the first page names only one. */
export async function loadCatalogue(query: string, fetchImpl: typeof fetch = fetch, onCredits?: (value:number|null)=>void): Promise<ShelfOffer[]> {
  const searched = await getJson("/v2/products/search", { q: query, page: "1", page_size: "25" }, fetchImpl, onCredits);
  let offers = offersFromPayload(searched);
  const stores = new Set(offers.map((offer) => offer.store).filter((store) => GROCERY_STORES.has(store)));
  const anchor = offers.find((offer) => offer.id && !offer.id.includes(":"));
  if (!anchor || stores.size >= 2) return offers;
  try {
    const compared = await getJson(
      `/v2/products/${encodeURIComponent(anchor.id)}/equivalents`,
      { stores: "coles,woolworths,aldi" },
      fetchImpl,
      onCredits,
    );
    const extra = offersFromPayload(compared);
    if (extra.length > 0) offers = extra;
  } catch (error) {
    if (error instanceof WhichGrocerApiError && (error.status === 401 || error.status === 403)) throw error;
  }
  return offers;
}
