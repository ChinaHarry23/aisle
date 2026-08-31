export type MediaKind = "image" | "video";

export type ProviderId =
  | "openai"
  | "google"
  | "bfl"
  | "ideogram"
  | "recraft"
  | "xai"
  | "bytedance"
  | "alibaba"
  | "stability"
  | "luma"
  | "runway"
  | "kling"
  | "minimax"
  | "pika"
  | "krea"
  | "amazon";

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
  status: "stubbed" | "ok" | "unconfigured" | "error";
  usage: UsageMeter;
  url?: string | null;
  note: string;
  at: string;
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
};

export type GenerateResult = MediaGeneration;
