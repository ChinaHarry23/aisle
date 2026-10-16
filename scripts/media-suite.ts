/** Offline regression checks: no live models, user databases, credentials or paid APIs. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createHash } from "node:crypto";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { WorkflowRepository } from "../services/workflow/repository";
import { createWorkflowServer } from "../services/workflow/api";
import { blankCampaign, defaultBrand } from "../src/lib/seed";
import { defaultSettings } from "../src/lib/settings";
import { applyStudioMedia, type StudioMediaUpdate } from "../src/lib/media/persistence";
import { assertComfyAssetUrl, cachedComfyAsset, mediaResponse } from "../src/lib/media/assets";
import { generateComfyVideo, uploadStartFrame } from "../src/lib/media/comfy";
import { campaignMediaUrl } from "../src/lib/media/url";
import type { MediaGeneration } from "../src/lib/media/pr2-types";

const dir = mkdtempSync(path.join(os.tmpdir(), "aisle-media-test-"));
process.env.AISLE_MEDIA_DIR = path.join(dir, "media");
process.env.COMFYUI_URL = "http://127.0.0.1:18188";
for (const key of ["COMFYUI_VIDEO_UNET", "COMFYUI_VIDEO_CLIP", "COMFYUI_VIDEO_VAE", "COMFYUI_AUDIO_VAE", "COMFYUI_VIDEO_LORA", "COMFYUI_VIDEO_TURBO"]) delete process.env[key];
let checks = 0;
const pass = (label: string) => { checks++; console.log(`PASS ${label}`); };
const url = `${process.env.COMFYUI_URL}/view?filename=fixture.png&type=output&subfolder=aisle`;
const bytes = Buffer.from("89504e470d0a1a0a00000000", "hex");
const hash = createHash("sha256").update(bytes).digest("hex");
const generation: MediaGeneration = { kind: "image", modelId: "comfy:local", provider: "ComfyUI", modelName: "Offline fixture", status: "ok", url, note: "Test only", at: new Date().toISOString(), usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, units: 1, unitLabel: "image", costUsd: 0, billedAs: "fixture", latencyMs: 0, estimate: false } };
const settings = defaultSettings();
const campaign = blankCampaign({ name: "Media fixture", product: "Apple juice", category: "Beverages", targetAudience: "Adults", objective: "Draft only", budget: 500, channels: ["web"], startDate: "2026-10-05", endDate: "2026-10-18", country: "AU", notes: "Offline test" }, defaultBrand, null, settings);
campaign.status = "awaiting_approval";
campaign.creatives = [{ id: "creative-a", variant: "A", version: 1, kicker: "Juice", headline: "Apple pause", subhead: "", cta: "Explore", caption: "", palette: { bg: "#ffffff", fg: "#111111", accent: "#339933", muted: "#cccccc" }, motif: "produce", status: "flagged", prompt: "Glass and apples" }];
const update: StudioMediaUpdate = { kind: "image", creativeId: "creative-a", expectedUrl: null, generation };
const saved = applyStudioMedia(campaign, update);
assert.equal(saved.creatives[0].generation?.url, url);
assert.equal(saved.status, "awaiting_approval");
assert.equal(saved.founderDecision, null);
assert.equal(saved.schedule.length, 0);
assert.equal(campaign.creatives[0].generation, undefined);
assert.throws(() => applyStudioMedia(saved, update), /changed during generation/);
assert.throws(() => applyStudioMedia({ ...campaign, status: "published" }, update), /unapproved draft/);
assert.throws(() => applyStudioMedia(campaign, { ...update, generation: { ...generation, status: "stubbed" } }), /successful/);
pass("images save without approval, stale overwrites and placeholders are rejected");
const video: StudioMediaUpdate = { kind: "video", sourceCreativeId: "creative-a", expectedUrl: url, video: { id: "video-fixture", version: 1, title: "Apple pause", prompt: "Gentle motion", durationSec: 5, aspect: "4:5", status: "ready", generation: { ...generation, kind: "video", sourceImageUrl: url, inputImageSha256: hash, url: `${process.env.COMFYUI_URL}/view?filename=fixture.mp4&type=output&subfolder=aisle` } } };
assert.equal(applyStudioMedia(saved, video).videos.length, 1);
assert.throws(() => applyStudioMedia(saved, { ...video, video: { ...video.video, generation: { ...video.video.generation, inputImageSha256: "unverified" } } }), /verified link/);
assert.throws(() => applyStudioMedia(applyStudioMedia(saved, video), video), /already attached/);
pass("video requires matching source-image provenance; duplicate attachment rejected");

const db = path.join(dir, "workflow.db");
let repo = new WorkflowRepository(db);
repo.db.prepare("insert into workflow_campaigns(user_id,campaign_id,snapshot) values(?,?,?)").run("alice", campaign.id, JSON.stringify(campaign));
assert.throws(() => repo.saveMedia("bob", campaign.id, update), /not found/);
const server = createWorkflowServer(repo, "offline-media-test-secret-32-characters");
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const endpoint = `http://127.0.0.1:${address.port}/campaigns/${campaign.id}/media`;
try {
  assert.equal((await fetch(endpoint, { method: "POST" })).status, 401);
  const headers = { Authorization: "Bearer offline-media-test-secret-32-characters", "X-Aisle-User": "alice", "Content-Type": "application/json" };
  assert.equal((await fetch(endpoint, { method: "POST", headers: { ...headers, "X-Aisle-User": "bob" }, body: JSON.stringify(update) })).status, 404);
  assert.equal((await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(update) })).status, 200);
  repo.close(); repo = new WorkflowRepository(db);
  assert.equal(repo.campaign("alice", campaign.id)?.creatives[0].generation?.url, url);
  const active = repo.enqueue("alice", "revision-fixture", { campaign: saved, campaigns: [], brand: defaultBrand, settings, command: { type: "REQUEST_CHANGES", actor: "founder", note: "Offline fixture" } });
  assert.equal(active.status, "queued");
  assert.throws(() => repo.saveMedia("alice", campaign.id, video), /active workflow/);
  pass("real HTTP authentication, tenant isolation, database reopen and workflow concurrency guard");
} finally { server.close(); await once(server, "close"); repo.close(); }

assert(campaignMediaUrl(campaign.id, "creative-a", generation)?.startsWith(`/api/studio/assets/${campaign.id}/image/creative-a?`));
const stored = { ...generation, provider: "OpenAI", url: `aisle-media:${hash}` };
assert(campaignMediaUrl(campaign.id, "creative-a", stored)?.startsWith(`/api/studio/assets/${campaign.id}/image/creative-a?`), "cloud media is served by the same owner-checked route");
assert.equal(campaignMediaUrl(undefined, "creative-a", stored), undefined);
assert.throws(() => assertComfyAssetUrl("https://example.com/view"));
assert.throws(() => assertComfyAssetUrl(`${process.env.COMFYUI_URL}/system_stats`));
assert.throws(() => assertComfyAssetUrl("http://user:password@127.0.0.1:18188/view"));
// Only Aisle's own outputs: a user-saved generation.url cannot name another file on the ComfyUI box.
const comfyView = (query: string) => `${process.env.COMFYUI_URL}/view?${query}`;
assertComfyAssetUrl(comfyView("filename=poster_00001_.png&type=output&subfolder=aisle"));
assertComfyAssetUrl(comfyView("filename=ad-1_00001_.mp4&type=output&subfolder=aisle%2Fltx-2.5"));
for (const query of [
  "filename=aisle-start-abc.png&type=input&subfolder=aisle", // another account's uploaded start frame
  "filename=ComfyUI_00042_.png&type=output", // someone else's output, outside aisle/
  "filename=ComfyUI_00042_.png&type=output&subfolder=other",
  "filename=x.png&type=temp&subfolder=aisle",
  "filename=x.png&subfolder=aisle",
  "filename=..%2Fsecret.png&type=output&subfolder=aisle",
  "filename=x.png&type=output&subfolder=aisle%2F..%2F..",
  "filename=..&type=output&subfolder=aisle",
  "filename=&type=output&subfolder=aisle",
]) assert.throws(() => assertComfyAssetUrl(comfyView(query)), /Only an existing ComfyUI output/, query);
pass("browser media stays same-origin; arbitrary source hosts and endpoints rejected; ComfyUI /view only for type=output in aisle/");
const sample = new Uint8Array([0, 1, 2, 3, 4]);
assert.equal(mediaResponse(sample, "video/mp4", null).status, 200);
for (const [range, expected] of [["bytes=0-0", [0]], ["bytes=1-3", [1, 2, 3]], ["bytes=-2", [3, 4]], ["bytes=3-999", [3, 4]], ["bytes=2-", [2, 3, 4]]] as const) {
  const response = mediaResponse(sample, "video/mp4", range);
  assert.equal(response.status, 206);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [...expected]);
}
for (const range of ["bytes=-0", "bytes=9-", "bytes=3-1", "bytes=-", "bytes=0-1,3-4"]) assert.equal(mediaResponse(sample, "video/mp4", range).status, 416);
pass("video byte ranges, seeking, suffix ranges and invalid ranges");

const liveFetch = globalThis.fetch;
const uploads: string[] = [];
let submissions = 0, downloads = 0, failUpload = false;
let submittedGraph: Record<string, { inputs: Record<string, unknown> }> = {};
globalThis.fetch = async (input, init) => {
  const requestUrl = String(input);
  const route = new URL(requestUrl).pathname;
  if (route === "/view") { downloads++; return new Response(bytes, { headers: { "Content-Type": "image/png" } }); }
  if (route === "/system_stats") return Response.json({ devices: [{ type: "mps" }] });
  if (route.startsWith("/models/")) return Response.json(["minimax_h3_fl2va_pruned_int8_convrot.safetensors", "minimax_h3_fl2va_pruned_bf16.safetensors", "qwen3vl_32b_minimax_h3_bf16.safetensors", "minimax_h3_video_vae_fp16.safetensors", "minimax_h3_audio_vae_fp32.safetensors", "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors"]);
  if (route === "/upload/image") {
    if (failUpload) return Response.json({ error: "fixture failure" }, { status: 500 });
    const form = init?.body as FormData;
    const file = form.get("image") as File;
    assert.equal(form.get("overwrite"), "false");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
    uploads.push(file.name);
    return Response.json({ name: file.name });
  }
  if (route === "/prompt") { submissions++; submittedGraph = JSON.parse(String(init?.body)).prompt; return Response.json({ prompt_id: "fixture-prompt" }); }
  if (route === "/history/fixture-prompt") return Response.json({ "fixture-prompt": { outputs: { "14": { videos: [{ filename: "fixture.mp4", subfolder: "aisle", type: "output" }] } } } });
  throw new Error(`Unexpected test request: ${requestUrl}`);
};
try {
  await cachedComfyAsset(url, "image"); await cachedComfyAsset(url, "image");
  assert.equal(downloads, 1, "second read must be durable cache, not ComfyUI");
  await assert.rejects(uploadStartFrame(undefined), /requires/);
  await uploadStartFrame(url); await uploadStartFrame(url);
  assert.notEqual(uploads[0], uploads[1]);
  failUpload = true;
  const request = { kind: "video" as const, modelId: "comfy:minimax-h3", prompt: "Fixture", durationSec: 5, aspectRatio: "4:5" as const, startImageUrl: url };
  await assert.rejects(generateComfyVideo(request), /fallback is disabled/);
  assert.equal(submissions, 0);
  failUpload = false;
  const result = await generateComfyVideo(request);
  assert.equal(result.inputImageSha256, hash);
  assert.equal(result.sourceImageUrl, url);
  assert.equal(submittedGraph["1"].inputs.unet_name, "minimax_h3_fl2va_pruned_bf16.safetensors");
  assert.deepEqual(submittedGraph["15"].inputs.first_frame, ["17", 0]);
  assert.deepEqual(submittedGraph["17"].inputs.image, ["16", 0]);
  assert.equal(submittedGraph["17"].inputs.crop, "center", "Different aspect ratios must not stretch the supplied image");
  assert.equal(submittedGraph["16"].inputs.image, uploads.at(-1));
  assert.equal(submittedGraph["15"].inputs.length, 124);
  await assert.rejects(generateComfyVideo({ ...request, durationSec: 20 }), /edited sequence/);
  pass("durable image cache, unique exact-byte uploads, no text fallback and MPS-compatible first-frame graph");
} finally { globalThis.fetch = liveFetch; }
console.log(`\n${checks} media checks passed. Isolated fixtures: ${dir}`);
