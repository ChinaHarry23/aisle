/**
 * Offline checks for cloud posters and ad videos: fake OpenAI, Google, storage
 * and ComfyUI servers on loopback, a throwaway SQLite database and media dir.
 * No real provider is called and no real account is touched.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(os.tmpdir(), "aisle-cloud-media-test-"));
for (const name of ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "AISLE_DATABASE_URL", "NEON_DATABASE_URL", "STORAGE_URL", "AISLE_MEDIA_PROVIDERS", "AISLE_MEDIA_DRIVER", "GEMINI_API_KEY", "VERCEL"]) delete process.env[name];
Object.assign(process.env, {
  AISLE_DB: "sqlite",
  AISLE_DB_FILE: path.join(dir, "aisle.db"),
  AISLE_MEDIA_DIR: path.join(dir, "media"),
  AISLE_MEDIA_PROGRESS_DB: path.join(dir, "progress.db"),
  AISLE_MEDIA_POLL_MS: "5",
  OPENAI_API_KEY: "sk-test-openai-offline",
  GOOGLE_AI_API_KEY: "test-google-offline",
  COMFYUI_URL: "http://127.0.0.1:9",
});

const { runGeneration, renderingModel, holdEstimateUsd } = await import("../src/lib/media/generate");
const { MEDIA_ADAPTERS, usableProvider, providerAvailability, comfyAvailability, resetComfyProbe } = await import("../src/lib/media/providers");
const { estimateUsage } = await import("../src/lib/media/estimate");
const { keptTake } = await import("../src/lib/media/kept-take");
const { putMedia, readMedia, MediaNotFoundError, sniffMime } = await import("../src/lib/media/store");
const { mediaResponse, MAX_RANGE_BYTES } = await import("../src/lib/media/assets");
const { campaignMediaUrl } = await import("../src/lib/media/url");
const { getModel, MEDIA_MODELS, resolveModelId } = await import("../src/lib/media/catalog");
const { applyStudioMedia } = await import("../src/lib/media/persistence");
const { billingFor, InsufficientCreditsError, UNMETERED_TEST } = await import("../src/lib/billing/meter");
const { adjustCredits, balanceMilli, recentLedger } = await import("../src/lib/billing/ledger");
const { milliForCost } = await import("../src/lib/billing/plan");
const { blankCampaign, defaultBrand } = await import("../src/lib/seed");
const { defaultSettings } = await import("../src/lib/settings");

let checks = 0;
const pass = (label: string) => { checks++; console.log(`PASS ${label}`); };
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

// ---- Fixtures -------------------------------------------------------------
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("offline poster png fixture")]);
const JPEG = Buffer.concat([Buffer.from("ffd8ffe0", "hex"), Buffer.from("offline poster jpeg fixture")]);
function mp4(seconds: number) {
  const ftyp = Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from("ftypisom"), Buffer.from([0, 0, 2, 0])]);
  const mvhd = Buffer.alloc(108);
  mvhd.writeUInt32BE(108, 0); mvhd.write("mvhd", 4, "latin1");
  mvhd.writeUInt32BE(1000, 20); mvhd.writeUInt32BE(seconds * 1000, 24);
  const moov = Buffer.alloc(8); moov.writeUInt32BE(116, 0); moov.write("moov", 4, "latin1");
  return Buffer.concat([ftyp, moov, mvhd]);
}
const OMNI_MP4 = mp4(8);
const VEO_MP4 = mp4(6);

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

let openaiMode: "ok" | "moderation" | "garbage" = "ok";
const openai = await serve((req, res) => {
  if (req.method === "POST" && req.url === "/v1/images/generations") {
    if (openaiMode === "moderation") return json(res, 400, { error: { type: "image_generation_user_error", code: "moderation_blocked", message: "Request blocked by the safety system." } });
    const image = openaiMode === "garbage" ? Buffer.from("<html>not an image</html>") : JPEG;
    return json(res, 200, { created: 1, output_format: "jpeg", data: [{ b64_json: image.toString("base64") }], usage: { input_tokens: 120, input_tokens_details: { text_tokens: 120, image_tokens: 0 }, output_tokens: 2000, total_tokens: 2120 } });
  }
  json(res, 404, { error: { message: "not found" } });
});

const storage = await serve((req, res) => {
  if (req.url === "/blob/veo-1") return res.writeHead(200, { "Content-Type": "video/mp4" }).end(VEO_MP4);
  res.writeHead(404).end();
});

let omniPolls = 0, veoPolls = 0;
/** flaky: the first two polls fail (503, then 429); failed: Google reports a moderated failure; stuck: never finishes. */
let omniMode: "ok" | "flaky" | "failed" | "stuck" = "ok";
/** Nano Banana usage block: full counts, `{}`, or zero output tokens. */
let bananaUsage: "full" | "empty" | "zero" = "full";
const google = await serve((req, res) => {
  const url = new URL(req.url, "http://fake");
  if (req.method === "POST" && url.pathname === "/v1beta/interactions") {
    const body = JSON.parse(req.body);
    if (body.response_format?.type === "image") {
      const usage = bananaUsage === "empty" ? {} : bananaUsage === "zero" ? { total_input_tokens: 100, total_output_tokens: 0 } : { total_input_tokens: 100, total_output_tokens: 1120, total_thought_tokens: 200, output_tokens_by_modality: [{ modality: "image", tokens: 1120 }] };
      return json(res, 200, { id: "img-1", status: "completed", steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: PNG.toString("base64") }] }], usage });
    }
    omniPolls = 0;
    return json(res, 200, { id: "omni-1", status: "in_progress" });
  }
  if (req.method === "GET" && url.pathname === "/v1beta/interactions/omni-1") {
    omniPolls++;
    if (omniMode === "flaky" && omniPolls === 1) return json(res, 503, { error: { code: 503, message: "The service is currently unavailable.", status: "UNAVAILABLE" } });
    if (omniMode === "flaky" && omniPolls === 2) return json(res, 429, { error: { code: 429, message: "Resource has been exhausted.", status: "RESOURCE_EXHAUSTED" } });
    if (omniMode === "stuck") return json(res, 200, { id: "omni-1", status: "in_progress" });
    if (omniMode === "failed" && omniPolls >= 2) return json(res, 200, { id: "omni-1", status: "failed", error: { message: "The output was blocked by a safety filter." } });
    if (omniPolls < 2) return json(res, 200, { id: "omni-1", status: "in_progress" });
    return json(res, 200, { id: "omni-1", status: "completed", steps: [{ type: "model_output", content: [{ type: "video", mime_type: "video/mp4", data: OMNI_MP4.toString("base64") }] }], usage: { total_input_tokens: 1300, total_output_tokens: 46336, total_thought_tokens: 500, output_tokens_by_modality: [{ modality: "video", tokens: 46336 }] } });
  }
  if (req.method === "DELETE" && url.pathname === "/v1beta/interactions/omni-1") return json(res, 200, {});
  if (req.method === "POST" && url.pathname === "/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning") {
    veoPolls = 0;
    return json(res, 200, { name: "models/veo-3.1-fast-generate-preview/operations/op-1" });
  }
  if (req.method === "GET" && url.pathname === "/v1beta/models/veo-3.1-fast-generate-preview/operations/op-1") {
    veoPolls++;
    if (veoPolls < 2) return json(res, 200, { name: "op-1", done: false });
    return json(res, 200, { name: "op-1", done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `${google.origin}/v1beta/files/veo-1:download?alt=media` } }] } } });
  }
  if (req.method === "GET" && url.pathname === "/v1beta/files/veo-1:download") {
    // Google answers the keyed download with a redirect to storage.
    return res.writeHead(302, { Location: `${storage.origin}/blob/veo-1` }).end();
  }
  json(res, 404, { error: { message: `no fake for ${req.method} ${url.pathname}` } });
});

