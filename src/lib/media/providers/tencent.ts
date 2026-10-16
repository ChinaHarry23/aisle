/**
 * Tencent Cloud TokenHub (international, Singapore): Hunyuan Image posters,
 * and image-to-video through Hunyuan Video 1.5 or Kling 3.0, which TokenHub
 * resells pay-as-you-go on the same key. One Bearer key, no request signing
 * (the older TC3-signed Cloud API 3.0 route only serves Hunyuan on the China
 * site). Result links are signed COS storage: downloaded at once, without the
 * key, and never stored.
 */
import { randomUUID } from "node:crypto";
import type { AspectRatio, GenerateRequest } from "../pr2-types";
import { assertMediaBytes, MEDIA_MAX_BYTES } from "../store";
import { frameAspect, moderationMessage } from "./frame";
import { afterSubmit, apiBase, downloadFile, envValue, mp4DurationSec, pollJob, providerJson, ProviderError, roundUsd, timeLeft, videoJobMs } from "./http";
import type { MediaProviderAdapter, ProviderContext, ProviderOutput } from "./types";

const KEY_ENV = "TOKENHUB_API_KEY";
const base = () => apiBase("TOKENHUB_API_BASE", "https://tokenhub-intl.tencentcloudmaas.com");

/** Codes TokenHub uses for a content-policy refusal (business codes and the image API's own). */
const MODERATION_CODES = new Set(["1300", "1301", "451001", "content_filter"]);

/** Hy-Image-3.0 caps the area at 1024² with sides 512–2048; 4:5 is exact but not one of its presets. */
const V3_SIZES: Record<AspectRatio, string> = { "4:5": "896x1120", "3:4": "768x1024", "1:1": "1024x1024", "9:16": "768x1344", "16:9": "1344x768" };
/** Hy-Image-3.5 takes sides 256–8192; 1K and 2K cost the same, so posters stay near 1.3 MP. */
const V35_SIZES: Record<AspectRatio, string> = { "4:5": "1024x1280", "3:4": "960x1280", "1:1": "1024x1024", "9:16": "1152x2048", "16:9": "2048x1152" };

function key() {
  const value = envValue(KEY_ENV);
  if (!value) throw new ProviderError("TOKENHUB_API_KEY is not set.", { retryable: false });
  return value;
}

const headers = () => ({ Authorization: `Bearer ${key()}` });
const download = (uri: string, kind: "image" | "video", signal?: AbortSignal) =>
  downloadFile("Tencent", uri, { keyOrigin: new URL(base()).origin, headers: headers(), max: MEDIA_MAX_BYTES[kind], timeoutMs: 180_000, signal });

function refusal(status: number | undefined, code: string | undefined, what: string, message?: string): ProviderError {
  if (status === 422 || status === 451 || (code && MODERATION_CODES.has(code))) return new ProviderError(moderationMessage("Tencent", what), { status, code, retryable: false });
  if (status === 403 || code === "1103") return new ProviderError("This Tencent model is not switched on for the owner's TokenHub account (Online Inference › Vision Models).", { status, code, retryable: false });
  if (code && ["1100", "1101", "1102"].includes(code)) return new ProviderError("The owner's Tencent TokenHub account is in arrears or out of resource packs.", { status, code, retryable: false });
  return new ProviderError(`Tencent ${what} failed${message ? `: ${message.slice(0, 300)}` : ""}.`, { status, code });
}

function explain(error: unknown, what: string): unknown {
  if (!(error instanceof ProviderError)) return error;
  const known = refusal(error.status, error.code, what);
  return known.retryable ? error : known;
}

type ImageResponse = {
  data?: { url?: string }[];
  choices?: { delta?: { image?: { url?: string } }; finish_reason?: string | null }[];
  error?: { code?: string; message?: string } | null;
};

