/**
 * ByteDance through BytePlus ModelArk (international, ap-southeast-1):
 * Seedream posters (synchronous, base64 back) and Seedance image-to-video
 * (create a task, poll it, download the MP4). One Bearer key, no signing. The
 * key rides in the Authorization header only; Seedance's pre-signed video link
 * is fetched without it and never stored.
 */
import { randomUUID } from "node:crypto";
import type { AspectRatio, GenerateRequest } from "../pr2-types";
import { assertMediaBytes, MEDIA_MAX_BYTES } from "../store";
import { frameAspect, moderationMessage, ratioAspect } from "./frame";
import { afterSubmit, apiBase, downloadFile, envValue, mp4DurationSec, pollJob, providerJson, ProviderError, roundUsd, timeLeft, videoJobMs } from "./http";
import type { MediaProviderAdapter, ProviderContext, ProviderOutput } from "./types";

const KEY_ENV = "ARK_API_KEY";
const base = () => apiBase("ARK_API_BASE", "https://ark.ap-southeast.bytepluses.com/api/v3");

/** Seedance list price per 1M output tokens (image input only, 480p/720p). */
const SEEDANCE_PER_M: Record<string, number> = {
  "dreamina-seedance-2-5-260628": 5.6,
  "dreamina-seedance-2-0-fast-260128": 5.6,
  "dreamina-seedance-2-0-mini-260615": 3.5,
};

/**
 * Exact poster sizes. Seedream 4.5 and 5.0 Lite need at least 3.69 MP; 5.0
 * Pro/Flash take 0.92–4.62 MP and cost double above 2.61 MP, so they stay under it.
 */
const LARGE: Record<AspectRatio, string> = { "4:5": "1728x2160", "3:4": "1728x2304", "1:1": "2048x2048", "9:16": "1600x2848", "16:9": "2848x1600" };
const COMPACT: Record<AspectRatio, string> = { "4:5": "1440x1800", "3:4": "1344x1792", "1:1": "1600x1600", "9:16": "1152x2048", "16:9": "2048x1152" };
const DRAFT: Record<AspectRatio, string> = { "4:5": "1024x1280", "3:4": "960x1280", "1:1": "1024x1024", "9:16": "864x1536", "16:9": "1536x864" };

function key(override?: string) {
  const value = override?.trim() || envValue(KEY_ENV);
  if (!value) throw new ProviderError("ARK_API_KEY is not set.", { retryable: false });
  return value;
}

const headers = (override?: string) => ({ Authorization: `Bearer ${key(override)}` });

/** Turn ModelArk's error codes into something the Studio can show. */
function explain(error: unknown, what: string): unknown {
  if (!(error instanceof ProviderError)) return error;
  const code = error.code ?? "";
  if (code === "InputImageSensitiveContentDetected.PrivacyInformation") {
    return new ProviderError("Seedance will not animate a poster that shows a real person's face unless Seedream 5.0 Lite made it on this account. Render the poster with Seedream 5.0 Lite, or use a poster without people. Nothing was charged.", { status: error.status, code, retryable: false });
  }
  if (code.includes("SensitiveContentDetected")) return new ProviderError(moderationMessage("ByteDance", what), { status: error.status, code, retryable: false });
  if (code === "ModelNotOpen") return new ProviderError("This ByteDance model is not activated on the owner's BytePlus account (Model activation page).", { status: error.status, code, retryable: false });
  if (code === "AccountOverdueError") return new ProviderError("The owner's BytePlus account is out of balance.", { status: error.status, code, retryable: false });
  return error;
}

type ImagesResponse = {
  data?: { b64_json?: string; url?: string; size?: string; error?: { code?: string; message?: string } }[];
  usage?: { generated_images?: number; output_tokens?: number };
  error?: { code?: string; message?: string };
};

async function seedream(req: GenerateRequest, { model, startImage, apiKey, onQueued, signal }: ProviderContext): Promise<ProviderOutput> {
  const aspect: AspectRatio = req.aspectRatio ?? "4:5";
  const is5 = model.apiModel.includes("seedream-5-0");
  const compact = model.apiModel.startsWith("dola-");
  const size = (compact ? (req.quality === "low" ? DRAFT : COMPACT) : LARGE)[aspect];
  // Seedream answers synchronously and has no job id of its own.
  const jobId = `bytedance:image:${randomUUID()}`;
  onQueued?.(jobId);
  let body: ImagesResponse;
  try {
    body = await providerJson<ImagesResponse>("ByteDance", `${base()}/images/generations`, {
      headers: headers(apiKey),
      // watermark defaults to true (an "AI generated" label); JPEG keeps a poster small. 4.x only outputs JPEG.
      // `image` is sent only when the founder uploaded a product photo, so a text poster keeps the same body.
      body: {
        model: model.apiModel,
        prompt: req.prompt,
        size,
        response_format: "b64_json",
        watermark: false,
        ...(is5 ? { output_format: "jpeg" } : {}),
        ...(startImage ? { image: `data:${startImage.mime};base64,${startImage.bytes.toString("base64")}` } : {}),
      },
      timeoutMs: 180_000,
      signal,
    });
  } catch (error) {
    throw explain(error, "prompt");
  }
  const item = body.data?.[0];
  if (item?.error || body.error) {
    const err = item?.error ?? body.error!;
    throw explain(new ProviderError(`ByteDance: ${err.message ?? "image failed"}`, { code: err.code, retryable: false }), "poster");
  }
  if (!item?.b64_json) throw new ProviderError("ByteDance returned no image.");
  const bytes = Buffer.from(item.b64_json, "base64");
  // A generated image is billed even when its bytes are unusable.
  const mime = await afterSubmit(async () => assertMediaBytes(bytes, "image"));
  const perImage = model.billing.mode === "per_image" ? model.billing.usd : 0.04;
  const images = body.usage?.generated_images ?? 1;
  return { bytes, mime, costUsd: roundUsd(perImage * images), jobId, aspect, outputTokens: body.usage?.output_tokens };
}

