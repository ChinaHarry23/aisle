/**
 * The contract every cloud media provider implements. An adapter turns one
 * GenerateRequest into verified bytes plus what the call really cost; storing
 * and provenance are the caller's job (`renderCampaignPoster` in
 * campaign-poster.ts), not the adapter's.
 */
import type { AspectRatio, GenerateRequest, MediaModel, ProviderId } from "../pr2-types";

export type ProviderOutput = { bytes: Buffer; mime: "image/png"|"image/jpeg"|"image/webp"|"video/mp4"; costUsd: number; jobId: string; durationSec?: number; aspect?: AspectRatio; inputTokens?: number; outputTokens?: number; note?: string };
export type ProviderContext = {
  model: MediaModel;
  startImage?: { bytes: Buffer; mime: string; sha256: string };
  /** A key the founder typed in this browser. Server env is used when this is absent. */
  apiKey?: string;
  onQueued?: (jobId: string) => void;
  signal?: AbortSignal;
};
export type MediaProviderAdapter = { id: ProviderId; keyEnv: string[]; generate: (req: GenerateRequest, ctx: ProviderContext) => Promise<ProviderOutput> };