async function hunyuanImage(req: GenerateRequest, { model, onQueued, signal }: ProviderContext): Promise<ProviderOutput> {
  const aspect: AspectRatio = req.aspectRatio ?? "4:5";
  const v35 = model.apiModel.startsWith("hy-image-v3.5");
  const jobId = `tencent:image:${randomUUID()}`;
  onQueued?.(jobId);
  let body: ImageResponse;
  try {
    body = v35
      ? await providerJson<ImageResponse>("Tencent", `${base()}/v1/wand/hunyuan-image/v35-generation`, {
        headers: headers(),
        body: { model: model.apiModel, size: V35_SIZES[aspect], messages: [{ role: "user", content: [{ type: "text", text: req.prompt }] }] },
        timeoutMs: 240_000,
        signal,
      })
      : await providerJson<ImageResponse>("Tencent", `${base()}/v1/wand/hunyuan-image/v3-generation`, {
        headers: headers(),
        body: { model: model.apiModel, prompt: req.prompt, size: V3_SIZES[aspect] },
        timeoutMs: 240_000,
        signal,
      });
  } catch (error) {
    throw explain(error, "prompt");
  }
  if (body.error) throw refusal(undefined, body.error.code, "poster", body.error.message);
  // 3.5 answers in chat-chunk form; success is the image link being there (finish_reason stays null).
  const url = v35 ? body.choices?.[0]?.delta?.image?.url : body.data?.[0]?.url;
  if (!url) throw new ProviderError("Tencent returned no image.");
  // The image was generated and is billed, even if the link fails.
  const { bytes, mime } = await afterSubmit(async () => {
    const got = await download(url, "image", signal);
    return { bytes: got, mime: assertMediaBytes(got, "image") };
  });
  const perImage = model.billing.mode === "per_image" ? model.billing.usd : 0.032;
  return { bytes, mime, costUsd: roundUsd(perImage), jobId, aspect };
}

type HyTask = { task_id?: string; status?: string; videos?: { url?: string }[]; error?: { code?: string; message?: string } | null };

async function hunyuanVideo(req: GenerateRequest, { model, startImage, onQueued, signal }: ProviderContext): Promise<ProviderOutput> {
  if (!startImage) throw new ProviderError("Image-to-video needs the campaign poster.", { retryable: false });
  if (req.durationSec !== undefined && req.durationSec !== 5) throw new ProviderError("Hunyuan Video renders 5 second clips only.", { retryable: false });
  const deadline = Date.now() + videoJobMs();
  let created: HyTask;
  try {
    created = await providerJson<HyTask>("Tencent", `${base()}/v1/wand/hunyuan-video/generation`, {
      headers: headers(),
      // `image` is raw base64 (no data: prefix); the clip keeps the poster's framing at 720p.
      body: { model: model.apiModel, prompt: req.prompt, image: startImage.bytes.toString("base64") },
      timeoutMs: timeLeft(deadline, 120_000),
      signal,
    });
  } catch (error) {
    throw explain(error, "video brief or poster");
  }
  if (!created.task_id) throw refusal(undefined, created.error?.code, "video", created.error?.message);
  const jobId = `tencent:hy-video:${created.task_id}`;
  onQueued?.(jobId);
  const url = `${base()}/v1/wand/hunyuan-video/tasks/${encodeURIComponent(created.task_id)}`;
  const task = await pollJob("Tencent", created, {
    done: (t) => ["succeeded", "failed"].includes(t.status ?? ""),
    poll: (timeoutMs) => providerJson<HyTask>("Tencent", url, { headers: headers(), timeoutMs, signal }),
    intervalMs: 5000,
    deadline,
    signal,
  });
  if (task.status !== "succeeded") {
    const known = refusal(undefined, task.error?.code, "video", task.error?.message);
    throw new ProviderError(known.message, { code: known.code, retryable: false });
  }
  const bytes = await afterSubmit(async () => {
    const videoUrl = task.videos?.find((v) => v.url)?.url;
    if (!videoUrl) throw new ProviderError("Tencent returned no video.");
    const got = await download(videoUrl, "video", signal);
    assertMediaBytes(got, "video");
    return got;
  });
  const perSec = model.billing.mode === "per_second" ? model.billing.usdPerSec : 0.048;
  return { bytes, mime: "video/mp4", costUsd: roundUsd(perSec * 5), jobId, durationSec: mp4DurationSec(bytes) ?? 5, aspect: frameAspect(startImage.bytes), note: "Hunyuan Video clips are 5 s and silent." };
}

