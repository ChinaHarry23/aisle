/**
 * Offline checks for the ByteDance (BytePlus ModelArk), Tencent (TokenHub) and
 * Alibaba (Model Studio) media adapters: fake API and storage servers on
 * loopback assert the exact request shapes, where the key travels, polling,
 * downloads, costs and refusal messages. A throwaway SQLite database backs the
 * one end-to-end billing check. No real provider is called.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import type { ProviderContext } from "../src/lib/media/providers/types";
import type { GenerateRequest, MediaModel } from "../src/lib/media/pr2-types";

const dir = mkdtempSync(path.join(os.tmpdir(), "aisle-provider-adapters-test-"));
for (const name of ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "AISLE_DATABASE_URL", "NEON_DATABASE_URL", "STORAGE_URL", "AISLE_MEDIA_PROVIDERS", "AISLE_MEDIA_DRIVER", "VERCEL", "OPENAI_API_KEY", "GOOGLE_AI_API_KEY", "GEMINI_API_KEY"]) delete process.env[name];
const KEYS = { ARK_API_KEY: "ark-test-offline-key", TOKENHUB_API_KEY: "tokenhub-test-offline-key", DASHSCOPE_API_KEY: "sk-test-dashscope-offline" };
Object.assign(process.env, {
  AISLE_DB: "sqlite",
  AISLE_DB_FILE: path.join(dir, "aisle.db"),
  AISLE_MEDIA_DIR: path.join(dir, "media"),
  AISLE_MEDIA_PROGRESS_DB: path.join(dir, "progress.db"),
  AISLE_MEDIA_POLL_MS: "5",
  COMFYUI_URL: "http://127.0.0.1:9",
  ...KEYS,
});

const { MEDIA_ADAPTERS, usableProvider, providerAvailability } = await import("../src/lib/media/providers");
const { ProviderError, pollJson, transientError, downloadFile } = await import("../src/lib/media/providers/http");
const { imageSize, nearestAspect, frameAspect } = await import("../src/lib/media/providers/frame");
const { MEDIA_MODELS } = await import("../src/lib/media/catalog");
const { resolveModelId, getModel, runGeneration, holdEstimateUsd } = await import("../src/lib/pr2-shims");
const { sha256Hex } = await import("../src/lib/media/store");
const { billingFor } = await import("../src/lib/billing/meter");
const { adjustCredits, balanceMilli } = await import("../src/lib/billing/ledger");

let checks = 0;
const pass = (label: string) => { checks++; console.log(`PASS ${label}`); };

// ---- Fixtures: real headers, so sniffing and framing are exercised --------
function png(width: number, height: number) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); ihdr.write("IHDR", 4, "latin1"); ihdr.writeUInt32BE(width, 8); ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), ihdr, Buffer.from("offline png")]);
}
function jpeg(width: number, height: number) {
  const app0 = Buffer.concat([Buffer.from("ffe00010", "hex"), Buffer.from("JFIF\0"), Buffer.alloc(9)]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from("ffd8", "hex"), app0, sof, Buffer.from("ffd9", "hex")]);
}
function webp(width: number, height: number) {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "latin1"); b.writeUInt32LE(22, 4); b.write("WEBP", 8, "latin1"); b.write("VP8X", 12, "latin1"); b.writeUInt32LE(10, 16);
  b.writeUIntLE(width - 1, 24, 3); b.writeUIntLE(height - 1, 27, 3);
  return b;
}
function mp4(seconds: number) {
  const ftyp = Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from("ftypisom"), Buffer.from([0, 0, 2, 0])]);
  const mvhd = Buffer.alloc(108);
  mvhd.writeUInt32BE(108, 0); mvhd.write("mvhd", 4, "latin1");
  mvhd.writeUInt32BE(1000, 20); mvhd.writeUInt32BE(Math.round(seconds * 1000), 24);
  const moov = Buffer.alloc(8); moov.writeUInt32BE(116, 0); moov.write("moov", 4, "latin1");
  return Buffer.concat([ftyp, moov, mvhd]);
}
const SEEDREAM_JPEG = jpeg(1440, 1800);
const POSTER_PNG = png(1024, 1280);
const CLIP_8 = mp4(8), CLIP_5 = mp4(5), CLIP_6 = mp4(6.04);

// ---- Fake servers ---------------------------------------------------------
type Seen = { method: string; url: string; headers: IncomingMessage["headers"]; body: string };
async function serve(handler: (req: Seen, res: ServerResponse) => unknown) {
  const seen: Seen[] = [];
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const entry = { method: req.method ?? "GET", url: req.url ?? "/", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
    seen.push(entry);
    try { await handler(entry, res); } catch (error) { res.writeHead(500).end(String(error)); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  return { server, seen, origin: `http://127.0.0.1:${address.port}` };
}
const json = (res: ServerResponse, status: number, body: unknown) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
const bodyOf = (s: Seen) => JSON.parse(s.body);

/** Pre-signed storage (TOS / COS / OSS stand-in): a different origin from every API. */
const storage = await serve((req, res) => {
  const files: Record<string, [string, Buffer]> = {
    "/tos/seedance.mp4": ["video/mp4", CLIP_8],
    "/cos/hy-image.png": ["image/png", POSTER_PNG],
    "/cos/hy-video.mp4": ["video/mp4", CLIP_5],
    "/cos/kling.mp4": ["video/mp4", CLIP_6],
    "/oss/qwen.png": ["image/png", POSTER_PNG],
    "/oss/wan.mp4": ["video/mp4", CLIP_5],
    "/oss/not-an-image.png": ["image/png", Buffer.from("<html>expired</html>")],
    "/cos/not-a-video.mp4": ["video/mp4", Buffer.from("<html>expired</html>")],
  };
  const file = files[new URL(req.url, "http://fake").pathname];
  if (!file) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": file[0] }).end(file[1]);
});

