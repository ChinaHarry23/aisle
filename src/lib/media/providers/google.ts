/**
 * Google Gemini API media: Nano Banana 2 posters and Gemini Omni Flash video
 * through the Interactions API, and Veo 3.1 (previews, shut down 22 Oct 2026)
 * through predictLongRunning. The key rides in `x-goog-api-key` on every call,
 * never in a URL, and a provider file URI never leaves the server.
 */
import { randomUUID } from "node:crypto";
import type { AspectRatio, GenerateRequest } from "../types";
import { assertMediaBytes, MEDIA_MAX_BYTES } from "../store";
import { afterSubmit, apiBase, downloadFile, envValue, mp4DurationSec, pollJob, providerJson, ProviderError, roundUsd, timeLeft, videoJobMs } from "./http";
import type { MediaProviderAdapter, ProviderContext, ProviderOutput } from "./types";

const KEY_ENV = "GOOGLE_AI_API_KEY|GEMINI_API_KEY";
const base = () => apiBase("GOOGLE_API_BASE", "https://generativelanguage.googleapis.com/v1beta");

/** Omni Flash: $1.50 per 1M input, $17.50 per 1M video output, $9 per 1M text and thinking. */
const OMNI = { inPerM: 1.5, videoOutPerM: 17.5, textOutPerM: 9 };
/** Nano Banana 2 text and thinking output; image output and input rates live in the catalog. */
const IMAGE_TEXT_OUT_PER_M = 3;

function key() {
  const value = envValue(KEY_ENV);
  if (!value) throw new ProviderError("GOOGLE_AI_API_KEY is not set.", { retryable: false });
  return value;
}

function headers() {
  return { "x-goog-api-key": key() };
}

type Usage = {
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_thought_tokens?: number;
  output_tokens_by_modality?: { modality?: string; tokens?: number }[];
};
type Content = { type?: string; data?: string; uri?: string; mime_type?: string; text?: string };
type Interaction = { id?: string; status?: string; steps?: { type?: string; content?: Content[] }[]; usage?: Usage; error?: { message?: string } };

function outputOf(interaction: Interaction, type: "image" | "video") {
  for (const step of interaction.steps ?? []) {
    if (step.type !== "model_output") continue;
    const found = step.content?.find((c) => c.type === type && (c.data || c.uri));
    if (found) return found;
  }
  return undefined;
}

const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0);

/**
 * Usage split into what each modality is billed at. Thought tokens are billed
 * as text output. Undefined when the block is missing or has no numeric token
 * counts (an empty `{}`, or renamed fields): the caller bills the list price
 * rather than $0.
 */
function usageSplit(usage: Usage | undefined, modality: "image" | "video") {
  if (!usage || typeof usage.total_output_tokens !== "number" || !(usage.total_output_tokens > 0)) return undefined;
  const input = count(usage.total_input_tokens);
  const output = count(usage.total_output_tokens);
  const thought = count(usage.total_thought_tokens);
  const byModality = usage.output_tokens_by_modality?.find((m) => m.modality === modality)?.tokens;
  const media = typeof byModality === "number" ? Math.min(count(byModality), output) : output;
  const text = Math.max(0, output - media) + thought;
  return { input, media, text, output: output + thought };
}

/** Google allows only portrait or landscape video; a 4:5 poster becomes a 9:16 clip. */
function videoAspect(req: GenerateRequest): "9:16" | "16:9" {
  return req.aspectRatio === "16:9" ? "16:9" : "9:16";
}

async function mediaBytes(content: Content, kind: "image" | "video", signal?: AbortSignal): Promise<Buffer> {
  if (content.data) return Buffer.from(content.data, "base64");
  return downloadFile("Google", content.uri!, { keyOrigin: new URL(base()).origin, headers: headers(), max: MEDIA_MAX_BYTES[kind], timeoutMs: 180_000, signal });
}

