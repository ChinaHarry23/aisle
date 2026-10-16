/**
 * PR #2 media types, widened over Cindy's `media/types.ts` (restored exactly).
 * PR #2-only modules import from here; her Studio/catalog keep using `./types`.
 */
import type { ArtDirection } from "./art-direction";
import type {
  AdVideo as CindyAdVideo,
  AspectRatio,
  Billing,
  GenerateRequest as CindyGenerateRequest,
  MediaGeneration as CindyMediaGeneration,
  MediaKind,
  MediaModel as CindyMediaModel,
  ProviderId as CindyProviderId,
  StudioRun,
  UsageMeter,
} from "./types";

export type { AspectRatio, Billing, MediaKind, StudioRun, UsageMeter };

/** PR #2 added local ComfyUI and Tencent TokenHub ids. */
export type ProviderId = CindyProviderId | "comfy" | "tencent";

export type MediaModel = Omit<CindyMediaModel, "providerId"> & {
  providerId: ProviderId;
  videoInput?: "text" | "image";
  durations?: number[];
  sunset?: string;
  usageBilled?: boolean;
  promptLength?: boolean;
};

export type MediaGeneration = CindyMediaGeneration & {
  sourceImageUrl?: string;
  inputImageSha256?: string;
  promptId?: string;
  videoMode?: "text-to-video" | "image-to-video";
  resolution?: { width: number; height: number };
  frameRate?: number;
  durationSec?: number;
  aspect?: AspectRatio;
  artDirection?: ArtDirection;
  composition?: {
    renderMs: number;
    editingMs: number;
    reusedClips: number;
    shots: {
      label: string;
      durationSec: number;
      promptId?: string;
      sourceImageUrl?: string;
      inputImageSha256?: string;
      generationMs: number;
      reused: boolean;
      kind?: "scene" | "end-card";
      startSec?: number;
    }[];
  };
};

export type AdVideo = Omit<CindyAdVideo, "generation"> & { generation: MediaGeneration };

export type GenerateRequest = CindyGenerateRequest & {
  startImageUrl?: string;
  campaignId?: string;
  creativeId?: string;
  ownerId?: string;
  styleReference?: string;
};

export type GenerateResult = MediaGeneration;
