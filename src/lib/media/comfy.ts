/**
 * Local ComfyUI media.
 *
 * Posters use the official Z-Image Turbo text-to-image graph (8 steps).
 * Ad videos use the official MiniMax H3 graph already installed with the
 * video weights: a required generated poster as the first frame, plus the turbo LoRA
 * when that file is present.
 */

import type { AspectRatio, GenerateRequest, GenerateResult } from "./pr2-types";
import { randomUUID } from "node:crypto";
import { readMedia } from "./store";

export class ComfyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComfyUnavailableError";
  }
}

export type PromptNode = { class_type: string; inputs: Record<string, unknown> };
type SavedFile = { filename: string; subfolder: string; type: string };

const IMAGE_UNET = "z_image_turbo_bf16.safetensors";
const IMAGE_CLIP = "qwen_3_4b.safetensors";
const IMAGE_VAE = "ae.safetensors";
const VIDEO_UNET = "minimax_h3_fl2va_pruned_int8_convrot.safetensors";
const VIDEO_CLIP = "qwen3vl_32b_minimax_h3_bf16.safetensors";
const VIDEO_VAE = "minimax_h3_video_vae_fp16.safetensors";
const AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors";
const VIDEO_LORA = "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors";

function comfyBase() {
  return (process.env.COMFYUI_URL || "http://127.0.0.1:8188").replace(/\/$/, "");
}

function envName(key: string) {
  const value = process.env[key]?.trim();
  return value || undefined;
}

export async function comfyGet<T>(path: string): Promise<T> {
  const res = await fetch(`${comfyBase()}${path}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`ComfyUI ${path} returned ${res.status}`);
  return (await res.json()) as T;
}

export async function comfyReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${comfyBase()}/system_stats`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listed(folder: string): Promise<string[]> {
  const names = await comfyGet<string[]>(`/models/${folder}`).catch(() => [] as string[]);
  return names.filter((name) => name && !name.startsWith("."));
}

function pick(names: string[], preferred: string | undefined, fallbacks: string[]) {
  if (preferred && names.includes(preferred)) return preferred;
  for (const name of fallbacks) {
    if (names.includes(name)) return name;
  }
  return undefined;
}

function posterSize(aspect: AspectRatio | undefined): { width: number; height: number } {
  switch (aspect) {
    case "1:1":
      return { width: 1024, height: 1024 };
    case "9:16":
      return { width: 768, height: 1344 };
    case "16:9":
      return { width: 1344, height: 768 };
    case "3:4":
      return { width: 896, height: 1152 };
    default:
      return { width: 832, height: 1024 };
  }
}

function videoSize(aspect: AspectRatio | undefined): { width: number; height: number } {
  switch (aspect) {
    case "16:9":
      return { width: 1344, height: 768 };
    case "1:1":
      return { width: 768, height: 768 };
    case "4:5":
      return { width: 768, height: 960 };
    case "3:4":
      return { width: 768, height: 1024 };
    default:
      return { width: 768, height: 1344 };
  }
}

/** MiniMax H3 frame count: 24 fps, snapped onto the 17k+5 grid. */
function minimaxFrames(durationSec: number) {
  const frames = Math.max(5, Math.round(Math.min(durationSec, 15) * 24));
  const bump = (((5 - (frames % 17)) % 17) + 17) % 17;
  return Math.min(362, frames + bump);
}

function seed() {
  return Math.floor(Math.random() * 1_000_000_000);
}

function zImageWorkflow(prompt: string, width: number, height: number, weights: {
  unet: string;
  clip: string;
  vae: string;
}): Record<string, PromptNode> {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: weights.unet, weight_dtype: "default" } },
    "2": {
      class_type: "CLIPLoader",
      inputs: { clip_name: weights.clip, type: "lumina2", device: "default" },
    },
    "3": { class_type: "VAELoader", inputs: { vae_name: weights.vae } },
    "4": { class_type: "ModelSamplingAuraFlow", inputs: { model: ["1", 0], shift: 3 } },
    "5": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["2", 0] } },
    "6": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["5", 0] } },
    "7": {
      class_type: "EmptySD3LatentImage",
      inputs: { width, height, batch_size: 1 },
    },
    "8": {
      class_type: "KSampler",
      inputs: {
        seed: seed(),
        steps: 8,
        cfg: 1,
        sampler_name: "res_multistep",
        scheduler: "simple",
        denoise: 1,
        model: ["4", 0],
        positive: ["5", 0],
        negative: ["6", 0],
        latent_image: ["7", 0],
      },
    },
    "9": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } },
    "10": { class_type: "SaveImage", inputs: { filename_prefix: "aisle/poster", images: ["9", 0] } },
  };
}

