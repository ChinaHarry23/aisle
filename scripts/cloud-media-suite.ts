/**
 * Offline checks for cloud posters and ad videos: a fake OpenAI server on
 * loopback, a throwaway SQLite database and media dir. Google and ComfyUI point
 * at a closed port. No real provider is called and no real account is touched.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { json, mp4, serve } from "./fixtures";

const dir = mkdtempSync(path.join(os.tmpdir(), "aisle-cloud-media-test-"));
for (const name of ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "AISLE_DATABASE_URL", "NEON_DATABASE_URL", "STORAGE_URL", "AISLE_MEDIA_PROVIDERS", "AISLE_MEDIA_DRIVER", "GEMINI_API_KEY", "VERCEL"]) delete process.env[name];
Object.assign(process.env, {
  AISLE_DB: "sqlite",
  AISLE_DB_FILE: path.join(dir, "aisle.db"),
  AISLE_MEDIA_DIR: path.join(dir, "media"),
  AISLE_MEDIA_PROGRESS_DB: path.join(dir, "progress.db"),
  OPENAI_API_KEY: "sk-test-openai-offline",
  GOOGLE_AI_API_KEY: "test-google-offline",
  COMFYUI_URL: "http://127.0.0.1:9",
});

const { runGeneration, getModel } = await import("../src/lib/pr2-shims");
const { MEDIA_ADAPTERS, usableProvider, providerAvailability } = await import("../src/lib/media/providers");
const { putMedia, readMedia, MediaNotFoundError, sniffMime } = await import("../src/lib/media/store");
const { mediaResponse, MAX_RANGE_BYTES } = await import("../src/lib/media/assets");
const { campaignMediaUrl } = await import("../src/lib/media/url");
const { MEDIA_MODELS } = await import("../src/lib/media/catalog");
const { billingFor } = await import("../src/lib/billing/meter");
const { adjustCredits, balanceMilli } = await import("../src/lib/billing/ledger");

let checks = 0;
const pass = (label: string) => { checks++; console.log(`PASS ${label}`); };

// ---- Fixtures -------------------------------------------------------------
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("offline poster png fixture")]);
const JPEG = Buffer.concat([Buffer.from("ffd8ffe0", "hex"), Buffer.from("offline poster jpeg fixture")]);

// ---- Fake servers ---------------------------------------------------------
const openai = await serve((req, res) => {
  if (req.method === "POST" && req.url === "/v1/images/generations") {
    return json(res, 200, { created: 1, output_format: "jpeg", data: [{ b64_json: JPEG.toString("base64") }], usage: { input_tokens: 120, input_tokens_details: { text_tokens: 120, image_tokens: 0 }, output_tokens: 2000, total_tokens: 2120 } });
  }
  json(res, 404, { error: { message: "not found" } });
});

process.env.OPENAI_API_BASE = `${openai.origin}/v1`;
process.env.GOOGLE_API_BASE = "http://127.0.0.1:9/v1beta";
const alice = billingFor({ id: "alice", role: "beta" });

try {
  // ---- Catalog and availability (Cindy's catalog wins) -------------------
  for (const kept of ["google:nano-banana-2", "google:nano-banana-2.1", "google:nano-banana-pro", "openai:gpt-image-2.5", "openai:gpt-image-2.5-flare"]) {
    assert.equal(MEDIA_MODELS.some(m => m.id === kept), true, kept);
    assert.equal(getModel(kept).id, kept);
  }
  assert.equal(getModel("google:veo-3.1-fast").apiModel, "veo-3.1-fast-generate-preview");
  assert.deepEqual(getModel("google:veo-3.1-fast").billing, { mode: "per_second", usdPerSec: 0.12, estTokensPerSec: 700 });
  assert.equal(getModel("google:nano-banana-2").apiModel, "gemini-3.1-flash-image");
  assert.deepEqual(Object.keys(MEDIA_ADAPTERS).sort(), ["alibaba", "bytedance", "google", "openai", "tencent"]);
  assert.equal(usableProvider("openai"), true); assert.equal(usableProvider("google"), true);
  process.env.AISLE_MEDIA_PROVIDERS = "openai";
  assert.equal(usableProvider("google"), false);
  delete process.env.AISLE_MEDIA_PROVIDERS;
  process.env.GOOGLE_AI_API_KEY = "test-google-offline";
  assert.equal(JSON.stringify(providerAvailability("openai")).includes("sk-test"), false);
  pass("catalog keeps Nano Banana, GPT Image 2.5, and Veo 3.1 Fast; PR #2 adapters still register");

  // ---- Cindy's generate stays a stub even when keys are present ------------
  await adjustCredits("alice", 950_000, "offline test top-up");
  const before = await balanceMilli("alice");
  const openaiBefore = openai.seen.length;
  const poster = await runGeneration({ kind: "image", modelId: "openai:gpt-image-2.5", prompt: "Apple juice poster", aspectRatio: "4:5", ownerId: "alice" }, undefined, alice, { strict: true });
  assert.equal(poster.status, "stubbed", poster.note);
  assert.match(poster.note, /Wire the fetch in src\/lib\/media\/adapters\.ts/);
  assert.equal(openai.seen.length, openaiBefore, "Cindy's generate does not call PR #2 cloud adapters");
  assert.equal(await balanceMilli("alice"), before, "a stub spends no credits");
  pass("Cindy's Studio generate stubs when adapters.ts is unwired; PR #2 billing is not charged");

  // ---- Owner check and URL routing ----------------------------------------
  const stored = await putMedia({ ownerId: "alice", kind: "image", bytes: PNG, mime: "image/png" });
  await assert.rejects(readMedia(stored.url, "image", "bob"), MediaNotFoundError);
  await assert.rejects(readMedia(stored.url, "video", "alice"), MediaNotFoundError);
  await assert.rejects(readMedia("aisle-media:../../etc/passwd", "image", "alice"), MediaNotFoundError);
  await assert.rejects(readMedia(`aisle-media:${"0".repeat(64)}`, "image", "alice"), MediaNotFoundError);
  for (const query of ["filename=aisle-start-1.png&type=input", "filename=ComfyUI_00042_.png&type=output", "filename=x.png&type=output&subfolder=aisle%2F..%2Fother"]) {
    await assert.rejects(readMedia(`${process.env.COMFYUI_URL}/view?${query}`, "image", "alice"), MediaNotFoundError, query);
  }
  assert.equal(campaignMediaUrl("c1", "cr1", poster), undefined, "Cindy's stub generation has no stored asset URL");
  const liveish = { ...poster, status: "ok" as const, url: stored.url };
  assert.equal(campaignMediaUrl("c1", "cr1", liveish), `/api/studio/assets/c1/image/cr1?v=${encodeURIComponent(liveish.at)}`);
  assert.equal(campaignMediaUrl(undefined, "cr1", liveish), undefined, "stored media is never handed to the browser raw");
  await assert.rejects(putMedia({ ownerId: "alice", kind: "image", bytes: Buffer.from("<svg/>"), mime: "image/png" }), /not a valid image/);
  await assert.rejects(putMedia({ ownerId: "alice", kind: "video", bytes: PNG, mime: "image/png" }), /not a valid video/);
  await assert.rejects(putMedia({ ownerId: "alice", kind: "image", bytes: PNG, mime: "image/jpeg" }), /said image\/jpeg/);
  assert.equal(sniffMime(mp4(1)), "video/mp4");
  process.env.AISLE_MEDIA_DRIVER = "db";
  const dbStored = await putMedia({ ownerId: "dora", kind: "image", bytes: JPEG, mime: "image/jpeg" });
  assert.deepEqual((await readMedia(dbStored.url, "image", "dora")).bytes, JPEG);
  await assert.rejects(readMedia(dbStored.url, "image", "alice"), MediaNotFoundError);
  delete process.env.AISLE_MEDIA_DRIVER;
  pass("stored media reads are owner-checked (fs and db drivers), type-checked by magic number, and routed through the asset API");

  // PR #2 generate.ts billing / Veo / Omni / Comfy fallbacks are not run
  // against Cindy's stub generate. Adapter HTTP contracts live in provider-adapters-suite.

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
  openai.server.close();
}
console.log(`\n${checks} cloud media checks passed. Isolated fixtures: ${dir}`);