type Task = {
  id?: string;
  status?: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired";
  content?: { video_url?: string };
  usage?: { completion_tokens?: number; total_tokens?: number };
  ratio?: string;
  duration?: number;
  error?: { code?: string; message?: string } | null;
};

async function seedance(req: GenerateRequest, { model, startImage, onQueued, signal }: ProviderContext): Promise<ProviderOutput> {
  if (!startImage && model.videoInput !== "text") throw new ProviderError("Image-to-video needs the campaign poster.", { retryable: false });
  const seconds = req.durationSec ?? 5;
  const lengths = model.durations?.length ? model.durations : [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const minSec = Math.min(...lengths);
  const maxSec = Math.max(...lengths);
  if (!Number.isInteger(seconds) || seconds < minSec || seconds > maxSec) throw new ProviderError(`Seedance renders ${minSec} to ${maxSec} second clips.`, { retryable: false });
  // A 30-second clip needs longer than the 8-minute default, and still finishes inside the 800 s function.
  const deadline = Date.now() + (seconds > 15 ? Math.max(videoJobMs(), 11 * 60_000) : videoJobMs());
  let created: Task;
  try {
    created = await providerJson<Task>("ByteDance", `${base()}/contents/generations/tasks`, {
      headers: headers(),
      body: {
        model: model.apiModel,
        content: [
          { type: "text", text: req.prompt },
          ...(startImage ? [{ type: "image_url", image_url: { url: `data:${startImage.mime};base64,${startImage.bytes.toString("base64")}` }, role: "first_frame" }] : []),
        ],
        // "adaptive" keeps a poster's framing. A text ad picks its own frame, so 16:9 is the commercial frame.
        ratio: startImage ? "adaptive" : req.aspectRatio === "9:16" ? "9:16" : "16:9",
        resolution: req.quality === "low" ? "480p" : "720p",
        duration: seconds,
        generate_audio: true,
        watermark: false,
      },
      timeoutMs: timeLeft(deadline, 120_000),
      signal,
    });
  } catch (error) {
    throw explain(error, "video brief or poster");
  }
  if (!created.id || !/^[\w.-]+$/.test(created.id)) throw new ProviderError("ByteDance did not start the video.");
  const jobId = `bytedance:seedance:${created.id}`;
  onQueued?.(jobId);
  const url = `${base()}/contents/generations/tasks/${encodeURIComponent(created.id)}`;
  const task = await pollJob("ByteDance", created, {
    done: (t) => ["succeeded", "failed", "cancelled", "expired"].includes(t.status ?? ""),
    poll: (timeoutMs) => providerJson<Task>("ByteDance", url, { headers: headers(), timeoutMs, signal }),
    intervalMs: 8000,
    deadline,
    signal,
    // Cancelling only works while queued; a running task is billed either way.
    onDeadline: () => void fetch(url, { method: "DELETE", headers: headers(), signal: AbortSignal.timeout(10_000) }).then((r) => r.body?.cancel(), () => undefined),
  });
  if (task.status !== "succeeded") {
    const err = task.error ?? {};
    throw explain(new ProviderError(`ByteDance video ${task.status}${err.message ? `: ${err.message.slice(0, 300)}` : ""}. Failed videos are not billed.`, { code: err.code, retryable: false }), "video");
  }
  // A succeeded task is billed; from here on a failure settles the hold rather than releasing it.
  const bytes = await afterSubmit(async () => {
    const videoUrl = task.content?.video_url;
    if (!videoUrl) throw new ProviderError("ByteDance returned no video.");
    // The link is pre-signed storage valid for 24 hours: download now, without the key.
    const got = await downloadFile("ByteDance", videoUrl, { keyOrigin: new URL(base()).origin, headers: headers(), max: MEDIA_MAX_BYTES.video, timeoutMs: 180_000, signal });
    assertMediaBytes(got, "video");
    return got;
  });
  const durationSec = mp4DurationSec(bytes) ?? task.duration ?? seconds;
  const tokens = task.usage?.completion_tokens;
  const perSec = model.billing.mode === "per_second" ? model.billing : { usdPerSec: 0.121, estTokensPerSec: 21600 };
  const perM = SEEDANCE_PER_M[model.apiModel] ?? (perSec.usdPerSec / perSec.estTokensPerSec) * 1e6;
  const costUsd = typeof tokens === "number" ? (tokens * perM) / 1e6 : perSec.usdPerSec * durationSec;
  const aspect = ratioAspect(task.ratio) ?? (startImage ? frameAspect(startImage.bytes) : req.aspectRatio) ?? "16:9";
  return { bytes, mime: "video/mp4", costUsd: roundUsd(costUsd), jobId, durationSec, aspect, outputTokens: tokens, note: typeof tokens === "number" ? undefined : "ByteDance sent no usage; billed per second." };
}

export const bytedanceAdapter: MediaProviderAdapter = {
  id: "bytedance",
  keyEnv: [KEY_ENV],
  // Seedream sends the browser's key; the Seedance video calls still use the server's.
  callerKeyKinds: ["image"],
  generate(req, ctx) {
    return ctx.model.kind === "image" ? seedream(req, ctx) : seedance(req, ctx);
  },
};
