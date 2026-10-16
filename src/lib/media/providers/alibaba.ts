/**
 * Alibaba Cloud Model Studio (DashScope, international / Singapore): Qwen
 * Image posters (synchronous) and Wan 2.6 image-to-video (async task, polled).
 * One Bearer key, no signing. Result links are OSS storage valid for 24 hours:
 * downloaded at once, without the key, and never stored.
 */
import { randomUUID } from "node:crypto";
import type { AspectRatio, GenerateRequest } from "../pr2-types";
import { assertMediaBytes, MEDIA_MAX_BYTES } from "../store";
import { frameAspect, moderationMessage } from "./frame";
import { afterSubmit, apiBase, downloadFile, envValue, mp4DurationSec, pollJob, ProviderError, roundUsd, timeLeft, videoJobMs } from "./http";
import type { MediaProviderAdapter, ProviderContext, ProviderOutput } from "./types";

const KEY_ENV = "DASHSCOPE_API_KEY";
const base = () => apiBase("DASHSCOPE_API_BASE", "https://dashscope-intl.aliyuncs.com/api/v1");

const MODERATION_CODES = new Set(["DataInspectionFailed", "IPInfringementSuspect", "DataInspection"]);

/** Qwen Image 2.0 takes 512²–2048² total pixels; output is PNG, so posters stay near 1.7 MP. */
const SIZES: Record<AspectRatio, string> = { "4:5": "1152*1440", "3:4": "1104*1472", "1:1": "1328*1328", "9:16": "1008*1792", "16:9": "1792*1008" };
const DRAFT: Record<AspectRatio, string> = { "4:5": "768*960", "3:4": "768*1024", "1:1": "1024*1024", "9:16": "720*1280", "16:9": "1280*720" };

function key() {
  const value = envValue(KEY_ENV);
  if (!value) throw new ProviderError("DASHSCOPE_API_KEY is not set.", { retryable: false });
  return value;
}

type DashError = { code?: string; message?: string };

/**
 * DashScope reports errors as a top-level `{code, message}`, not the `{error}`
 * object the shared helper reads, so it gets its own small JSON call.
 */
