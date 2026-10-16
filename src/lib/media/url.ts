import type { MediaGeneration } from "./pr2-types";

const STORED_PREFIX = "aisle-media:";

/**
 * The browser URL for a saved take. ComfyUI outputs and stored cloud media are
 * both served by the owner-checked asset route; a provider link is never stored.
 */
export function campaignMediaUrl(campaignId: string | undefined, assetId: string, generation?: MediaGeneration) {
  if (!generation?.url) return undefined;
  const stored = generation.url.startsWith(STORED_PREFIX);
  // Stored bytes are only reachable through the route; without a campaign there is no URL.
  if (!campaignId) return stored ? undefined : generation.url;
  if (!stored && generation.provider !== "ComfyUI") return generation.url;
  return `/api/studio/assets/${encodeURIComponent(campaignId)}/${generation.kind}/${encodeURIComponent(assetId)}?v=${encodeURIComponent(generation.at)}`;
}