const comfy = await serve((req, res) => {
  const url = new URL(req.url, "http://fake");
  if (url.pathname === "/system_stats") return json(res, 200, { devices: [{ type: "cuda" }] });
  if (url.pathname.startsWith("/models/")) return json(res, 200, ["z_image_turbo_bf16.safetensors", "qwen_3_4b.safetensors", "ae.safetensors", "minimax_h3_fl2va_pruned_int8_convrot.safetensors", "qwen3vl_32b_minimax_h3_bf16.safetensors", "minimax_h3_video_vae_fp16.safetensors", "minimax_h3_audio_vae_fp32.safetensors"]);
  if (url.pathname === "/upload/image") return json(res, 200, { name: "aisle-start.jpg" });
  if (url.pathname === "/prompt") return json(res, 200, { prompt_id: "local-1" });
  if (url.pathname === "/history/local-1") return json(res, 200, { "local-1": { outputs: { "9": { images: [{ filename: "local.png", subfolder: "aisle", type: "output" }] } } } });
  res.writeHead(404).end();
});

process.env.OPENAI_API_BASE = `${openai.origin}/v1`;
process.env.GOOGLE_API_BASE = `${google.origin}/v1beta`;
const providerRequests = () => openai.seen.length + google.seen.length + storage.seen.length;
const alice = billingFor({ id: "alice", role: "beta" });