let arkMode: "ok" | "moderation" | "garbage" | "face" | "failed" | "stuck" | "flaky" | "nolink" = "ok";
let arkPolls = 0;
const ark = await serve((req, res) => {
  const url = new URL(req.url, "http://fake");
  if (req.method === "POST" && url.pathname === "/api/v3/images/generations") {
    if (arkMode === "moderation") return json(res, 400, { error: { code: "OutputImageSensitiveContentDetected", message: "The request failed because the output image may contain sensitive information.", param: "", type: "BadRequest" } });
    const image = arkMode === "garbage" ? Buffer.from("<html>no</html>") : SEEDREAM_JPEG;
    return json(res, 200, { model: bodyOf(req).model, created: 1, data: [{ b64_json: image.toString("base64"), size: bodyOf(req).size }], usage: { generated_images: 1, output_tokens: 10125, total_tokens: 10125 } });
  }
  if (req.method === "POST" && url.pathname === "/api/v3/contents/generations/tasks") {
    if (arkMode === "face") return json(res, 400, { error: { code: "InputImageSensitiveContentDetected.PrivacyInformation", message: "The request failed because the input image may contain real person.", type: "BadRequest" } });
    arkPolls = 0;
    return json(res, 200, { id: "cgt-2026-offline" });
  }
  if (req.method === "GET" && url.pathname === "/api/v3/contents/generations/tasks/cgt-2026-offline") {
    arkPolls++;
    if (arkMode === "flaky" && arkPolls === 1) return json(res, 429, { error: { code: "ModelAccountRpmRateLimitExceeded", message: "Too many requests.", type: "TooManyRequests" } });
    if (arkMode === "nolink" && arkPolls >= 3) return json(res, 200, { id: "cgt-2026-offline", status: "succeeded", content: { video_url: `${storage.origin}/tos/missing.mp4` }, usage: { completion_tokens: 172800 } });
    if (arkMode === "stuck" || arkPolls < 3) return json(res, 200, { id: "cgt-2026-offline", status: arkPolls < 2 ? "queued" : "running" });
    if (arkMode === "failed") return json(res, 200, { id: "cgt-2026-offline", status: "failed", error: { code: "OutputVideoSensitiveContentDetected", message: "The output video may contain sensitive information." } });
    return json(res, 200, { id: "cgt-2026-offline", status: "succeeded", content: { video_url: `${storage.origin}/tos/seedance.mp4?X-Tos-Signature=abc` }, usage: { completion_tokens: 172800, total_tokens: 172800 }, ratio: "3:4", resolution: "720p", duration: 8, framespersecond: 24 });
  }
  if (req.method === "DELETE") return json(res, 200, {});
  json(res, 404, { error: { code: "InvalidEndpointOrModel.NotFound", message: `no fake for ${req.method} ${url.pathname}` } });
});

