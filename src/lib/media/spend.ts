import type { Campaign } from "@/lib/types";
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from "./catalog";

export function withStudioDefaults(campaign: Campaign): Campaign {
  return {
    ...campaign,
    imageModelId: campaign.imageModelId ?? DEFAULT_IMAGE_MODEL,
    videoModelId: campaign.videoModelId ?? DEFAULT_VIDEO_MODEL,
    videoDurationSec: campaign.videoDurationSec ?? 8,
    videos: campaign.videos ?? [],
    studioHistory: campaign.studioHistory ?? [],
    studioBusy: campaign.studioBusy ?? null,
  };
}

export function studioSpend(campaign: Campaign) {
  const poster = (campaign.creatives ?? []).reduce(
    (n, cr) => n + (cr.generation?.usage.costUsd ?? 0),
    0,
  );
  const video = (campaign.videos ?? []).reduce(
    (n, v) => n + (v.generation.usage.costUsd ?? 0),
    0,
  );
  const history = (campaign.studioHistory ?? []).reduce((n, r) => n + r.costUsd, 0);
  return { poster, video, history, total: poster + video };
}
