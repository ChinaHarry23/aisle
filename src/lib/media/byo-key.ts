import { getModel } from "./catalog";
import type { ProviderId } from "./types";

/**
 * Bring-your-own keys live only in this browser (their own localStorage entry,
 * deliberately outside the persisted workspace settings so they never sync).
 * They travel to the server per request in a header and are never stored there.
 */
const storageKey = (provider: ProviderId) => `aisle-byo-key:${provider}`;

export function getByoKey(provider: ProviderId): string {
  try {
    return localStorage.getItem(storageKey(provider)) ?? "";
  } catch {
    return "";
  }
}

export function setByoKey(provider: ProviderId, key: string) {
  try {
    if (key) localStorage.setItem(storageKey(provider), key);
    else localStorage.removeItem(storageKey(provider));
  } catch {
    // storage unavailable (private window): key just won't persist
  }
}

/** JSON request headers plus this browser's key for the image model's provider, when one is saved. */
export function jsonHeadersWithKey(imageModelId: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const key = getByoKey(getModel(imageModelId).providerId);
    if (key) headers["x-provider-key"] = key;
  } catch {
    // An unknown catalogue entry still lets the server fall back to its own key.
  }
  return headers;
}
