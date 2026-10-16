/** Native LTX-2.5 distilled T2V: official 8-step base + 2x latent upscale + 3-step refinement. */
import { randomUUID } from "node:crypto";
import { comfyGet, listed, requireServer, result, submit, viewUrl, waitForFile, type PromptNode } from "./comfy";
import type { GenerateRequest, GenerateResult } from "./types";

export const LTX_WEIGHTS = {
  unet: "ltx-2.5-22b-distilled-transformer-bf16.safetensors",
  clip: "gemma4-12b-with-proj-ltx-2.5-bf16.safetensors",
  video: "ltx-2.5-video-vae-bf16.safetensors",
  audio: "ltx-2.5-audio-vae-bf16.safetensors",
  upscaler: "ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
};
export const LTX_SAMPLERS = [{ node: "10", steps: 8 }, { node: "20", steps: 3 }];

export function assertLtxRuntime(stats: { devices?: { type?: string }[]; system?: { argv?: string[] } }) {
  if (stats.devices?.some(device => device.type === "mps") && !stats.system?.argv?.includes("--use-split-cross-attention")) {
    throw new Error("LTX-2.5 on this Mac requires ComfyUI's --use-split-cross-attention option to avoid the reported black-video/invalid-audio failure. Restart the local renderer with that option before trying again.");
  }
}

export function ltxWorkflow(req: GenerateRequest, seed: number): Record<string, PromptNode> {
  if (req.kind !== "video" || req.modelId !== "comfy:ltx-2.5") throw new Error("This workflow requires the LTX-2.5 video model.");
  if (req.startImageUrl) throw new Error("This LTX workflow is text-to-video; no poster is used as an input.");
  if (!req.prompt.trim()) throw new Error("LTX needs a scene description.");
  const seconds = req.durationSec ?? 5;
  if (!Number.isFinite(seconds) || seconds < 5 || seconds > 15) throw new Error("LTX clips must be 5–15 seconds in this workflow; longer ads need an edited sequence.");
  if (req.aspectRatio && req.aspectRatio !== "16:9") throw new Error("The cinematic LTX workflow currently renders 16:9 widescreen.");
  const width = req.quality === "high" ? 1920 : 1280;
  const height = req.quality === "high" ? 1088 : 768;
  const outputHeight = req.quality === "high" ? 1080 : 720;
  const frames = Math.round(seconds * 24 / 8) * 8 + 1;
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: LTX_WEIGHTS.unet, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: LTX_WEIGHTS.clip, type: "ltxv", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: LTX_WEIGHTS.video } },
    "4": { class_type: "VAELoader", inputs: { vae_name: LTX_WEIGHTS.audio } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: req.prompt } },
    "6": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: "cartoon, animation, CGI, plastic skin, waxy face, anatomical distortion, extra fingers, flicker, jitter, warped glass, floating objects, subtitles, watermark" } },
    "7": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler_ancestral" } },
    "8": { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    "9": { class_type: "LTXVDualCFGGuider", inputs: { model: ["1", 0], positive: ["15", 0], negative: ["15", 1], video_cfg: 1, audio_cfg: 1 } },
    "10": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["8", 0], guider: ["9", 0], sampler: ["7", 0], sigmas: ["24", 0], latent_image: ["18", 0] } },
    "11": { class_type: "VAEDecodeTiled", inputs: { samples: ["27", 0], vae: ["3", 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 16 } },
    "12": { class_type: "LTXVAudioVAEDecode", inputs: { samples: ["27", 1], audio_vae: ["4", 0] } },
    "13": { class_type: "CreateVideo", inputs: { images: ["28", 0], audio: ["12", 0], fps: 24, bit_depth: 8 } },
    "14": { class_type: "SaveVideo", inputs: { video: ["13", 0], filename_prefix: `aisle/ltx-2.5/ad-${randomUUID()}`, format: "mp4", codec: "auto" } },
    "15": { class_type: "LTXVConditioning", inputs: { positive: ["5", 0], negative: ["6", 0], frame_rate: 24 } },
    "16": { class_type: "EmptyLTXVLatentVideo", inputs: { width: width / 2, height: height / 2, length: frames, batch_size: 1 } },
    "17": { class_type: "LTXVEmptyLatentAudio", inputs: { frames_number: frames, frame_rate: 24, batch_size: 1, audio_vae: ["4", 0] } },
    "18": { class_type: "LTXVConcatAVLatent", inputs: { video_latent: ["16", 0], audio_latent: ["17", 0] } },
    "19": { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["10", 0] } },
    "20": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["26", 0], guider: ["9", 0], sampler: ["7", 0], sigmas: ["25", 0], latent_image: ["23", 0] } },
    "21": { class_type: "LatentUpscaleModelLoader", inputs: { model_name: LTX_WEIGHTS.upscaler } },
    "22": { class_type: "LTXVLatentUpsampler", inputs: { samples: ["19", 0], upscale_model: ["21", 0], vae: ["3", 0] } },
    "23": { class_type: "LTXVConcatAVLatent", inputs: { video_latent: ["22", 0], audio_latent: ["19", 1] } },
    "24": { class_type: "ManualSigmas", inputs: { sigmas: "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0" } },
    "25": { class_type: "ManualSigmas", inputs: { sigmas: "0.85, 0.7250, 0.4219, 0.0" } },
    "26": { class_type: "RandomNoise", inputs: { noise_seed: 42 } },
    "27": { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["20", 0] } },
    // Render at the model's 64px grid, then crop a few edge pixels for exact 16:9.
    "28": { class_type: "ImageCrop", inputs: { image: ["11", 0], width, height: outputHeight, x: 0, y: (height - outputHeight) / 2 } },
  };
}

export async function generateLtxVideo(req: GenerateRequest, onQueued?: (promptId: string) => void): Promise<GenerateResult> {
  const started = Date.now();
  const graph = ltxWorkflow(req, Math.floor(Math.random() * 1_000_000_000));
  await requireServer();
  assertLtxRuntime(await comfyGet("/system_stats"));
  const [unets, clips, vaes, upscalers] = await Promise.all([listed("diffusion_models"), listed("text_encoders"), listed("vae"), listed("latent_upscale_models")]);
  const missing = [[LTX_WEIGHTS.unet, unets], [LTX_WEIGHTS.clip, clips], [LTX_WEIGHTS.video, vaes], [LTX_WEIGHTS.audio, vaes], [LTX_WEIGHTS.upscaler, upscalers]].filter(([file, names]) => !(names as string[]).includes(file as string)).map(([file]) => file);
  if (missing.length) throw new Error(`LTX-2.5 download is incomplete: ${missing.join(", ")}. MiniMax fallback is disabled for this request.`);
  const promptId = await submit(graph);
  onQueued?.(promptId);
  const file = await waitForFile(promptId, 120 * 60_000, "LTX-2.5 cinematic video", true);
  const width = req.quality === "high" ? 1920 : 1280;
  const height = req.quality === "high" ? 1080 : 720;
  const durationSec = Number(graph["16"].inputs.length) / 24;
  return { ...result(req, started, "LTX-2.5", viewUrl(file), `Local BF16 text-to-video · official 8 + 3 sampling steps · 2x latent upscale and diffusion decoder · ${width}×${height} · exact branding requires post-production`), promptId, videoMode: "text-to-video", aspect: "16:9", resolution: { width, height }, frameRate: 24, durationSec };
}
