/**
 * Extra media fields introduced by PR #2. Cindy's `media/types.ts` is restored
 * exactly, so PR #2 modules read these through this widening helper.
 */
import type { GenerateRequest, MediaGeneration, MediaModel } from "./types";

export type Pr2MediaModel = MediaModel & {
  videoInput?: "text" | "image";
  durations?: number[];
  sunset?: string;
  promptLength?: boolean;
  usageBilled?: boolean;
};

export type Pr2MediaGeneration = MediaGeneration & {
  promptId?: string;
  sourceImageUrl?: string;
  inputImageSha256?: string;
  videoMode?: "text-to-video" | "image-to-video";
  resolution?: { width: number; height: number };
  frameRate?: number;
  durationSec?: number;
  aspect?: string;
  artDirection?: unknown;
  composition?: {
    renderMs: number;
    editingMs: number;
    reusedClips: number;
    shots: unknown[];
  };
};

export type Pr2GenerateRequest = GenerateRequest & {
  startImageUrl?: string;
  ownerId?: string;
  styleReference?: string;
  campaignId?: string;
  creativeId?: string;
};

export function asPr2Model(model: MediaModel): Pr2MediaModel {
  return model;
}

export function asPr2Gen(generation: MediaGeneration): Pr2MediaGeneration {
  return generation;
}

export function asPr2Req(req: GenerateRequest): Pr2GenerateRequest {
  return req;
}

export function toGen(generation: Pr2MediaGeneration): MediaGeneration {
  return generation;
}
