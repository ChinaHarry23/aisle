/**
 * Which cloud media providers Aisle can actually call.
 *
 * A provider is usable only when (a) it has an adapter here, (b) the owner has
 * set its key in the server env, and (c) AISLE_MEDIA_PROVIDERS, when set, lists
 * it. Everything else in the catalog shows as "not available". A new provider
 * joins by adding an adapter with offline fake-server tests and a live smoke run
 * (`scripts/provider-smoke.ts`).
 */
import type { ProviderId } from "../types";
import { comfyReachable } from "../comfy";
import { alibabaAdapter } from "./alibaba";
import { bytedanceAdapter } from "./bytedance";
import { envValue } from "./http";
import { googleAdapter } from "./google";
import { openaiAdapter } from "./openai";
import { tencentAdapter } from "./tencent";
import type { MediaProviderAdapter } from "./types";

export type { MediaProviderAdapter, ProviderContext, ProviderOutput } from "./types";

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
  if (providerId === "comfy") return false;
  const adapter = MEDIA_ADAPTERS[providerId];
  return Boolean(adapter && providerKeysSet(adapter) && allowlisted(providerId));
}

export type ProviderAvailability = { id: ProviderId; usable: boolean; reason?: string };

/** Why a cloud provider is or is not usable, without naming a key or its value. Use `comfyAvailability` for ComfyUI. */
export function providerAvailability(providerId: ProviderId): ProviderAvailability {
  if (providerId === "comfy") return { id: providerId, usable: true, reason: "Local ComfyUI, free" };
  const adapter = MEDIA_ADAPTERS[providerId];
  if (!adapter) return { id: providerId, usable: false, reason: "Not available: no tested integration yet" };
  if (!allowlisted(providerId)) return { id: providerId, usable: false, reason: "Not available: turned off on this server" };
  if (!providerKeysSet(adapter)) return { id: providerId, usable: false, reason: "Not available: not configured on this server" };
  return { id: providerId, usable: true };
}

const COMFY_PROBE_MS = 30_000;
let comfyProbe: { at: number; reachable: Promise<boolean> } | null = null;

/**
 * Whether local ComfyUI answers from this server (a hosted deployment has
 * none). The probe is remembered for 30 s so every Studio mount does not open
 * a socket. `usableProvider("comfy")` stays false: it only speaks for cloud
 * adapters, and runGeneration treats ComfyUI separately.
 */
export async function comfyAvailability(): Promise<ProviderAvailability> {
  const now = Date.now();
  if (!comfyProbe || now - comfyProbe.at > COMFY_PROBE_MS) comfyProbe = { at: now, reachable: comfyReachable() };
  const reachable = await comfyProbe.reachable;
  return reachable
    ? { id: "comfy", usable: true, reason: "Local ComfyUI, free" }
    : { id: "comfy", usable: false, reason: "Not available: ComfyUI is not reachable from this server" };
}

/** Forget the remembered ComfyUI probe (tests, or after starting ComfyUI). */
export function resetComfyProbe() {
  comfyProbe = null;
}