async function dashscope<T extends DashError>(url: string, init: { body?: unknown; async?: boolean; timeoutMs: number; signal?: AbortSignal }, what: string): Promise<T> {
  const timeout = AbortSignal.timeout(init.timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${key()}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(init.async ? { "X-DashScope-Async": "enable" } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: "error",
      cache: "no-store",
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new ProviderError(timedOut ? "Alibaba did not answer in time." : "Alibaba is unreachable.");
  }
  const text = await response.text();
  let json: T | null = null;
  try { json = text ? (JSON.parse(text) as T) : null; } catch { /* reported below */ }
  if (!response.ok) throw failure(response.status, json?.code, json?.message, what);
  if (json === null) throw new ProviderError("Alibaba returned an unreadable response.");
  return json;
}

function failure(status: number | undefined, code: string | undefined, message: string | undefined, what: string) {
  if (code && [...MODERATION_CODES].some((c) => code.startsWith(c))) return new ProviderError(moderationMessage("Alibaba", what), { status, code, retryable: false });
  if (code === "Arrearage") return new ProviderError("The owner's Alibaba Cloud account is out of balance.", { status, code, retryable: false });
  if (status === 401 || code === "InvalidApiKey") return new ProviderError("Alibaba rejected the server's API key.", { status, code, retryable: false });
  return new ProviderError(`Alibaba returned ${status ?? "an error"}${code ? ` (${code})` : ""}${message ? `: ${message.slice(0, 300)}` : ""}`, { status, code, retryable: status === undefined ? false : undefined });
}

const download = (uri: string, kind: "image" | "video", signal?: AbortSignal) =>
  downloadFile("Alibaba", uri, { keyOrigin: new URL(base()).origin, headers: { Authorization: `Bearer ${key()}` }, max: MEDIA_MAX_BYTES[kind], timeoutMs: 180_000, signal });

type ImageResponse = DashError & {
  output?: { choices?: { message?: { content?: { image?: string }[] } }[] };
  usage?: { image_count?: number; width?: number; height?: number };
};

async function qwenImage(req: GenerateRequest, { model, onQueued, signal }: ProviderContext): Promise<ProviderOutput> {
  const aspect: AspectRatio = req.aspectRatio ?? "4:5";
  const jobId = `alibaba:image:${randomUUID()}`;
  onQueued?.(jobId);
  const body = await dashscope<ImageResponse>(`${base()}/services/aigc/multimodal-generation/generation`, {
    body: {
      model: model.apiModel,
      input: { messages: [{ role: "user", content: [{ text: req.prompt }] }] },
      // DashScope sizes are written W*H. The watermark is a "Qwen-Image" corner label.
      parameters: { size: (req.quality === "low" ? DRAFT : SIZES)[aspect], n: 1, watermark: false, prompt_extend: true },
    },
    timeoutMs: 240_000,
    signal,
  }, "prompt");
  if (body.code) throw failure(undefined, body.code, body.message, "poster");
  const url = body.output?.choices?.[0]?.message?.content?.find((c) => c.image)?.image;
  if (!url) throw new ProviderError("Alibaba returned no image.");
  // The image was generated and is billed, even if the OSS link fails.
  const { bytes, mime } = await afterSubmit(async () => {
    const got = await download(url, "image", signal);
    return { bytes: got, mime: assertMediaBytes(got, "image") };
  });
  const perImage = model.billing.mode === "per_image" ? model.billing.usd : 0.035;
  return { bytes, mime, costUsd: roundUsd(perImage * (body.usage?.image_count ?? 1)), jobId, aspect };
}

type TaskResponse = DashError & {
  output?: { task_id?: string; task_status?: string; video_url?: string; code?: string; message?: string };
  usage?: { duration?: number; output_video_duration?: number };
};

async function wanVideo(req: GenerateRequest, { model, startImage, onQueued, signal }: ProviderContext): Promise<ProviderOutput> {
  if (!startImage) throw new ProviderError("Image-to-video needs the campaign poster.", { retryable: false });
  const seconds = req.durationSec ?? 5;
  if (!Number.isInteger(seconds) || seconds < 2 || seconds > 15) throw new ProviderError("Wan renders 2 to 15 second clips.", { retryable: false });
  const flash = model.apiModel.endsWith("-flash");
  const deadline = Date.now() + videoJobMs();
  const created = await dashscope<TaskResponse>(`${base()}/services/aigc/video-generation/video-synthesis`, {
    async: true,
    body: {
      model: model.apiModel,
      // Wan keeps the first frame's framing, so a 4:5 poster gives a 4:5 clip.
      input: { prompt: req.prompt, img_url: `data:${startImage.mime};base64,${startImage.bytes.toString("base64")}` },
      // Only the Flash tier takes `audio` (silent is half price); ads want sound, so ask for it explicitly.
      parameters: { resolution: "720P", duration: seconds, prompt_extend: true, watermark: false, ...(flash ? { audio: true } : {}) },
    },
    timeoutMs: timeLeft(deadline, 120_000),
    signal,
  }, "video brief or poster");
  const taskId = created.output?.task_id;
  if (!taskId || !/^[\w-]+$/.test(taskId)) throw failure(undefined, created.code, created.message ?? "Alibaba did not start the video.", "video");
  const jobId = `alibaba:wan:${taskId}`;
  onQueued?.(jobId);
  const url = `${base()}/tasks/${encodeURIComponent(taskId)}`;
  const task = await pollJob("Alibaba", created, {
    done: (t) => ["SUCCEEDED", "FAILED", "CANCELED", "UNKNOWN"].includes(t.output?.task_status ?? ""),
    poll: (timeoutMs) => dashscope<TaskResponse>(url, { timeoutMs, signal }, "video"),
    intervalMs: 8000,
    deadline,
    signal,
  });
  if (task.output?.task_status !== "SUCCEEDED") {
    const known = failure(undefined, task.output?.code, task.output?.message, "video");
    throw new ProviderError(`${known.message} Failed videos are not billed.`, { code: known.code, retryable: false });
  }
  const bytes = await afterSubmit(async () => {
    if (!task.output?.video_url) throw new ProviderError("Alibaba returned no video.");
    const got = await download(task.output.video_url, "video", signal);
    assertMediaBytes(got, "video");
    return got;
  });
  const billedSec = task.usage?.duration ?? task.usage?.output_video_duration ?? seconds;
  const perSec = model.billing.mode === "per_second" ? model.billing.usdPerSec : 0.1;
  return { bytes, mime: "video/mp4", costUsd: roundUsd(perSec * billedSec), jobId, durationSec: mp4DurationSec(bytes) ?? billedSec, aspect: frameAspect(startImage.bytes) };
}

export const alibabaAdapter: MediaProviderAdapter = {
  id: "alibaba",
  keyEnv: [KEY_ENV],
  generate(req, ctx) {
    return ctx.model.kind === "image" ? qwenImage(req, ctx) : wanVideo(req, ctx);
  },
};
