/** Process-local, bounded TTL cache. Public provider results only; no uploads,
 * audience notes, billing identities or credentials are stored in keys/values. */
import type { ToolOutcome } from '@/lib/runtime/tools';
import { uid } from '@/lib/ids';

type Entry = { expires: number; value: ToolOutcome };
const entries = new Map<string, Entry>();
const MAX_ENTRIES = 128;
export function clearPublicResearchCache() { entries.clear(); }
export function publicCacheTtl() {
  const value = Number(process.env.TREND_PUBLIC_CACHE_TTL_MS ?? 3600000);
  return Number.isFinite(value) ? Math.max(0, Math.min(value, 3600000)) : 0;
}
export async function publicCacheKey(scope: unknown, credential: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([scope, credential])));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export function putPublicResearchCache(key: string, value: ToolOutcome) {
  const ttl = publicCacheTtl();
  if (!ttl || value.status !== 'ok' || !value.evidence.length || JSON.stringify(value).length > 100000) return;
  for (const [k, entry] of entries) if (entry.expires <= Date.now()) entries.delete(k);
  if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  entries.set(key, { expires: Date.now() + ttl, value: structuredClone(value) });
}
export function getPublicResearchCache(key: string): ToolOutcome | null {
  if (!publicCacheTtl()) return null;
  const entry = entries.get(key);
  if (!entry || entry.expires <= Date.now()) { entries.delete(key); return null; }
  const value = structuredClone(entry.value);
  const ids = new Map(value.evidence.map(e => [e.id, uid('ev')]));
  // Rebind IDs in both evidence and tool-specific data; source/fetch dates stay original.
  const rebound = JSON.parse(JSON.stringify(value), (_key, v) => typeof v === 'string' ? ids.get(v) ?? v : v) as ToolOutcome;
  rebound.usage = { provider: value.usage!.provider, cache: 'hit', credits: 0, creditsBasis: 'cache',
    originalCredits: value.usage!.credits, originalFetchedAt: value.evidence[0].fetchedAt, estimatedCostUsd: 0 };
  rebound.summary = 'Public TTL cache hit (original source/fetch dates preserved): ' + value.summary;
  return rebound;
}