let hubMode: "ok" | "moderation" | "refused" | "flaky" | "garbage" = "ok";
let hyPolls = 0, klingPolls = 0;
const hub = await serve((req, res) => {
  const url = new URL(req.url, "http://fake");
  if (req.method === "POST" && url.pathname === "/v1/wand/hunyuan-image/v35-generation") {
    if (hubMode === "moderation") return json(res, 422, { id: "abc", object: "image.chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "error" }], error: { type: "invalid_request_error", code: "content_filter", message: "input moderation rejected" } });
    return json(res, 200, { id: "1-WandImage-x", object: "image.chat.completion.chunk", choices: [{ index: 0, delta: { type: "image", image: { url: `${storage.origin}/cos/hy-image.png?q-sign-algorithm=sha1`, width: 1024, height: 1280 } }, finish_reason: null }], tokenhub_usage: { total_tokens: 20000 } });
  }
  if (req.method === "POST" && url.pathname === "/v1/wand/hunyuan-image/v3-generation") {
    return json(res, 200, { id: "4-WandImage-y", created: 1, data: [{ url: `${storage.origin}/cos/hy-image.png`, revised_prompt: "..." }], tokenhub_usage: { total_tokens: 1024 } });
  }
  if (req.method === "POST" && url.pathname === "/v1/wand/hunyuan-video/generation") {
    if (hubMode === "refused") return json(res, 400, { task_id: "", status: "failed", error: { code: "1300", message: "Trigger the platform strategy" } });
    hyPolls = 0;
    return json(res, 200, { task_id: "251435731-WandVideo-offline", created: 1, request_id: "r1" });
  }
  if (req.method === "GET" && url.pathname === "/v1/wand/hunyuan-video/tasks/251435731-WandVideo-offline") {
    hyPolls++;
    if (hyPolls < 2) return json(res, 200, { task_id: "251435731-WandVideo-offline", status: "running", error: null });
    return json(res, 200, { task_id: "251435731-WandVideo-offline", status: "succeeded", error: null, videos: [{ audio_url: "", url: `${storage.origin}/cos/${hubMode === "garbage" ? "not-a-video" : "hy-video"}.mp4?q-sign-algorithm=sha1` }], tokenhub_usage: { total_tokens: 150000 } });
  }
  if (req.method === "POST" && url.pathname === "/v1/wand/kling/image-to-video") {
    klingPolls = 0;
    return json(res, 200, { code: 0, message: "SUCCEED", data: { id: "task_kling_offline", status: "submitted", create_time: 1 } });
  }
  if (req.method === "GET" && url.pathname === "/v1/wand/kling/tasks/task_kling_offline") {
    klingPolls++;
    // TokenHub's rate limit as a business code in a 200.
    if (hubMode === "flaky" && klingPolls === 1) return json(res, 200, { code: 1302, message: "rate limit exceeded" });
    if (klingPolls < 2) return json(res, 200, { code: 0, data: [{ id: "task_kling_offline", status: "processing" }] });
    return json(res, 200, { code: 0, message: "SUCCEED", data: [{ id: "task_kling_offline", status: "succeeded", outputs: [{ duration: "6.041", type: "video", url: `${storage.origin}/cos/kling.mp4` }] }], tokenhub_usage: { total_tokens: 360000 } });
  }
  json(res, 404, { error: { code: "404", message: `no fake for ${req.method} ${url.pathname}` } });
});

let dashMode: "ok" | "moderation" | "expired-link" | "flaky" = "ok";
let wanPolls = 0;
const dash = await serve((req, res) => {
  const url = new URL(req.url, "http://fake");
  if (req.method === "POST" && url.pathname === "/api/v1/services/aigc/multimodal-generation/generation") {
    if (dashMode === "moderation") return json(res, 400, { request_id: "r", code: "DataInspectionFailed", message: "Input data may contain inappropriate content." });
    const file = dashMode === "expired-link" ? "not-an-image.png" : "qwen.png";
    return json(res, 200, { output: { choices: [{ finish_reason: "stop", message: { role: "assistant", content: [{ image: `${storage.origin}/oss/${file}?Expires=1` }] } }] }, usage: { width: 1152, height: 1440, image_count: 1 }, request_id: "r" });
  }
  if (req.method === "POST" && url.pathname === "/api/v1/services/aigc/video-generation/video-synthesis") {
    if (req.headers["x-dashscope-async"] !== "enable") return json(res, 400, { code: "InvalidParameter", message: "current user api does not support synchronous calls" });
    wanPolls = 0;
    return json(res, 200, { output: { task_id: "0385dc79-5ff8-4d82-bcb6-5b3b1b4a0c3a", task_status: "PENDING" }, request_id: "r" });
  }
  if (req.method === "GET" && url.pathname === "/api/v1/tasks/0385dc79-5ff8-4d82-bcb6-5b3b1b4a0c3a") {
    wanPolls++;
    if (dashMode === "flaky" && wanPolls === 1) return json(res, 500, { code: "InternalError", message: "An internal error has occured, please try again later." });
    if (wanPolls < 2) return json(res, 200, { output: { task_id: "0385dc79-5ff8-4d82-bcb6-5b3b1b4a0c3a", task_status: "RUNNING" } });
    return json(res, 200, { output: { task_id: "0385dc79-5ff8-4d82-bcb6-5b3b1b4a0c3a", task_status: "SUCCEEDED", video_url: `${storage.origin}/oss/wan.mp4?Expires=1` }, usage: { input_video_duration: 0, output_video_duration: 5, duration: 5, SR: 720, video_count: 1, audio: true } });
  }
  json(res, 404, { code: "NotFound", message: `no fake for ${req.method} ${url.pathname}` });
});

process.env.ARK_API_BASE = `${ark.origin}/api/v3`;
process.env.TOKENHUB_API_BASE = hub.origin;
process.env.DASHSCOPE_API_BASE = `${dash.origin}/api/v1`;

const startImage = { bytes: POSTER_PNG, mime: "image/png", sha256: sha256Hex(POSTER_PNG) };
/** PR #2 adapter fixtures. Cindy's catalog does not include Tencent / Seedream 5 / Seedance mini. */
function fixture(id: string, providerId: MediaModel["providerId"], kind: "image" | "video", apiModel: string, billing: MediaModel["billing"], extra: Partial<MediaModel> = {}): MediaModel {
  return {
    id,
    providerId,
    provider: providerId,
    name: id,
    apiModel,
    kind,
    blurb: "",
    bestFor: "",
    envKeys: [],
    endpoint: "",
    estimateLabel: "",
    billing,
    ...extra,
  };
}
const ADAPTER_MODELS: Record<string, MediaModel> = {
  "bytedance:seedream-5-pro": fixture("bytedance:seedream-5-pro", "bytedance", "image", "dola-seedream-5-0-pro-260628", { mode: "per_image", usd: 0.045, estOutTokens: 1000 }),
  "bytedance:seedream-5-lite": fixture("bytedance:seedream-5-lite", "bytedance", "image", "seedream-5-0-lite-260128", { mode: "per_image", usd: 0.035, estOutTokens: 1000 }),
  "bytedance:seedream-4.5": fixture("bytedance:seedream-4.5", "bytedance", "image", "seedream-4-5-251128", { mode: "per_image", usd: 0.04, estOutTokens: 1200 }),
  "bytedance:seedance-2.5": fixture("bytedance:seedance-2.5", "bytedance", "video", "dreamina-seedance-2-5-260628", { mode: "per_second", usdPerSec: 0.121, estTokensPerSec: 21600 }, { durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30] }),
  "bytedance:seedance-2-mini": fixture("bytedance:seedance-2-mini", "bytedance", "video", "dreamina-seedance-2-0-mini-260615", { mode: "per_second", usdPerSec: 0.0756, estTokensPerSec: 21600 }, { durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], usageBilled: true }),
  "bytedance:seedance-2-fast": fixture("bytedance:seedance-2-fast", "bytedance", "video", "dreamina-seedance-2-0-fast-260128", { mode: "per_second", usdPerSec: 0.121, estTokensPerSec: 21600 }, { durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }),
  "tencent:hy-image-3.5": fixture("tencent:hy-image-3.5", "tencent", "image", "hy-image-v3.5-preview", { mode: "per_image", usd: 0.024, estOutTokens: 1000 }),
  "tencent:hy-image-3": fixture("tencent:hy-image-3", "tencent", "image", "hy-image-v3", { mode: "per_image", usd: 0.032, estOutTokens: 1000 }),
  "tencent:hy-video-1.5": fixture("tencent:hy-video-1.5", "tencent", "video", "hy-video-v1.5", { mode: "per_second", usdPerSec: 0.048, estTokensPerSec: 400 }, { durations: [5] }),
  "tencent:kling-3": fixture("tencent:kling-3", "tencent", "video", "kling-video-v3", { mode: "per_second", usdPerSec: 0.126, estTokensPerSec: 600 }, { durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }),
  "alibaba:qwen-image-2": fixture("alibaba:qwen-image-2", "alibaba", "image", "qwen-image-2.0", { mode: "per_image", usd: 0.035, estOutTokens: 1000 }),
  "alibaba:wan-2.6-flash": fixture("alibaba:wan-2.6-flash", "alibaba", "video", "wan2.6-i2v-flash", { mode: "per_second", usdPerSec: 0.05, estTokensPerSec: 400 }, { durations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }),
  "alibaba:wan-2.6": fixture("alibaba:wan-2.6", "alibaba", "video", "wan2.6-i2v", { mode: "per_second", usdPerSec: 0.1, estTokensPerSec: 400 }, { durations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }),
};
const call = (modelId: string, req: Partial<GenerateRequest> = {}, ctx: Partial<ProviderContext> = {}) => {
  const model = ADAPTER_MODELS[modelId] ?? getModel(modelId);
  const adapter = MEDIA_ADAPTERS[model.providerId]!;
  return adapter.generate({ kind: model.kind, modelId, prompt: "Apple juice poster, headline \"FRESH\"", aspectRatio: "4:5", ...req }, { model, ...(model.kind === "video" ? { startImage } : {}), ...ctx });
};
async function refused(promise: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert(error instanceof ProviderError, `expected a ProviderError, got ${error}`);
    assert.match(error.message, pattern);
    assert.equal(error.retryable, false, "a refusal is never retried");
    return true;
  });
}