type KlingTask = { id?: string; status?: string; message?: string; outputs?: { type?: string; url?: string; duration?: string | number }[] };
type KlingResponse = { code?: number; message?: string; data?: KlingTask | KlingTask[] };

async function klingVideo(req: GenerateRequest, { model, startImage, onQueued, signal }: ProviderContext): Promise<ProviderOutput> {
  if (!startImage) throw new ProviderError("Image-to-video needs the campaign poster.", { retryable: false });
  const seconds = req.durationSec ?? 5;
  if (!Number.isInteger(seconds) || seconds < 3 || seconds > 15) throw new ProviderError("Kling renders 3 to 15 second clips.", { retryable: false });
  const deadline = Date.now() + videoJobMs();
  let created: KlingResponse;
  try {
    created = await providerJson<KlingResponse>("Tencent", `${base()}/v1/wand/kling/image-to-video`, {
      headers: headers(),
      body: {
        model: model.apiModel,
        // The first frame is raw base64; Kling has no aspect setting and keeps the poster's framing.
        contents: [{ type: "prompt", text: req.prompt }, { type: "first_frame", url: startImage.bytes.toString("base64") }],
        settings: { resolution: "720p", duration: seconds, audio: "native", multi_shot: false },
      },
      timeoutMs: timeLeft(deadline, 120_000),
      signal,
    });
  } catch (error) {
    throw explain(error, "video brief or poster");
  }
  const first = (r: KlingResponse) => (Array.isArray(r.data) ? r.data[0] : r.data);
  const id = first(created)?.id;
  if (created.code !== 0 || !id) throw refusal(undefined, created.code === undefined ? undefined : String(created.code), "video", created.message);
  const jobId = `tencent:kling:${id}`;
  onQueued?.(jobId);
  const url = `${base()}/v1/wand/kling/tasks/${encodeURIComponent(id)}`;
  const task = await pollJob("Tencent", first(created), {
    done: (t) => ["succeeded", "failed"].includes(t?.status ?? ""),
    poll: async (timeoutMs) => {
      const polled = await providerJson<KlingResponse>("Tencent", url, { headers: headers(), timeoutMs, signal });
      // A business code in a 200 (1302/1303 rate limits among them) is retried like a 429.
      if (polled.code !== 0) throw refusal(undefined, String(polled.code), "video", polled.message);
      return first(polled);
    },
    intervalMs: 5000,
    deadline,
    signal,
    what: "the Kling video",
  });
  if (task?.status !== "succeeded") {
    const known = refusal(undefined, undefined, "video", task?.message);
    throw new ProviderError(known.message, { retryable: false });
  }
  const bytes = await afterSubmit(async () => {
    const videoUrl = task.outputs?.find((o) => o.type === "video" && o.url)?.url;
    if (!videoUrl) throw new ProviderError("Tencent returned no Kling video.");
    const got = await download(videoUrl, "video", signal);
    assertMediaBytes(got, "video");
    return got;
  });
  // Kling bills the length asked for, not the few extra frames it returns (e.g. 10.041 s).
  const perSec = model.billing.mode === "per_second" ? model.billing.usdPerSec : 0.126;
  return { bytes, mime: "video/mp4", costUsd: roundUsd(perSec * seconds), jobId, durationSec: mp4DurationSec(bytes) ?? seconds, aspect: frameAspect(startImage.bytes) };
}

export const tencentAdapter: MediaProviderAdapter = {
  id: "tencent",
  keyEnv: [KEY_ENV],
  generate(req, ctx) {
    if (ctx.model.kind === "image") return hunyuanImage(req, ctx);
    return ctx.model.apiModel.startsWith("kling-") ? klingVideo(req, ctx) : hunyuanVideo(req, ctx);
  },
};
