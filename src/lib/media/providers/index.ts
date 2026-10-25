/**
 * Which cloud media providers Aisle can actually call.
 *
 * A provider is usable only when (a) it has an adapter here, (b) the owner has
 * set its key in the server env, and (c) AISLE_MEDIA_PROVIDERS, when set, lists
 * it. Everything else in the catalog shows as "not available". A new provider
 * joins by adding an adapter with offline fake-server tests and a live smoke run
 * (`scripts/provider-smoke.ts`).
 */
import type { ProviderId } from "../pr2-types";
import { alibabaAdapter } from "./alibaba";
import { bytedanceAdapter } from "./bytedance";
import { envValue } from "./http";
import { googleAdapter } from "./google";
import { openaiAdapter } from "./openai";
import { tencentAdapter } from "./tencent";
import type { MediaProviderAdapter } from "./types";

export const MEDIA_ADAPTERS: Partial<Record<ProviderId, MediaProviderAdapter>> = {
  openai: openaiAdapter,
  google: googleAdapter,
  bytedance: bytedanceAdapter,
  tencent: tencentAdapter,
  alibaba: alibabaAdapter,
};

/** Every `keyEnv` entry must be set; an entry written `A|B` accepts either variable. */
export function providerKeysSet(adapter: MediaProviderAdapter) {
  return adapter.keyEnv.every((entry) => Boolean(envValue(entry)));
}

function allowlisted(providerId: ProviderId) {
  const list = process.env.AISLE_MEDIA_PROVIDERS?.trim();
  if (!list) return true;
  return list.split(",").map((p) => p.trim().toLowerCase()).includes(providerId);
}

export function usableProvider(providerId: ProviderId): boolean {
  const adapter = MEDIA_ADAPTERS[providerId];
  return Boolean(adapter && providerKeysSet(adapter) && allowlisted(providerId));
}

type ProviderAvailability = { id: ProviderId; usable: boolean; reason?: string };

/** Why a cloud provider is or is not usable, without naming a key or its value. */
export function providerAvailability(providerId: ProviderId): ProviderAvailability {
  if (providerId === "comfy") return { id: providerId, usable: true, reason: "Local ComfyUI, free" };
  const adapter = MEDIA_ADAPTERS[providerId];
  if (!adapter) return { id: providerId, usable: false, reason: "Not available: no tested integration yet" };
  if (!allowlisted(providerId)) return { id: providerId, usable: false, reason: "Not available: turned off on this server" };
  if (!providerKeysSet(adapter)) return { id: providerId, usable: false, reason: "Not available: not configured on this server" };
  return { id: providerId, usable: true };
}