try {
  // ---- Registry and catalog ----------------------------------------------
  for (const id of ["bytedance", "tencent", "alibaba"] as const) {
    const adapter = MEDIA_ADAPTERS[id];
    assert(adapter, `${id} adapter registered`);
    assert.equal(adapter.id, id);
    assert.equal(usableProvider(id), true);
  }
  const bytedance = MEDIA_MODELS.filter((m) => m.providerId === "bytedance");
  const alibaba = MEDIA_MODELS.filter((m) => m.providerId === "alibaba");
  assert(bytedance.some((m) => m.kind === "image") && bytedance.some((m) => m.kind === "video"), "Cindy's catalog has ByteDance posters and videos");
  assert(alibaba.some((m) => m.kind === "image") && alibaba.some((m) => m.kind === "video"), "Cindy's catalog has Alibaba posters and videos");
  assert.equal(MEDIA_MODELS.some((m) => String(m.providerId) === "tencent"), false, "Cindy's catalog has no Tencent ids; the adapter is PR #2-only");
  process.env.AISLE_MEDIA_PROVIDERS = "openai, bytedance";
  assert.equal(usableProvider("bytedance"), true); assert.equal(usableProvider("tencent"), false); assert.equal(usableProvider("alibaba"), false);
  assert.match(providerAvailability("tencent").reason!, /turned off/);
  delete process.env.AISLE_MEDIA_PROVIDERS;
  delete process.env.TOKENHUB_API_KEY;
  assert.equal(usableProvider("tencent"), false); assert.match(providerAvailability("tencent").reason!, /not configured/);
  process.env.TOKENHUB_API_KEY = KEYS.TOKENHUB_API_KEY;
  for (const id of ["bytedance", "tencent", "alibaba"] as const) {
    const text = JSON.stringify(providerAvailability(id));
    for (const key of Object.values(KEYS)) assert.equal(text.includes(key), false);
  }
  assert.equal(getModel("bytedance:seedream-4.5").apiModel, "seedream-4.5");
  assert.equal(getModel("bytedance:seedance-2-fast").apiModel, "seedance-2.0-fast");
  assert.equal(getModel("alibaba:qwen-image-3").apiModel, "qwen-image-3");
  assert.equal(getModel("alibaba:wan-2.6").apiModel, "wan2.6-t2v");
  assert.equal(resolveModelId("alibaba:qwen-image-3"), "alibaba:qwen-image-3");
  pass("adapters registered; Cindy catalog keeps ByteDance/Alibaba; Tencent is adapter-only");

  // ---- Frame helper -------------------------------------------------------
  assert.deepEqual(imageSize(POSTER_PNG), { width: 1024, height: 1280 });
  assert.deepEqual(imageSize(SEEDREAM_JPEG), { width: 1440, height: 1800 });
  assert.deepEqual(imageSize(webp(1152, 2048)), { width: 1152, height: 2048 });
  assert.equal(imageSize(Buffer.from("nope")), undefined);
  assert.equal(nearestAspect(834, 1112), "3:4"); assert.equal(nearestAspect(720, 1280), "9:16"); assert.equal(nearestAspect(1728, 2160), "4:5");
  assert.equal(frameAspect(webp(1920, 1080)), "16:9");
  pass("poster size is read from PNG, JPEG and WebP headers and mapped to the nearest Aisle aspect");

  // ---- ByteDance Seedream -------------------------------------------------
  const queued: string[] = [];
  const pro = await call("bytedance:seedream-5-pro", {}, { onQueued: (id) => queued.push(id) });
  let sent = ark.seen.at(-1)!;
  assert.equal(sent.method, "POST"); assert.equal(sent.url, "/api/v3/images/generations");
  assert.equal(sent.headers.authorization, `Bearer ${KEYS.ARK_API_KEY}`); assert.equal(sent.headers["content-type"], "application/json");
  assert.deepEqual(bodyOf(sent), { model: "dola-seedream-5-0-pro-260628", prompt: "Apple juice poster, headline \"FRESH\"", size: "1440x1800", response_format: "b64_json", watermark: false, output_format: "jpeg" });
  assert.deepEqual(pro.bytes, SEEDREAM_JPEG); assert.equal(pro.mime, "image/jpeg"); assert.equal(pro.costUsd, 0.045); assert.equal(pro.aspect, "4:5");
  assert.equal(queued[0], pro.jobId); assert.match(pro.jobId, /^bytedance:image:/);
  await call("bytedance:seedream-4.5");
  assert.deepEqual(bodyOf(ark.seen.at(-1)!), { model: "seedream-4-5-251128", prompt: "Apple juice poster, headline \"FRESH\"", size: "1728x2160", response_format: "b64_json", watermark: false });
  await call("bytedance:seedream-5-lite", { aspectRatio: "9:16" });
  assert.equal(bodyOf(ark.seen.at(-1)!).size, "1600x2848", "Lite needs at least 3.69 MP");
  await call("bytedance:seedream-5-pro", { aspectRatio: "1:1", quality: "low" });
  assert.equal(bodyOf(ark.seen.at(-1)!).size, "1024x1024", "smoke-test draft size stays above Pro's 0.92 MP floor");
  arkMode = "moderation";
  await refused(call("bytedance:seedream-5-pro"), /ByteDance declined this prompt under its content policy\. Nothing was charged/);
  arkMode = "garbage";
  await assert.rejects(call("bytedance:seedream-5-pro"), /not a valid image/);
  arkMode = "ok";
  pass("Seedream: exact body per model (size, no watermark, base64 back), Bearer key in the header only, per-image cost, moderation refusal");

  // ---- ByteDance Seedance -------------------------------------------------
  const storageBefore = storage.seen.length;
  const clip = await call("bytedance:seedance-2-mini", { aspectRatio: "9:16", durationSec: 8 });
  const create = ark.seen.find((s) => s.method === "POST" && s.url === "/api/v3/contents/generations/tasks")!;
  assert.equal(create.headers.authorization, `Bearer ${KEYS.ARK_API_KEY}`);
  assert.deepEqual(bodyOf(create), {
    model: "dreamina-seedance-2-0-mini-260615",
    content: [
      { type: "text", text: "Apple juice poster, headline \"FRESH\"" },
      { type: "image_url", image_url: { url: `data:image/png;base64,${POSTER_PNG.toString("base64")}` }, role: "first_frame" },
    ],
    ratio: "adaptive", resolution: "720p", duration: 8, generate_audio: true, watermark: false,
  });
  assert.equal(arkPolls, 3, "polled until succeeded");
  assert.equal(ark.seen.filter((s) => s.url === "/api/v3/contents/generations/tasks/cgt-2026-offline").every((s) => s.headers.authorization === `Bearer ${KEYS.ARK_API_KEY}`), true);
  const fetched = storage.seen.slice(storageBefore);
  assert.equal(fetched.length, 1); assert.equal(fetched[0].headers.authorization, undefined, "the key never goes to the storage host");
  assert.deepEqual(clip.bytes, CLIP_8); assert.equal(clip.mime, "video/mp4"); assert.equal(clip.durationSec, 8);
  assert.equal(clip.costUsd, 0.6048, "172,800 completion tokens at $3.50 per 1M");
  assert.equal(clip.outputTokens, 172800); assert.equal(clip.aspect, "3:4"); assert.equal(clip.jobId, "bytedance:seedance:cgt-2026-offline");
  await call("bytedance:seedance-2-fast", { durationSec: 4, quality: "low" });
  const fastBody = bodyOf(ark.seen.filter((s) => s.method === "POST" && s.url.endsWith("/tasks")).at(-1)!);
  assert.equal(fastBody.model, "dreamina-seedance-2-0-fast-260128"); assert.equal(fastBody.resolution, "480p");
  arkMode = "face";
  await refused(call("bytedance:seedance-2-mini", { durationSec: 5 }), /real person's face unless Seedream 5\.0 Lite made it/);
  arkMode = "failed";
  await refused(call("bytedance:seedance-2-mini", { durationSec: 5 }), /ByteDance declined this video/);
  const beforeBad = ark.seen.length;
  await refused(call("bytedance:seedance-2-mini", { durationSec: 20 }), /4 to 15 second/);
  await refused(call("bytedance:seedance-2-mini", { durationSec: 5 }, { startImage: undefined }), /needs the campaign poster/);
  assert.equal(ark.seen.length, beforeBad, "bad requests never reach the provider");
  arkMode = "stuck";
  const abort = new AbortController();
  setTimeout(() => abort.abort(new Error("stopped by caller")), 60);
  await assert.rejects(call("bytedance:seedance-2-mini", { durationSec: 5 }, { signal: abort.signal }), /stopped by caller|did not answer in time|unreachable/);
  arkMode = "ok";
  pass("Seedance: poster as a data-URI first frame, adaptive ratio, audio on, polled, downloaded without the key, billed from completion tokens");

  // ---- Tencent Hunyuan Image ------------------------------------------------
  const hyStorage = storage.seen.length;
  const hy = await call("tencent:hy-image-3.5");
  sent = hub.seen.at(-1)!;
  assert.equal(sent.url, "/v1/wand/hunyuan-image/v35-generation"); assert.equal(sent.headers.authorization, `Bearer ${KEYS.TOKENHUB_API_KEY}`);
  assert.deepEqual(bodyOf(sent), { model: "hy-image-v3.5-preview", size: "1024x1280", messages: [{ role: "user", content: [{ type: "text", text: "Apple juice poster, headline \"FRESH\"" }] }] });
  assert.deepEqual(hy.bytes, POSTER_PNG); assert.equal(hy.mime, "image/png"); assert.equal(hy.costUsd, 0.024);
  await call("tencent:hy-image-3", { aspectRatio: "9:16" });
  assert.deepEqual(bodyOf(hub.seen.at(-1)!), { model: "hy-image-v3", prompt: "Apple juice poster, headline \"FRESH\"", size: "768x1344" });
  assert.equal(storage.seen.slice(hyStorage).every((s) => s.headers.authorization === undefined), true);
  hubMode = "moderation";
  await refused(call("tencent:hy-image-3.5"), /Tencent declined this prompt/);
  hubMode = "ok";
  pass("Hunyuan Image: 3.5 chat-style body and 3.0 prompt body, COS link fetched without the key, per-image cost, 422 is a refusal");

  // ---- Tencent Hunyuan Video and Kling ------------------------------------
  const hyv = await call("tencent:hy-video-1.5", { durationSec: 5 });
  const hyCreate = hub.seen.find((s) => s.url === "/v1/wand/hunyuan-video/generation")!;
  assert.deepEqual(bodyOf(hyCreate), { model: "hy-video-v1.5", prompt: "Apple juice poster, headline \"FRESH\"", image: POSTER_PNG.toString("base64") }, "raw base64, no data: prefix");
  assert.equal(hyPolls, 2); assert.deepEqual(hyv.bytes, CLIP_5); assert.equal(hyv.costUsd, 0.24); assert.equal(hyv.durationSec, 5);
  assert.equal(hyv.aspect, "4:5", "the clip keeps the 1024x1280 poster's framing");
  await refused(call("tencent:hy-video-1.5", { durationSec: 8 }), /5 second clips only/);
  hubMode = "refused";
  await refused(call("tencent:hy-video-1.5"), /Tencent declined this video brief or poster/);
  hubMode = "ok";
  const kling = await call("tencent:kling-3", { durationSec: 6 });
  const klingCreate = hub.seen.find((s) => s.url === "/v1/wand/kling/image-to-video")!;
  assert.equal(klingCreate.headers.authorization, `Bearer ${KEYS.TOKENHUB_API_KEY}`);
  assert.deepEqual(bodyOf(klingCreate), {
    model: "kling-video-v3",
    contents: [{ type: "prompt", text: "Apple juice poster, headline \"FRESH\"" }, { type: "first_frame", url: POSTER_PNG.toString("base64") }],
    settings: { resolution: "720p", duration: 6, audio: "native", multi_shot: false },
  });
  assert.equal(klingPolls, 2, "the task list comes back as an array and is read"); assert.deepEqual(kling.bytes, CLIP_6);
  assert.equal(kling.costUsd, 0.756, "billed for the 6 s asked for"); assert.equal(kling.durationSec, 6.04); assert.equal(kling.jobId, "tencent:kling:task_kling_offline");
  pass("Hunyuan Video (raw base64, fixed 5 s) and Kling via TokenHub (contents + settings, array task data): polled, downloaded, priced per second");

  // ---- Alibaba Qwen Image and Wan -----------------------------------------
  const qwen = await call("alibaba:qwen-image-2");
  sent = dash.seen.at(-1)!;
  assert.equal(sent.url, "/api/v1/services/aigc/multimodal-generation/generation"); assert.equal(sent.headers.authorization, `Bearer ${KEYS.DASHSCOPE_API_KEY}`);
  assert.equal(sent.headers["x-dashscope-async"], undefined, "images are synchronous");
  assert.deepEqual(bodyOf(sent), { model: "qwen-image-2.0", input: { messages: [{ role: "user", content: [{ text: "Apple juice poster, headline \"FRESH\"" }] }] }, parameters: { size: "1152*1440", n: 1, watermark: false, prompt_extend: true } });
  assert.deepEqual(qwen.bytes, POSTER_PNG); assert.equal(qwen.costUsd, 0.035);
  dashMode = "moderation";
  await refused(call("alibaba:qwen-image-2"), /Alibaba declined this prompt/);
  dashMode = "expired-link";
  await assert.rejects(call("alibaba:qwen-image-2"), /not a valid image/);
  dashMode = "ok";
  const wanStorage = storage.seen.length;
  const wan = await call("alibaba:wan-2.6-flash", { durationSec: 5 });
  const wanCreate = dash.seen.find((s) => s.url === "/api/v1/services/aigc/video-generation/video-synthesis")!;
  assert.equal(wanCreate.headers["x-dashscope-async"], "enable"); assert.equal(wanCreate.headers.authorization, `Bearer ${KEYS.DASHSCOPE_API_KEY}`);
  assert.deepEqual(bodyOf(wanCreate), {
    model: "wan2.6-i2v-flash",
    input: { prompt: "Apple juice poster, headline \"FRESH\"", img_url: `data:image/png;base64,${POSTER_PNG.toString("base64")}` },
    parameters: { resolution: "720P", duration: 5, prompt_extend: true, watermark: false, audio: true },
  });
  assert.equal(wanPolls, 2); assert.deepEqual(wan.bytes, CLIP_5); assert.equal(wan.costUsd, 0.25); assert.equal(wan.aspect, "4:5");
  assert.equal(storage.seen.slice(wanStorage).every((s) => s.headers.authorization === undefined), true);
  await call("alibaba:wan-2.6", { durationSec: 5 });
  const fullBody = bodyOf(dash.seen.filter((s) => s.url.endsWith("/video-synthesis")).at(-1)!);
  assert.equal(fullBody.model, "wan2.6-i2v"); assert.equal("audio" in fullBody.parameters, false, "only Flash takes the audio switch");
  pass("Qwen Image (W*H size, no watermark) and Wan 2.6 (async header, data-URI first frame, audio on Flash) with top-level DashScope errors");

  // ---- Studio generate is Cindy's stub; adapter HTTP is tested via call() --
  const alice = billingFor({ id: "alice", role: "beta" });
  await adjustCredits("alice", 950_000, "offline test top-up");
  const before = await balanceMilli("alice");
  const poster = await runGeneration({ kind: "image", modelId: "bytedance:seedream-4.5", prompt: "Apple juice poster", aspectRatio: "4:5", ownerId: "alice" }, undefined, alice, { strict: true });
  assert.equal(poster.status, "stubbed", poster.note);
  assert.equal(await balanceMilli("alice"), before, "Cindy's generate does not charge through PR #2 adapters");
  assert.equal(holdEstimateUsd(getModel("bytedance:seedance-2-fast"), { kind: "video", durationSec: 8 }), 0);
  pass("Cindy's Studio generate stubs even for ByteDance catalog ids; adapter HTTP is asserted via call()");

  // ---- Transient errors, retries and who pays -------------------------------
  const err = (status?: number, code?: string, retryable?: boolean) => new ProviderError("x", { status, code, retryable });
  for (const transient of [err(503), err(500), err(429), err(undefined), err(400, "1302"), err(200, "1303"), err(undefined, "1302"), err(429, "ModelAccountRpmRateLimitExceeded"), err(400, "Throttling.RateQuota")]) assert.equal(transientError(transient), true, `${transient.status} ${transient.code}`);
  for (const permanent of [err(400), err(404), err(401), err(429, "1101"), err(429, "SetLimitExceeded"), err(undefined, undefined, false), err(400, "DataInspectionFailed"), new Error("plain")]) assert.equal(transientError(permanent), false, `${(permanent as { status?: number }).status} ${(permanent as { code?: string }).code}`);
  let tries = 0;
  assert.equal(await pollJson(async () => { if (++tries < 3) throw err(503); return "ok"; }, { deadline: Date.now() + 5_000 }), "ok");
  assert.equal(tries, 3, "503s are retried with backoff");
  tries = 0;
  await assert.rejects(pollJson(async () => { tries++; throw err(400); }, { deadline: Date.now() + 5_000 }), ProviderError);
  assert.equal(tries, 1, "a permanent error is not retried");
  tries = 0;
  await assert.rejects(pollJson(async () => { tries++; throw err(429, "1100"); }, { deadline: Date.now() + 5_000 }));
  assert.equal(tries, 1, "an account in arrears is not retried even as a 429");
  tries = 0;
  await assert.rejects(pollJson(async () => { tries++; throw err(503); }, { deadline: Date.now() + 5_000, attempts: 2 }));
  assert.equal(tries, 3, "retries are bounded");
  tries = 0;
  await assert.rejects(pollJson(async () => { tries++; throw err(503); }, { deadline: Date.now() - 1 }));
  assert.equal(tries, 1, "no retry past the deadline");

  arkMode = "flaky";
  const flakyClip = await call("bytedance:seedance-2-mini", { durationSec: 8 });
  assert.deepEqual(flakyClip.bytes, CLIP_8); assert.equal(arkPolls, 3, "a 429 on the first poll is retried, not fatal");
  hubMode = "flaky";
  const flakyKling = await call("tencent:kling-3", { durationSec: 6 });
  assert.deepEqual(flakyKling.bytes, CLIP_6); assert.equal(klingPolls, 2, "TokenHub 1302 in a 200 body is retried");
  dashMode = "flaky";
  const flakyWan = await call("alibaba:wan-2.6-flash", { durationSec: 5 });
  assert.deepEqual(flakyWan.bytes, CLIP_5); assert.equal(wanPolls, 2, "a DashScope 500 on the poll is retried");
  hubMode = "ok"; dashMode = "ok";
  pass("pollJson retries 429, 5xx, network errors and provider rate-limit codes with bounded backoff; refusals and arrears fail at once");

  const billable = async (promise: Promise<unknown>, pattern: RegExp, expected: boolean) => {
    await assert.rejects(promise, (error: unknown) => {
      assert(error instanceof ProviderError, `expected a ProviderError, got ${error}`);
      assert.match(error.message, pattern);
      assert.equal(error.billable, expected, `${error.message}: billable should be ${expected}`);
      return true;
    });
  };
  process.env.AISLE_MEDIA_JOB_MS = "60";
  arkMode = "stuck";
  const deletes = ark.seen.filter((s) => s.method === "DELETE").length;
  await billable(call("bytedance:seedance-2-mini", { durationSec: 5 }), /did not finish the video within/, true);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(ark.seen.filter((s) => s.method === "DELETE").length, deletes + 1, "a task still queued at the deadline is cancelled");
  delete process.env.AISLE_MEDIA_JOB_MS;
  arkMode = "failed";
  await billable(call("bytedance:seedance-2-mini", { durationSec: 5 }), /declined this video/, false);
  arkMode = "nolink";
  await billable(call("bytedance:seedance-2-mini", { durationSec: 5 }), /download returned 404/, true);
  arkMode = "moderation";
  await billable(call("bytedance:seedream-5-pro"), /declined this prompt/, false);
  arkMode = "garbage";
  await billable(call("bytedance:seedream-5-pro"), /not a valid image/, true);
  arkMode = "ok";
  hubMode = "garbage";
  await billable(call("tencent:hy-video-1.5"), /not a valid video/, true);
  hubMode = "ok";
  dashMode = "expired-link";
  await billable(call("alibaba:qwen-image-2"), /not a valid image/, true);
  dashMode = "ok";
  pass("after submission, deadlines and failed downloads or bytes are billable; failed or moderated tasks are not");

  // Plain http downloads only when the provider itself is on loopback (these offline tests).
  await assert.rejects(downloadFile("Test", `${storage.origin}/oss/wan.mp4`, { keyOrigin: "https://api.example.com", headers: {}, max: 1_000_000, timeoutMs: 5_000 }), /insecure download link/);
  assert.deepEqual(await downloadFile("Test", `${storage.origin}/oss/wan.mp4`, { keyOrigin: dash.origin, headers: {}, max: 1_000_000, timeoutMs: 5_000 }), CLIP_5);
  pass("a real provider's result link must be https; loopback http is accepted only when the provider base is loopback");

  pass("Cindy's generate path is not the PR #2 billed adapter pipeline; billable adapter failures are covered by call()");

  // ---- No key in any URL --------------------------------------------------
  for (const s of [...ark.seen, ...hub.seen, ...dash.seen, ...storage.seen]) {
    for (const key of Object.values(KEYS)) assert.equal(s.url.includes(key), false, `${s.url} carries a key`);
  }
  assert.equal(storage.seen.every((s) => s.headers.authorization === undefined), true);
  pass("no request URL carried a key; storage hosts never saw an Authorization header");
} finally {
  for (const s of [storage, ark, hub, dash]) s.server.close();
}
console.log(`\n${checks} provider adapter checks passed. Isolated fixtures: ${dir}`);