function minimaxWorkflow(
  prompt: string,
  width: number,
  height: number,
  frames: number,
  weights: { unet: string; clip: string; vae: string; audio: string; lora?: string },
  startImage: string,
): Record<string, PromptNode> {
  const turbo = Boolean(weights.lora);
  const graph: Record<string, PromptNode> = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: weights.unet, weight_dtype: "default" } },
    "2": {
      class_type: "CLIPLoader",
      inputs: { clip_name: weights.clip, type: "minimax", device: "default" },
    },
    "3": { class_type: "VAELoader", inputs: { vae_name: weights.vae } },
    "4": { class_type: "VAELoader", inputs: { vae_name: weights.audio } },
    "7": { class_type: "KSamplerSelect", inputs: { sampler_name: "res_multistep" } },
    "8": { class_type: "RandomNoise", inputs: { noise_seed: seed() } },
    "11": { class_type: "VAEDecode", inputs: { samples: ["10", 0], vae: ["3", 0] } },
    "12": { class_type: "VAEDecodeAudio", inputs: { samples: ["10", 0], vae: ["4", 0] } },
    "13": {
      class_type: "CreateVideo",
      inputs: { images: ["11", 0], audio: ["12", 0], fps: 24, bit_depth: 8 },
    },
    "14": {
      class_type: "SaveVideo",
      inputs: {
        video: ["13", 0],
        filename_prefix: "aisle/ad",
        format: "auto",
        codec: "auto",
      },
    },
  };

  const model: [string, number] = turbo ? ["5", 0] : ["1", 0];
  if (turbo) {
    graph["5"] = {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: ["1", 0], lora_name: weights.lora, strength_model: 1 },
    };
  }
  graph["6"] = {
    class_type: "BasicScheduler",
    inputs: { model, scheduler: "simple", steps: turbo ? 6 : 20, denoise: 1 },
  };
  graph["9"] = {
    class_type: "BasicGuider",
    inputs: { model, conditioning: ["15", 0] },
  };
  graph["10"] = {
    class_type: "SamplerCustomAdvanced",
    inputs: {
      noise: ["8", 0],
      guider: ["9", 0],
      sampler: ["7", 0],
      sigmas: ["6", 0],
      latent_image: ["15", 1],
    },
  };
  graph["15"] = {
    class_type: "MiniMaxH3ImageToVideo",
    inputs: {
      clip: ["2", 0],
      vae: ["3", 0],
      prompt,
      width,
      height,
      length: frames,
      first_frame: ["17", 0],
    },
  };
  graph["16"] = { class_type: "LoadImage", inputs: { image: startImage } };
  // The native MiniMax node stretches its first frame. Fit it before conditioning
  // so a portrait source does not become a horizontally stretched TV image.
  graph["17"] = { class_type: "ImageScale", inputs: { image: ["16", 0], upscale_method: "lanczos", width, height, crop: "center" } };
  return graph;
}

