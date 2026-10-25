/**
 * WhichGrocer shelf prices, looked up with the server WHICHGROCER_API_KEY.
 * The key stays on the server and is never written into the workspace document.
 */

import { loadCatalogue, whichGrocerApiKey, WhichGrocerApiError } from "./api";
import { comparisonOffers, describeShelf, shelfQuery, type ShelfOffer } from "./query";

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
 * Live catalogue prices for one product. The server key in WHICHGROCER_API_KEY
 * is the credential. A missing key records the gap and does not call the API.
 */
export async function lookupShelfPrices(
  input: {
    product: string;
    category: string;
    country: string;
    at: string;
    query?: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<ShelfLookup> {
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
  if (!whichGrocerApiKey()) {
    return { ok: false, kind: "not_connected", reason: "WhichGrocer API key is not set." };
  }

  let found: ShelfOffer[];
  try {
    found = await loadCatalogue(query, fetchImpl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "WhichGrocer did not answer.";
    const rejected = error instanceof WhichGrocerApiError && (error.status === 401 || error.status === 403);
    return {
      ok: false,
      kind: rejected ? "not_connected" : "unavailable",
      reason: (rejected ? "WhichGrocer rejected the API key." : reason).slice(0, 180),
    };
  }

  const offers = comparisonOffers(found, query).slice(0, 4);
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