async function nanoBanana(req: GenerateRequest, { model, onQueued, signal }: ProviderContext): Promise<ProviderOutput> {
  const jobId = `google:image:${randomUUID()}`;
  onQueued?.(jobId);
  const aspect: AspectRatio = req.aspectRatio ?? "4:5";
  const interaction = await providerJson<Interaction>("Google", `${base()}/interactions`, {
    headers: headers(),
    // store:false: a poster prompt has no reason to sit on Google's side for 55 days.
    // quality "low" (smoke tests, drafts) asks for the 512px size at about two thirds of the 1K price.
    body: { model: model.apiModel, input: req.prompt, store: false, response_format: { type: "image", aspect_ratio: aspect, image_size: req.quality === "low" ? "512px" : "1K" } },
    timeoutMs: 180_000,
    signal,
  });
  const content = outputOf(interaction, "image");
  if (!content) throw new ProviderError(interaction.error?.message ? `Google: ${interaction.error.message}` : "Google returned no image; the prompt may have been blocked by a safety filter.", { retryable: false });
  // The image exists and is billed from here on, even if its bytes never arrive.
  const { bytes, mime } = await afterSubmit(async () => {
    const got = await mediaBytes(content, "image", signal);
    return { bytes: got, mime: assertMediaBytes(got, "image") };
  });
  const billing = model.billing.mode === "tokens" ? model.billing : { textInPerM: 0.5, imageOutPerM: 60, estOutTokens: 1120 };
  const split = usageSplit(interaction.usage, "image");
  if (!split) {
    return { bytes, mime, costUsd: roundUsd((billing.estOutTokens * billing.imageOutPerM) / 1e6), jobId, aspect, note: "Google sent no usable usage; billed the list estimate." };
  }
  const costUsd = (split.input * billing.textInPerM + split.media * billing.imageOutPerM + split.text * IMAGE_TEXT_OUT_PER_M) / 1e6;
  return { bytes, mime, costUsd: roundUsd(costUsd), jobId, aspect, inputTokens: split.input, outputTokens: split.output };
}

async function omniVideo(req: GenerateRequest, { model, startImage, onQueued, signal }: ProviderContext): Promise<ProviderOutput> {
  if (!startImage) throw new ProviderError("Image-to-video needs the campaign poster.", { retryable: false });
  const seconds = req.durationSec ?? 8;
  const aspect = videoAspect(req);
  // Omni has no duration parameter; length is set with prompt timecodes.
  const prompt = `${req.prompt}\n[0-${seconds}s] One continuous shot that ends at exactly ${seconds} seconds.`;
  // One budget from before the create call to the downloaded clip.
  const deadline = Date.now() + videoJobMs();
  const created = await providerJson<Interaction>("Google", `${base()}/interactions`, {
    headers: headers(),
    body: {
      model: model.apiModel,
      input: [
        { type: "image", data: startImage.bytes.toString("base64"), mime_type: startImage.mime },
        { type: "text", text: prompt },
      ],
      response_format: { type: "video", aspect_ratio: aspect, resolution: req.quality === "low" ? "360p" : "720p" },
      generation_config: { video_config: { task: "image_to_video" } },
      background: true,
    },
    timeoutMs: timeLeft(deadline, 120_000),
    signal,
  });
  if (!created.id) throw new ProviderError("Google did not start the video.");
  const jobId = `google:omni:${created.id}`;
  onQueued?.(jobId);
  const url = `${base()}/interactions/${encodeURIComponent(created.id)}`;
  const interaction = await pollJob("Google", created, {
    done: (i) => ["completed", "failed", "cancelled"].includes(i.status ?? ""),
    poll: (timeoutMs) => providerJson<Interaction>("Google", url, { headers: headers(), timeoutMs, signal }),
    intervalMs: 5000,
    deadline,
    signal,
  });
  // Failed, cancelled and blocked videos are not billed: the hold is released.
  if (interaction.status !== "completed") throw new ProviderError(`Google video ${interaction.status}${interaction.error?.message ? `: ${interaction.error.message}` : ""}.`, { retryable: false });
  const content = outputOf(interaction, "video");
  if (!content) throw new ProviderError("Google returned no video; it may have been blocked by a safety filter.", { retryable: false });
  const bytes = await afterSubmit(async () => {
    const got = await mediaBytes(content, "video", signal);
    assertMediaBytes(got, "video");
    return got;
  });
  // The stored interaction holds the poster; it is not needed once the clip is saved.
  void fetch(url, { method: "DELETE", headers: headers(), signal: AbortSignal.timeout(10_000) }).then((r) => r.body?.cancel(), () => undefined);
  const durationSec = mp4DurationSec(bytes) ?? seconds;
  const split = usageSplit(interaction.usage, "video");
  if (durationSec > seconds + 1) console.warn(`Omni Flash returned ${durationSec}s for a ${seconds}s request (${jobId}).`);
  const costUsd = split
    ? (split.input * OMNI.inPerM + split.media * OMNI.videoOutPerM + split.text * OMNI.textOutPerM) / 1e6
    : (model.billing.mode === "per_second" ? model.billing.usdPerSec : 0.1014) * durationSec;
  return { bytes, mime: "video/mp4", costUsd: roundUsd(costUsd), jobId, durationSec, aspect, inputTokens: split?.input, outputTokens: split?.output, note: split ? undefined : "Google sent no usable usage; billed per second." };
}