export async function submit(prompt: Record<string, PromptNode>) {
  const submitted = await fetch(`${comfyBase()}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
    signal: AbortSignal.timeout(30_000),
  });
  const queued = (await submitted.json().catch(() => null)) as {
    prompt_id?: string;
    error?: unknown;
    node_errors?: unknown;
  } | null;
  if (!submitted.ok || !queued?.prompt_id) {
    const detail = queued?.node_errors
      ? JSON.stringify(queued.node_errors).slice(0, 400)
      : queued?.error
        ? JSON.stringify(queued.error).slice(0, 400)
        : `HTTP ${submitted.status}`;
    throw new Error(`ComfyUI rejected the graph (${detail}).`);
  }
  return queued.prompt_id;
}

export async function waitForFile(promptId: string, timeoutMs: number, label: string, failOnRendererLoss = false): Promise<SavedFile> {
  const deadline = Date.now() + timeoutMs;
  let unavailableSince: number | undefined;
  let missingSince: number | undefined;
  let lastQueueCheck = Date.now();
  while (Date.now() < deadline) {
    let history: Record<
      string,
      {
        status?: { status_str?: string; messages?: unknown };
        outputs?: Record<string, { images?: SavedFile[]; videos?: SavedFile[]; gifs?: SavedFile[] }>;
      }
    > | null = null;
    try {
      history = await comfyGet(`/history/${promptId}`);
      unavailableSince = undefined;
    } catch {
      history = null;
      unavailableSince ??= Date.now();
      if (failOnRendererLoss && Date.now() - unavailableSince > 30_000) throw new Error(`The local renderer stopped responding during ${label}. The accepted job ${promptId} is retained; no automatic resubmission or model fallback was made.`);
    }
    const entry = history?.[promptId];
    const files = Object.values(entry?.outputs ?? {}).flatMap((output) => [
      ...(output.images ?? []),
      ...(output.videos ?? []),
      ...(output.gifs ?? []),
    ]);
    const file = files.find((item) => item.filename);
    if (file) return file;
    if (entry?.status?.status_str === "error") {
      const messages = entry.status.messages as [string, { exception_message?: string }][] | undefined;
      const detail = messages?.find(m => m[0] === "execution_error")?.[1]?.exception_message?.slice(0, 800) ?? "execution error";
      throw new Error(`ComfyUI failed while rendering the ${label} (${detail}).`);
    }
    if (failOnRendererLoss && history && !entry && Date.now() - lastQueueCheck >= 15_000) {
      lastQueueCheck = Date.now();
      const queue = await comfyGet<{ queue_running?: [number, string][]; queue_pending?: [number, string][] }>("/queue").catch(() => null);
      if (queue) {
        const present = [...(queue.queue_running ?? []), ...(queue.queue_pending ?? [])].some(item => item[1] === promptId);
        if (present) missingSince = undefined;
        else {
          missingSince ??= Date.now();
          if (Date.now() - missingSince >= 30_000) throw new Error(`The renderer lost accepted job ${promptId} during ${label}, possibly after a restart. The production stopped safely without regenerating.`);
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`ComfyUI did not finish the ${label} within ${Math.round(timeoutMs / 60000)} minutes.`);
}

export function viewUrl(file: SavedFile) {
  const params = new URLSearchParams({
    filename: file.filename,
    type: file.type || "output",
    subfolder: file.subfolder || "",
  });
  return `${comfyBase()}/view?${params}`;
}

export function result(
  req: GenerateRequest,
  started: number,
  modelName: string,
  url: string,
  note: string,
): GenerateResult {
  return {
    kind: req.kind,
    modelId: req.modelId.startsWith("comfy:") ? req.modelId : req.kind === "video" ? "comfy:minimax-h3" : "comfy:local",
    provider: "ComfyUI",
    modelName,
    status: "ok",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      units: 1,
      unitLabel: req.kind,
      costUsd: 0,
      billedAs: "local ComfyUI",
      latencyMs: Date.now() - started,
      estimate: false,
    },
    url,
    note,
    at: new Date().toISOString(),
  };
}

export async function requireServer() {
  if (!(await comfyReachable())) {
    throw new ComfyUnavailableError(
      `ComfyUI is not running at ${comfyBase()}. Start it, or set COMFYUI_URL.`,
    );
  }
}

export async function generateComfyImage(req: GenerateRequest, onQueued?: (promptId: string) => void): Promise<GenerateResult> {
  const started = Date.now();
  await requireServer();
  const [unets, clips, vaes] = await Promise.all([
    listed("diffusion_models"),
    listed("text_encoders"),
    listed("vae"),
  ]);
  const unet = pick(unets, envName("COMFYUI_IMAGE_UNET"), [IMAGE_UNET]);
  const clip = pick(clips, envName("COMFYUI_IMAGE_CLIP"), [IMAGE_CLIP]);
  const vae = pick(vaes, envName("COMFYUI_IMAGE_VAE"), [IMAGE_VAE]);
  if (!unet || !clip || !vae) {
    throw new Error(
      `ComfyUI has no text-to-image weights yet. Z-Image Turbo needs ${IMAGE_UNET}, ${IMAGE_CLIP}, and ${IMAGE_VAE}. The video weights already on disk cannot render a still.`,
    );
  }
  const { width, height } = posterSize(req.aspectRatio);
  const promptId = await submit(zImageWorkflow(req.prompt, width, height, { unet, clip, vae }));
  onQueued?.(promptId);
  const file = await waitForFile(promptId, 10 * 60_000, "poster");
  return { ...result(req, started, "Z-Image Turbo", viewUrl(file), `Local ComfyUI · Z-Image Turbo · ${unet}`), promptId };
}

/** The poster may be a local ComfyUI output or a stored cloud poster owned by `ownerId`. */
export async function uploadStartFrame(url: string | undefined, ownerId = ""): Promise<{ name: string; sha256: string }> {
    if (!url) throw new Error("Image-to-video requires a generated campaign image. Generate or select a poster first.");
    const { bytes, mime: type, sha256 } = await readMedia(url, "image", ownerId);
    const form = new FormData();
    const extension = type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png";
    form.append("image", new Blob([new Uint8Array(bytes)], { type }), `aisle-start-${randomUUID()}.${extension}`);
    form.append("overwrite", "false");
    const uploaded = await fetch(`${comfyBase()}/upload/image`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await uploaded.json().catch(() => null)) as { name?: string; subfolder?: string } | null;
    if (!uploaded.ok || !body?.name) throw new Error("MiniMax first-frame upload failed; text-to-video fallback is disabled.");
    return { name: body.subfolder ? `${body.subfolder}/${body.name}` : body.name, sha256 };
}

export async function generateComfyVideo(req: GenerateRequest, onQueued?: (promptId: string) => void): Promise<GenerateResult> {
  const started = Date.now();
  if (!Number.isFinite(req.durationSec ?? 8) || (req.durationSec ?? 8) < 5 || (req.durationSec ?? 8) > 15) throw new Error("MiniMax clips must be 5–15 seconds. Longer ads require an edited sequence, not silent truncation.");
  if (!req.startImageUrl) throw new Error("MiniMax image-to-video requires a generated campaign image.");
  await requireServer();
  const [unets, clips, vaes, loras] = await Promise.all([
    listed("diffusion_models"),
    listed("text_encoders"),
    listed("vae"),
    listed("loras"),
  ]);
  const stats = await comfyGet<{ devices?: { type?: string }[] }>("/system_stats");
  const metal = stats.devices?.some(device => device.type === "mps");
  // The INT8 convrot checkpoint requires aten::_int_mm, unavailable on MPS.
  const unet = pick(unets, envName("COMFYUI_VIDEO_UNET"), metal
    ? ["minimax_h3_fl2va_pruned_bf16.safetensors"]
    : [VIDEO_UNET, "minimax_h3_fl2va_pruned_bf16.safetensors"]);
  const clip = pick(clips, envName("COMFYUI_VIDEO_CLIP"), [
    VIDEO_CLIP,
    "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  ]);
  const vae = pick(vaes, envName("COMFYUI_VIDEO_VAE"), [VIDEO_VAE]);
  const audio = pick(vaes, envName("COMFYUI_AUDIO_VAE"), [AUDIO_VAE]);
  const turboOff = envName("COMFYUI_VIDEO_TURBO") === "0";
  const lora = turboOff ? undefined : pick(loras, envName("COMFYUI_VIDEO_LORA"), [VIDEO_LORA]);
  if (!unet || !clip || !vae || !audio) {
    throw new Error(
      "ComfyUI is missing MiniMax H3 video weights (diffusion model, Qwen3-VL text encoder, video VAE, audio VAE).",
    );
  }
  const { width, height } = videoSize(req.aspectRatio);
  const frames = minimaxFrames(req.durationSec ?? 8);
  const startImage = await uploadStartFrame(req.startImageUrl, req.ownerId);
  const promptId = await submit(
    minimaxWorkflow(req.prompt, width, height, frames, { unet, clip, vae, audio, lora }, startImage.name),
  );
  onQueued?.(promptId);
  const file = await waitForFile(promptId, 90 * 60_000, "ad video");
  const mode = lora ? "turbo 6-step" : "20-step";
  return { ...result(
    req,
    started,
    "MiniMax H3",
    viewUrl(file),
    `Local ComfyUI · MiniMax H3 ${mode} · ${frames} frames from the campaign image`,
  ), sourceImageUrl: req.startImageUrl, inputImageSha256: startImage.sha256, promptId };
}