try {
  // ---- Catalog and availability ------------------------------------------
  for (const retired of ["google:imagen-4", "google:imagen-4-fast", "google:imagen-4-ultra", "openai:gpt-image-1-mini", "openai:sora-2", "openai:sora-2-pro"]) {
    assert.equal(MEDIA_MODELS.some(m => m.id === retired), false, retired);
    assert.notEqual(resolveModelId(retired), retired);
    getModel(retired); // old saved settings still resolve
  }
  for (const id of ["google:veo-3.1-fast", "google:veo-3.1", "google:veo-3.1-lite"]) {
    const veo = getModel(id);
    assert.match(veo.apiModel, /-preview$/); assert.equal(veo.sunset, "2026-10-22"); assert.deepEqual(veo.durations, [4, 6, 8]);
  }
  assert.deepEqual(getModel("google:veo-3.1-fast").billing, { mode: "per_second", usdPerSec: 0.1, estTokensPerSec: 700 });
  assert.equal(getModel("google:omni-flash").apiModel, "gemini-omni-1.1-flash");
  assert.equal(getModel("google:nano-banana-2").apiModel, "gemini-3.1-flash-image");
  assert.deepEqual(Object.keys(MEDIA_ADAPTERS).sort(), ["alibaba", "bytedance", "google", "openai", "tencent"]);
  assert.equal(usableProvider("openai"), true); assert.equal(usableProvider("google"), true);
  assert.equal(usableProvider("bfl"), false); assert.match(providerAvailability("bfl").reason!, /Not available/);
  process.env.AISLE_MEDIA_PROVIDERS = "openai";
  assert.equal(usableProvider("google"), false);
  assert.equal(renderingModel({ kind: "video", modelId: "google:omni-flash" }).providerId, "comfy");
  delete process.env.AISLE_MEDIA_PROVIDERS;
  delete process.env.GOOGLE_AI_API_KEY; process.env.GEMINI_API_KEY = "test-gemini-offline";
  assert.equal(usableProvider("google"), true, "GEMINI_API_KEY is accepted too");
  delete process.env.GEMINI_API_KEY;
  assert.equal(usableProvider("google"), false);
  assert.equal(renderingModel({ kind: "image", modelId: "google:nano-banana-2" }).id, "comfy:local");
  process.env.GOOGLE_AI_API_KEY = "test-google-offline";
  assert.equal(JSON.stringify(providerAvailability("openai")).includes("sk-test"), false);
  pass("retired models gone but resolvable; Veo ids, prices, sunsets; usable = adapter + key + allowlist");

  // ---- GPT Image 2: charged from usage x2 ---------------------------------
  await adjustCredits("alice", 950_000, "offline test top-up"); // 50 free + 950 = 1,000 credits
  const before = await balanceMilli("alice");
  const queued: string[] = [];
  const poster = await runGeneration({ kind: "image", modelId: "openai:gpt-image-2", prompt: "Apple juice poster", aspectRatio: "4:5", ownerId: "alice" }, id => queued.push(id), alice, { strict: true });
  assert.equal(poster.status, "ok", poster.note);
  assert.match(poster.url!, /^aisle-media:[a-f0-9]{64}$/);
  assert.equal(poster.usage.estimate, false);
  const imageCost = (120 * 5 + 2000 * 30) / 1e6;
  assert.equal(poster.usage.costUsd, imageCost);
  assert.equal(before - await balanceMilli("alice"), milliForCost(imageCost));
  assert.equal(milliForCost(imageCost), Math.ceil(imageCost * 2 / 0.01 * 1000));
  assert.equal(queued[0], poster.promptId); assert.match(poster.promptId!, /^openai:/);
  const sent = openai.seen.at(-1)!;
  assert.equal(sent.headers.authorization, "Bearer sk-test-openai-offline");
  assert.equal(sent.url.includes("sk-test"), false);
  const sentBody = JSON.parse(sent.body);
  assert.equal(sentBody.size, "1024x1280"); assert.equal(sentBody.model, "gpt-image-2"); assert.equal(sentBody.quality, "medium");
  assert.equal("response_format" in sentBody, false);
  const usage = (await recentLedger("alice")).find(e => e.reason === "usage");
  assert.equal(usage?.deltaMilli, -milliForCost(imageCost)); assert.equal(usage?.modelId, "openai:gpt-image-2");
  const read = await readMedia(poster.url!, "image", "alice");
  assert.deepEqual(read.bytes, JPEG); assert.equal(read.mime, "image/jpeg");
  pass("GPT Image 2 decodes base64, stores bytes, charges 2x the usage-token cost, key only in the header");

  // ---- Owner check and URL routing ----------------------------------------
  await assert.rejects(readMedia(poster.url!, "image", "bob"), MediaNotFoundError);
  await assert.rejects(readMedia(poster.url!, "video", "alice"), MediaNotFoundError);
  await assert.rejects(readMedia("aisle-media:../../etc/passwd", "image", "alice"), MediaNotFoundError);
  await assert.rejects(readMedia(`aisle-media:${"0".repeat(64)}`, "image", "alice"), MediaNotFoundError);
  // A user-saved generation.url cannot reach other ComfyUI files (uploads, outputs outside aisle/): plain 404.
  for (const query of ["filename=aisle-start-1.png&type=input", "filename=ComfyUI_00042_.png&type=output", "filename=x.png&type=output&subfolder=aisle%2F..%2Fother"]) {
    await assert.rejects(readMedia(`${process.env.COMFYUI_URL}/view?${query}`, "image", "alice"), MediaNotFoundError, query);
  }
  assert.equal(campaignMediaUrl("c1", "cr1", poster), `/api/studio/assets/c1/image/cr1?v=${encodeURIComponent(poster.at)}`);
  assert.equal(campaignMediaUrl(undefined, "cr1", poster), undefined, "stored media is never handed to the browser raw");
  await assert.rejects(putMedia({ ownerId: "alice", kind: "image", bytes: Buffer.from("<svg/>"), mime: "image/png" }), /not a valid image/);
  await assert.rejects(putMedia({ ownerId: "alice", kind: "video", bytes: PNG, mime: "image/png" }), /not a valid video/);
  await assert.rejects(putMedia({ ownerId: "alice", kind: "image", bytes: PNG, mime: "image/jpeg" }), /said image\/jpeg/);
  assert.equal(sniffMime(mp4(1)), "video/mp4");
  process.env.AISLE_MEDIA_DRIVER = "db";
  const dbStored = await putMedia({ ownerId: "dora", kind: "image", bytes: PNG, mime: "image/png" });
  assert.deepEqual((await readMedia(dbStored.url, "image", "dora")).bytes, PNG);
  await assert.rejects(readMedia(dbStored.url, "image", "alice"), MediaNotFoundError);
  delete process.env.AISLE_MEDIA_DRIVER;
  pass("stored media reads are owner-checked (fs and db drivers), type-checked by magic number, and routed through the asset API");

  // ---- Nano Banana 2 ------------------------------------------------------
  const banana = await runGeneration({ kind: "image", modelId: "google:nano-banana-2", prompt: "Juice", aspectRatio: "4:5", ownerId: "alice" }, undefined, alice);
  assert.equal(banana.status, "ok", banana.note);
  assert.equal(banana.usage.costUsd, Math.round(((100 * 0.5 + 1120 * 60 + 200 * 3) / 1e6) * 10000) / 10000);
  const bananaReq = google.seen.find(s => s.method === "POST" && s.url === "/v1beta/interactions")!;
  assert.equal(bananaReq.headers["x-goog-api-key"], "test-google-offline");
  assert.equal(bananaReq.url.includes("key="), false);
  assert.deepEqual(JSON.parse(bananaReq.body).response_format, { type: "image", aspect_ratio: "4:5", image_size: "1K" });
  assert.equal(JSON.parse(bananaReq.body).store, false);
  pass("Nano Banana 2 via Interactions: header key, 4:5 at 1K, billed from usage including thinking tokens");

  // ---- Omni Flash: polling, provenance ------------------------------------
  const omniQueued: string[] = [];
  const omniBefore = await balanceMilli("alice");
  const omni = await runGeneration({ kind: "video", modelId: "google:omni-flash", prompt: "8-second slow push-in", durationSec: 8, aspectRatio: "9:16", startImageUrl: poster.url!, ownerId: "alice" }, id => omniQueued.push(id), alice, { strict: true });
  assert.equal(omni.status, "ok", omni.note);
  assert(omniPolls >= 2, "polled until completed");
  assert.equal(omni.promptId, "google:omni:omni-1"); assert.deepEqual(omniQueued, ["google:omni:omni-1"]);
  assert.equal(omni.sourceImageUrl, poster.url);
  const omniCreate = google.seen.find(s => s.method === "POST" && s.url === "/v1beta/interactions" && JSON.parse(s.body).response_format.type === "video")!;
  const omniBody = JSON.parse(omniCreate.body);
  const sentImage = Buffer.from(omniBody.input[0].data, "base64");
  assert.equal(omni.inputImageSha256, sha(sentImage), "provenance hashes the exact bytes sent");
  assert.equal(omni.inputImageSha256, sha(JPEG));
  assert.equal(omniBody.input[0].mime_type, "image/jpeg"); assert.match(omniBody.input[1].text, /\[0-8s\]/);
  assert.equal(omniBody.response_format.aspect_ratio, "9:16"); assert.equal(omniBody.background, true);
  assert.equal(omni.aspect, "9:16"); assert.equal(omni.usage.units, 8, "clip length read from the MP4");
  const omniCost = Math.round(((1300 * 1.5 + 46336 * 17.5 + 500 * 9) / 1e6) * 10000) / 10000;
  assert.equal(omni.usage.costUsd, omniCost);
  assert.equal(omniBefore - await balanceMilli("alice"), milliForCost(omniCost));
  await new Promise(resolve => setTimeout(resolve, 50)); // the clean-up DELETE is fire-and-forget
  assert(google.seen.some(s => s.method === "DELETE" && s.url === "/v1beta/interactions/omni-1"), "the stored interaction holding the poster is deleted");
  assert.deepEqual((await readMedia(omni.url!, "video", "alice")).bytes, OMNI_MP4);
  const campaign = blankCampaign({ name: "Cloud fixture", product: "Apple juice", category: "Beverages", targetAudience: "Adults", objective: "Draft", budget: 500, channels: ["web"], startDate: "2026-10-05", endDate: "2026-10-18", country: "AU", notes: "Offline" }, defaultBrand, null, defaultSettings());
  campaign.status = "awaiting_approval";
  campaign.creatives = [{ id: "creative-a", variant: "A", version: 1, kicker: "", headline: "Pause", subhead: "", cta: "Explore", caption: "", palette: { bg: "#fff", fg: "#111", accent: "#393", muted: "#ccc" }, motif: "produce", status: "flagged", prompt: "Apples", generation: poster }];
  const attached = applyStudioMedia(campaign, { kind: "video", sourceCreativeId: "creative-a", expectedUrl: poster.url!, video: { id: "vid-omni", version: 1, title: "Omni", prompt: "p", durationSec: 8, aspect: "9:16", status: "ready", generation: omni } });
  assert.equal(attached.videos[0].generation.promptId, "google:omni:omni-1");
  pass("Omni Flash: background create, bounded polling, inline MP4, usage billing, provenance accepted by applyStudioMedia");

  // ---- Veo 3.1 Fast: operation polling, keyed download, redirect ----------
  const veoBefore = await balanceMilli("alice");
  const veo = await runGeneration({ kind: "video", modelId: "google:veo-3.1-fast", prompt: "6-second push-in", durationSec: 6, aspectRatio: "9:16", startImageUrl: poster.url!, ownerId: "alice" }, undefined, alice, { strict: true });
  assert.equal(veo.status, "ok", veo.note);
  assert(veoPolls >= 2);
  const veoCreate = JSON.parse(google.seen.find(s => s.url.endsWith(":predictLongRunning"))!.body);
  assert.deepEqual(Object.keys(veoCreate.instances[0].image).sort(), ["bytesBase64Encoded", "mimeType"]);
  assert.equal(sha(Buffer.from(veoCreate.instances[0].image.bytesBase64Encoded, "base64")), veo.inputImageSha256);
  assert.deepEqual(veoCreate.parameters, { aspectRatio: "9:16", durationSeconds: 6, resolution: "720p", personGeneration: "allow_adult" });
  const keyedDownload = google.seen.find(s => s.url.startsWith("/v1beta/files/veo-1:download"))!;
  assert.equal(keyedDownload.headers["x-goog-api-key"], "test-google-offline");
  assert.equal(storage.seen.length, 1); assert.equal(storage.seen[0].headers["x-goog-api-key"], undefined, "the key never follows a redirect off the API origin");
  assert.equal(veo.usage.costUsd, 0.6); assert.equal(veoBefore - await balanceMilli("alice"), milliForCost(0.6));
  assert.equal(veo.promptId, "google:veo:models/veo-3.1-fast-generate-preview/operations/op-1");
  assert.equal(JSON.stringify(veo).includes("files/veo-1"), false, "the provider URI is never stored");
  const badDuration = await runGeneration({ kind: "video", modelId: "google:veo-3.1-fast", prompt: "x", durationSec: 5, aspectRatio: "9:16", startImageUrl: poster.url!, ownerId: "alice" }, undefined, alice, { strict: true });
  assert.equal(badDuration.status, "error"); assert.equal(await balanceMilli("alice"), veoBefore - milliForCost(0.6), "failed call releases its hold");
  pass("Veo 3.1 Fast: bytesBase64Encoded image, operation polling, keyed download with key-free redirect, per-second charge");

  // ---- Failures release holds, no retries ---------------------------------
  const failBefore = await balanceMilli("alice");
  const openaiCalls = openai.seen.length;
  openaiMode = "moderation";
  const blocked = await runGeneration({ kind: "image", modelId: "openai:gpt-image-2", prompt: "x", ownerId: "alice" }, undefined, alice, { strict: true });
  assert.equal(blocked.status, "error"); assert.match(blocked.note, /content policy/);
  assert.equal(openai.seen.length, openaiCalls + 1, "moderation blocks are not retried");
  assert.equal(await balanceMilli("alice"), failBefore, "a refused call gave its hold back");
  assert.equal(blocked.usage.costUsd, 0);
  openaiMode = "garbage";
  const garbage = await runGeneration({ kind: "image", modelId: "openai:gpt-image-2", prompt: "x", ownerId: "alice" }, undefined, alice);
  assert.equal(garbage.status, "error"); assert.match(garbage.note, /not a valid image/);
  openaiMode = "ok";
  // OpenAI generated (and billed) that image; unusable bytes settle the list estimate instead of charging nothing.
  const posterEstimate = estimateUsage(getModel("openai:gpt-image-2"), { prompt: "x" }).costUsd;
  assert.equal(garbage.usage.costUsd, posterEstimate);
  assert.equal(failBefore - await balanceMilli("alice"), milliForCost(posterEstimate));
  pass("moderation_blocked is a refusal (no retry, hold released); bad bytes after a success are rejected and settled at the estimate");

  // ---- C4/C14: the stage of a failure decides who pays -------------------
  await adjustCredits("alice", 3_000_000, "offline test top-up for the failure-stage checks");
  const omniReq = { kind: "video" as const, modelId: "google:omni-flash", prompt: "8-second slow push-in", durationSec: 8, aspectRatio: "9:16" as const, startImageUrl: poster.url!, ownerId: "alice" };
  const omniEstimate = estimateUsage(getModel("google:omni-flash"), omniReq).costUsd;
  omniMode = "flaky";
  let bal = await balanceMilli("alice");
  const flaky = await runGeneration(omniReq, undefined, alice, { strict: true });
  assert.equal(flaky.status, "ok", flaky.note);
  assert.equal(omniPolls, 3, "a 503 and a 429 on the poll were retried, then the clip was fetched");
  assert.equal(bal - await balanceMilli("alice"), milliForCost(omniCost), "charged the real usage, once");
  omniMode = "failed";
  bal = await balanceMilli("alice");
  const moderated = await runGeneration(omniReq, undefined, alice, { strict: true });
  assert.equal(moderated.status, "error"); assert.match(moderated.note, /blocked by a safety filter/);
  assert.equal(moderated.usage.costUsd, 0); assert.equal(moderated.promptId, "google:omni:omni-1", "the job id is kept for reconciling");
  assert.equal(await balanceMilli("alice"), bal, "a failure the provider reports (not billed) releases the whole hold");
  omniMode = "stuck";
  process.env.AISLE_MEDIA_JOB_MS = "80";
  bal = await balanceMilli("alice");
  const late = await runGeneration(omniReq, undefined, alice, { strict: true });
  assert.equal(late.status, "error"); assert.match(late.note, /did not finish the video within/); assert.match(late.note, /may still bill/);
  assert.equal(late.promptId, "google:omni:omni-1");
  assert.equal(late.usage.costUsd, omniEstimate);
  assert.equal(bal - await balanceMilli("alice"), milliForCost(omniEstimate), "a deadline after submission settles the estimate instead of releasing");
  assert.match((await recentLedger("alice")).find(e => e.reason === "usage")?.note ?? "", /unfinished; provider may bill google:omni:omni-1/);
  pass("transient 503/429 polls are retried; a deadline after submit is settled at the estimate; a moderated failure is released");

  // ---- C15: the caller's signal reaches the adapter ------------------------
  process.env.AISLE_MEDIA_JOB_MS = "5000"; // a signal that never arrived would fail on this deadline, not hang
  bal = await balanceMilli("alice");
  const stopper = new AbortController();
  setTimeout(() => stopper.abort(new DOMException("Studio budget reached", "TimeoutError")), 60);
  const stoppedAt = Date.now();
  const stopped = await runGeneration(omniReq, undefined, alice, { strict: true, signal: stopper.signal });
  assert(Date.now() - stoppedAt < 2_000, "the abort stopped polling at once");
  assert.equal(stopped.status, "error"); assert.match(stopped.note, /stopped waiting|did not answer in time/);
  assert.equal(bal - await balanceMilli("alice"), milliForCost(omniEstimate), "aborted after the job was accepted: settled, not released");
  const creates = google.seen.filter(s => s.method === "POST" && s.url === "/v1beta/interactions").length;
  bal = await balanceMilli("alice");
  const early = await runGeneration(omniReq, undefined, alice, { strict: true, signal: AbortSignal.abort() });
  assert.equal(early.status, "error");
  assert.equal(google.seen.filter(s => s.method === "POST" && s.url === "/v1beta/interactions").length, creates, "an aborted signal never submits");
  assert.equal(await balanceMilli("alice"), bal, "aborted before submission: released");
  delete process.env.AISLE_MEDIA_JOB_MS;
  omniMode = "ok";
  pass("runGeneration passes its abort signal to the adapter: abort after submit settles, abort before submit releases");

  // ---- putMedia failure after the provider delivered ----------------------
  const mediaDir = process.env.AISLE_MEDIA_DIR!;
  const notADir = path.join(dir, "not-a-directory");
  writeFileSync(notADir, "x");
  process.env.AISLE_MEDIA_DIR = notADir;
  bal = await balanceMilli("alice");
  const unstored = await runGeneration({ kind: "image", modelId: "openai:gpt-image-2", prompt: "Apple juice poster", aspectRatio: "4:5", ownerId: "alice" }, undefined, alice, { strict: true });
  process.env.AISLE_MEDIA_DIR = mediaDir;
  assert.equal(unstored.status, "error"); assert.match(unstored.note, /could not be stored/);
  assert.equal(unstored.usage.costUsd, imageCost); assert.match(unstored.promptId!, /^openai:/);
  assert.equal(bal - await balanceMilli("alice"), milliForCost(imageCost), "the provider billed the render, so its real cost is settled");
  pass("a store failure after the provider delivered settles the real cost rather than releasing the hold");

  // ---- C16: Omni takes its length from the prompt, so it holds for 10 s ---
  const omniModel = getModel("google:omni-flash");
  const round4 = (n: number) => Math.round(n * 10000) / 10000;
  assert.equal(omniModel.promptLength, true);
  assert.equal(round4(holdEstimateUsd(omniModel, { prompt: "x", durationSec: 4 })), round4(0.1014 * 10 * 1.25));
  assert.equal(round4(holdEstimateUsd(omniModel, { prompt: "x", durationSec: 10 })), round4(0.1014 * 10 * 1.25));
  assert.equal(round4(holdEstimateUsd(getModel("google:veo-3.1-fast"), { prompt: "x", durationSec: 4 })), 0.4, "Veo has a real duration parameter: no padding");
  await adjustCredits("gina", 80_000, "offline test top-up"); // 50 free + 80 = 130 credits
  await assert.rejects(
    runGeneration({ ...omniReq, durationSec: 4, ownerId: "gina" }, undefined, billingFor({ id: "gina", role: "beta" }), { strict: true }),
    (error: unknown) => error instanceof InsufficientCreditsError && error.neededMilli === milliForCost(0.1014 * 10 * 1.25),
  );
  assert.equal(await balanceMilli("gina"), 130_000);
  pass("Omni Flash holds for its longest clip (10 s) x1.25, so a 4 s request cannot overdraw a 130-credit balance");

  // ---- Google usage without numbers bills the list estimate ---------------
  for (const mode of ["empty", "zero"] as const) {
    bananaUsage = mode;
    const unpriced = await runGeneration({ kind: "image", modelId: "google:nano-banana-2", prompt: "Juice", aspectRatio: "4:5", ownerId: "alice" }, undefined, alice);
    assert.equal(unpriced.status, "ok", unpriced.note);
    assert.equal(unpriced.usage.costUsd, round4((1120 * 60) / 1e6), `usage ${mode}: list estimate, not $0`);
    assert.match(unpriced.note, /billed the list estimate/);
  }
  bananaUsage = "full";
  pass("a Google usage block without numeric token counts bills the catalog estimate instead of $0");

  // ---- C20: a paid take that cannot be attached keeps its charge and stays downloadable ----
  const approved = { ...campaign, status: "scheduled" as const };
  let attachError = "";
  try { applyStudioMedia(approved, { kind: "image", creativeId: "creative-a", expectedUrl: poster.url!, generation: poster }); } catch (error) { attachError = (error as Error).message; }
  assert.match(attachError, /unapproved draft/);
  bal = await balanceMilli("alice");
  const adjustsBefore = (await recentLedger("alice", 200)).filter(e => e.reason === "adjust").length;
  const kept = keptTake(alice, poster, "image", attachError);
  const credits = milliForCost(poster.usage.costUsd) / 1000;
  assert.equal(kept.chargedCredits, credits);
  assert.equal(kept.downloadUrl, `/api/studio/download?media=${poster.url!.slice("aisle-media:".length)}&kind=image`, "the owner-checked download route");
  assert.match(kept.message, new RegExp(`^Charged ${credits.toLocaleString("en-US", { maximumFractionDigits: 1 })} credits\\. The take could not be attached because media can only change on an unapproved draft; download it here\\.$`));
  assert.equal(await balanceMilli("alice"), bal, "no refund: the charge stands");
  assert.equal((await recentLedger("alice", 200)).filter(e => e.reason === "adjust").length, adjustsBefore, "and no adjust row");
  assert.equal(keptTake(billingFor({ id: "dev-desk", role: "dev" }), poster, "image", "x").chargedCredits, 0, "dev desks were not charged");
  assert.equal(keptTake(UNMETERED_TEST, poster, "image", "x").chargedCredits, 0);
  const localKept = keptTake(alice, { ...poster, provider: "ComfyUI", url: "http://127.0.0.1:8188/view?filename=a.png", usage: { ...poster.usage, costUsd: 0 } }, "image", "ComfyUI went away.");
  assert.equal(localKept.chargedCredits, 0, "local renders are free");
  assert.equal(localKept.downloadUrl, undefined, "only a stored take gets a download link");
  assert.equal(localKept.message, "The take could not be attached because ComfyUI went away.");
  assert.equal(keptTake(alice, garbage, "image", "x").chargedCredits, 0, "a failed take charged nothing");
  pass("C20: an unattachable paid take keeps its charge (no refund, no adjust row) and returns the owner-checked downloadUrl");

  // ---- C21: ComfyUI availability is probed and remembered -----------------
  resetComfyProbe();
  assert.equal(usableProvider("comfy"), false, "usableProvider only speaks for cloud adapters");
  const down = await comfyAvailability();
  assert.equal(down.usable, false); assert.match(down.reason!, /not reachable/);
  process.env.COMFYUI_URL = comfy.origin;
  assert.equal((await comfyAvailability()).usable, false, "remembered for about 30 s");
  resetComfyProbe();
  const probes = () => comfy.seen.filter(s => s.url === "/system_stats").length;
  const probesBefore = probes();
  assert.deepEqual(await comfyAvailability(), { id: "comfy", usable: true, reason: "Local ComfyUI, free" });
  await comfyAvailability(); await comfyAvailability();
  assert.equal(probes() - probesBefore, 1, "one probe serves every Studio mount for 30 s");
  process.env.COMFYUI_URL = "http://127.0.0.1:9";
  resetComfyProbe();
  pass("ComfyUI availability reflects a real, memoised probe; usableProvider('comfy') stays false");

  // ---- Strict 402 path ----------------------------------------------------
  const carol = billingFor({ id: "carol", role: "beta" }); // 50 free credits
  const calls = providerRequests();
  await assert.rejects(
    runGeneration({ kind: "video", modelId: "google:veo-3.1-fast", prompt: "x", durationSec: 8, aspectRatio: "9:16", startImageUrl: poster.url!, ownerId: "carol" }, undefined, carol, { strict: true }),
    (error: unknown) => error instanceof InsufficientCreditsError && error.neededMilli === milliForCost(0.8) && error.balanceMilli === 50_000,
  );
  await assert.rejects(runGeneration({ kind: "image", modelId: "openai:gpt-image-2", prompt: "x", ownerId: "carol" }, undefined, undefined, { strict: true }), InsufficientCreditsError);
  assert.equal(providerRequests(), calls, "an unpaid call never reaches the provider");
  assert.equal(await balanceMilli("carol"), 50_000);
  pass("strict mode throws InsufficientCreditsError (the Studio's 402) before any provider call; no context fails closed");

  // ---- Non-strict: out of credits falls back to ComfyUI -------------------
  process.env.COMFYUI_URL = comfy.origin;
  const local = await runGeneration({ kind: "image", modelId: "openai:gpt-image-2-high", prompt: "x", aspectRatio: "4:5", ownerId: "carol" }, undefined, billingFor({ id: "erin", role: "beta" }));
  // Erin has 50 credits; a high poster holds ~$0.32 = 64 credits, so it cannot be paid for.
  assert(holdEstimateUsd(getModel("openai:gpt-image-2-high"), { prompt: "x" }) * 200 > 50);
  assert.equal(local.status, "ok"); assert.equal(local.provider, "ComfyUI"); assert.match(local.note, /^Out of credits — rendered locally/);
  const localVideo = await runGeneration({ kind: "video", modelId: "google:omni-flash", prompt: "x", durationSec: 8, aspectRatio: "9:16", startImageUrl: poster.url!, ownerId: "alice" }, undefined, carol);
  assert.equal(localVideo.status, "ok", localVideo.note); assert.equal(localVideo.provider, "ComfyUI");
  assert.equal(localVideo.inputImageSha256, sha(JPEG), "a cloud poster feeds local MiniMax through the media store");
  assert(comfy.seen.some(s => s.url === "/upload/image"));
  assert.equal(providerRequests(), calls, "fallbacks never touched a provider");
  process.env.COMFYUI_URL = "http://127.0.0.1:9";
  const frankPoster = await runGeneration({ kind: "image", modelId: "openai:gpt-image-2", prompt: "x", ownerId: "frank" }, undefined, billingFor({ id: "frank", role: "beta" }));
  assert.equal(frankPoster.status, "ok", "frank's 50 free credits cover a medium poster");
  const noCtx = await runGeneration({ kind: "image", modelId: "openai:gpt-image-2", prompt: "x", ownerId: "alice" }, undefined, undefined);
  assert.equal(noCtx.status, "no_credits"); assert.match(noCtx.note, /Out of credits/); assert.equal(noCtx.usage.costUsd, 0);
  assert.equal(providerRequests(), calls + 1, "only frank's paid poster reached a provider; no context never calls out");
  pass("non-strict: unpaid cloud renders fall back to ComfyUI (a cloud poster seeds local video), else no_credits; no billing context never calls a provider");

  // ---- Dev desks and unmetered runs --------------------------------------
  const devCalls = openai.seen.length;
  const dev = await runGeneration({ kind: "image", modelId: "openai:gpt-image-2", prompt: "x", ownerId: "dev-desk" }, undefined, billingFor({ id: "dev-desk", role: "dev" }), { strict: true });
  assert.equal(dev.status, "ok"); assert.equal(openai.seen.length, devCalls + 1);
  assert.equal(await balanceMilli("dev-desk"), 50_000, "dev desks are not charged");
  assert.equal((await recentLedger("dev-desk")).find(e => e.reason === "dev_usage")?.costUsd, imageCost, "dev usage is recorded at zero credits with its real cost");
  const unmetered = await runGeneration({ kind: "image", modelId: "openai:gpt-image-2", prompt: "x", ownerId: "owner" }, undefined, UNMETERED_TEST);
  assert.equal(unmetered.status, "ok");
  pass("dev desks and unmetered runs call the provider without charging credits");

  // ---- Range chunk cap ----------------------------------------------------
  const big = new Uint8Array(9_000_000).map((_, i) => i % 251);
  const first = mediaResponse(big, "video/mp4", null);
  assert.equal(first.status, 206); assert.equal(first.headers.get("content-range"), `bytes 0-${MAX_RANGE_BYTES - 1}/9000000`);
  assert.equal((await first.arrayBuffer()).byteLength, MAX_RANGE_BYTES);
  const middle = mediaResponse(big, "video/mp4", `bytes=${MAX_RANGE_BYTES}-`);
  assert.equal(middle.headers.get("content-range"), `bytes ${MAX_RANGE_BYTES}-${2 * MAX_RANGE_BYTES - 1}/9000000`);
  assert.equal(new Uint8Array(await middle.arrayBuffer())[0], big[MAX_RANGE_BYTES]);
  const tail = mediaResponse(big, "video/mp4", "bytes=8000000-");
  assert.equal(tail.headers.get("content-length"), "1000000");
  assert.equal(mediaResponse(big.subarray(0, 4_500_000), "image/jpeg", null).status, 200, "images are sent whole");
  assert.equal(MAX_RANGE_BYTES < 4_500_000, true);
  pass("every media response stays under Vercel's 4.5 MB limit: ranges are capped, a plain GET of a big video gets the first chunk");
} finally {
  for (const s of [openai, google, storage, comfy]) s.server.close();
}
console.log(`\n${checks} cloud media checks passed. Isolated fixtures: ${dir}`);