type Operation = {
  name?: string;
  done?: boolean;
  error?: { message?: string };
  response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[]; raiMediaFilteredReasons?: string[] } };
};

async function veoVideo(req: GenerateRequest, { model, startImage, onQueued, signal }: ProviderContext): Promise<ProviderOutput> {
  if (!startImage) throw new ProviderError("Image-to-video needs the campaign poster.", { retryable: false });
  const seconds = req.durationSec ?? 8;
  if (![4, 6, 8].includes(seconds)) throw new ProviderError("Veo renders 4, 6 or 8 second clips.", { retryable: false });
  const aspect = videoAspect(req);
  const deadline = Date.now() + videoJobMs();
  const created = await providerJson<Operation>("Google", `${base()}/models/${encodeURIComponent(model.apiModel)}:predictLongRunning`, {
    headers: headers(),
    body: {
      // The live endpoint rejects the documented `inlineData` form; Vertex-style bytes work.
      instances: [{ prompt: req.prompt, image: { bytesBase64Encoded: startImage.bytes.toString("base64"), mimeType: startImage.mime } }],
      parameters: { aspectRatio: aspect, durationSeconds: seconds, resolution: "720p", personGeneration: "allow_adult" },
    },
    timeoutMs: timeLeft(deadline, 120_000),
    signal,
  });
  if (!created.name || !/^[\w./-]+$/.test(created.name)) throw new ProviderError("Google did not start the video.");
  const jobId = `google:veo:${created.name}`;
  onQueued?.(jobId);
  const operation = await pollJob("Veo", created, {
    done: (op) => Boolean(op.done),
    poll: (timeoutMs) => providerJson<Operation>("Google", `${base()}/${created.name}`, { headers: headers(), timeoutMs, signal }),
    intervalMs: 10_000,
    deadline,
    signal,
  });
  if (operation.error) throw new ProviderError(`Veo failed: ${operation.error.message ?? "unknown error"}`, { retryable: false });
  const result = operation.response?.generateVideoResponse;
  const uri = result?.generatedSamples?.[0]?.video?.uri;
  if (!uri) {
    const reasons = result?.raiMediaFilteredReasons?.join(" ");
    throw new ProviderError(`Veo returned no video${reasons ? `: ${reasons.slice(0, 300)}` : "; it may have been blocked by a safety filter"}. Google does not bill blocked videos.`, { retryable: false });
  }
  // Google deletes the file after two days, so it is downloaded now and never stored as a link.
  const bytes = await afterSubmit(async () => {
    const got = await mediaBytes({ uri }, "video", signal);
    assertMediaBytes(got, "video");
    return got;
  });
  const perSec = model.billing.mode === "per_second" ? model.billing.usdPerSec : 0;
  return { bytes, mime: "video/mp4", costUsd: roundUsd(perSec * seconds), jobId, durationSec: seconds, aspect };
}

export const googleAdapter: MediaProviderAdapter = {
  id: "google",
  keyEnv: [KEY_ENV],
  async generate(req, ctx) {
    if (ctx.model.kind === "image") return nanoBanana(req, ctx);
    if (ctx.model.apiModel.startsWith("veo-")) return veoVideo(req, ctx);
    return omniVideo(req, ctx);
  },
};
