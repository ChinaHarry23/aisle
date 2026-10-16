import type { ArtDirection } from "./art-direction";

export type MediaKind = "image" | "video";

export type ProviderId =
  | "openai"
  | "google"
  | "bfl"
  | "ideogram"
  | "recraft"
  | "xai"
  | "bytedance"
  | "tencent"
  | "alibaba"
  | "stability"
  | "luma"
  | "runway"
  | "kling"
  | "minimax"
  | "pika"
  | "krea"
  | "amazon"
  | "comfy";

export type AspectRatio = "1:1" | "4:5" | "3:4" | "16:9" | "9:16";

export type Billing =
  | {
      mode: "tokens";
      textInPerM: number;
      imageOutPerM: number;
      estOutTokens: number;
    }
  | { mode: "per_image"; usd: number; estOutTokens: number }
  | { mode: "per_mp"; usdPerMp: number; megapixels: number; estOutTokens: number }
  | { mode: "per_second"; usdPerSec: number; estTokensPerSec: number };

export type MediaModel = {
  id: string;
  providerId: ProviderId;
  provider: string;
  name: string;
  apiModel: string;
  kind: MediaKind;
  blurb: string;
  bestFor: string;
  envKeys: string[];
  endpoint: string;
  estimateLabel: string;
  billing: Billing;
  notes?: string;
  /** Local LTX uses text-to-video; existing video models retain the poster-input path. */
  videoInput?: "text" | "image";
  /** Clip lengths the model accepts, in seconds. Omitted: 5–15 (ComfyUI MiniMax). */
  durations?: number[];
  /** Provider shutdown date, shown in pickers so nobody builds on a dying model. */
  sunset?: string;
  /** Real cost comes from the provider's token usage, so a credit hold carries a buffer. */
  usageBilled?: boolean;
  /**
   * No hard length control: the length is only asked for in the prompt, so a
   * clip can come back as long as the longest listed duration (Omni Flash).
   */
  promptLength?: boolean;
};

export type UsageMeter = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  units: number;
  unitLabel: string;
  costUsd: number;
  billedAs: string;
  latencyMs: number;
  estimate: boolean;
};

export type MediaGeneration = {
  kind: MediaKind;
  modelId: string;
  provider: string;
  modelName: string;
  /** `no_credits`: a cloud render the user could not pay for, so nothing was sent. */
  status: "stubbed" | "ok" | "unconfigured" | "error" | "no_credits";
  usage: UsageMeter;
  url?: string | null;
  note: string;
  at: string;
  /** Provenance for a real image-to-video run, not a text-only fallback. */
  sourceImageUrl?: string;
  inputImageSha256?: string;
  promptId?: string;
  videoMode?: "text-to-video" | "image-to-video";
  resolution?: { width: number; height: number };
  frameRate?: number;
  /** Actual frame-grid duration, rather than the requested rounded clip length. */
  durationSec?: number;
  /** Aspect ratio actually rendered, which a cloud video model may choose for us. */
  aspect?: AspectRatio;
  /** Server-authored creative plan and actual planning model/usage; separate from rendering. */
  artDirection?: ArtDirection;
  composition?: {
    renderMs: number;
    editingMs: number;
    reusedClips: number;
    shots: { label: string; durationSec: number; promptId?: string; sourceImageUrl?: string; inputImageSha256?: string; generationMs: number; reused: boolean; kind?: "scene" | "end-card"; startSec?: number }[];
  };
};

export type AdVideo = {
  id: string;
  version: number;
  title: string;
  prompt: string;
  durationSec: number;
  aspect: AspectRatio;
  status: "draft" | "ready" | "failed";
  generation: MediaGeneration;
};

export type StudioRun = {
  id: string;
  at: string;
  kind: MediaKind;
  modelId: string;
  label: string;
  costUsd: number;
  totalTokens: number;
};

export type GenerateRequest = {
  kind: MediaKind;
  modelId: string;
  prompt: string;
  aspectRatio?: AspectRatio;
  durationSec?: number;
  quality?: "low" | "medium" | "high";
  /** Poster URL used as the first frame of a MiniMax ad video. */
  startImageUrl?: string;
  campaignId?: string;
  creativeId?: string;
  /** Account that owns media a cloud provider returns; its reads are checked against this. */
  ownerId?: string;
  /** Optional user example. The server treats it as inspiration, not executable instructions. */
  styleReference?: string;
};

export type GenerateResult = MediaGeneration;
