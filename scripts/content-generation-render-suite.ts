/**
 * Content Generation end to end: a campaign poster rendered, then the stored image is opened and its pixels checked, so
 * logo appears on the picture.
 *
 *   npm run test:content-generation-render
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { json, serve } from "./fixtures";

const dir = mkdtempSync(path.join(os.tmpdir(), "aisle-content-generation-test-"));
for (const name of ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "AISLE_DATABASE_URL", "NEON_DATABASE_URL", "STORAGE_URL", "AISLE_MEDIA_PROVIDERS", "AISLE_MEDIA_DRIVER", "VERCEL", "AISLE_HOSTED", "AISLE_SEED_PASSWORD"]) delete process.env[name];
Object.assign(process.env, {
  AISLE_DB: "sqlite",
  AISLE_DB_FILE: path.join(dir, "aisle.db"),
  AISLE_MEDIA_DIR: path.join(dir, "media"),
  OPENAI_API_KEY: "sk-test-openai-offline",
  FREE_CREDITS: "0",
});

const BLUE = { r: 0x22, g: 0x55, b: 0xaa };
const W = 1024;
const H = 1280;
const bluePng = await sharp({ create: { width: W, height: H, channels: 3, background: BLUE } }).png().toBuffer();
// Looks like a JPEG to the media store but is not decodable, as in the credits suite.
const brokenJpeg = Buffer.concat([Buffer.from("ffd8ffe0", "hex"), Buffer.from("offline poster jpeg fixture")]);
let reply: Buffer = bluePng;
const openai = await serve((req, res) => {
  if (req.method === "POST" && (req.url === "/v1/images/generations" || req.url === "/v1/images/edits")) {
    return json(res, 200, { data: [{ b64_json: reply.toString("base64") }], usage: { input_tokens: 100, input_tokens_details: { text_tokens: 100, image_tokens: 0 }, output_tokens: 2000 } });
  }
  json(res, 404, { error: { message: "not found" } });
});
process.env.OPENAI_API_BASE = `${openai.origin}/v1`;

const { renderCampaignPoster } = await import("../src/lib/media/campaign-poster");
const { readMedia } = await import("../src/lib/media/store");
const { clearBrandCache, loadStoredBrand } = await import("../src/lib/media/brand-resolve");
const { saveWorkspace } = await import("../src/lib/auth/workspace");
const { closeDatabase } = await import("../src/lib/db");
const { blankCampaign, defaultBrand } = await import("../src/lib/seed");
const { defaultSettings } = await import("../src/lib/settings");

const results: string[] = [];
const pass = (name: string) => results.push(name);

async function pixel(bytes: Buffer, x: number, y: number) {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return { r: data[at], g: data[at + 1], b: data[at + 2] };
}
/** How many pixels in a box are neither the brand plate white nor the render's blue: the logo itself. */
async function logoPixels(bytes: Buffer, box: { left: number; top: number; width: number; height: number }) {
  const { data, info } = await sharp(bytes).extract(box).raw().toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const white = data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235;
    const blue = Math.abs(data[i] - BLUE.r) < 12 && Math.abs(data[i + 1] - BLUE.g) < 12 && Math.abs(data[i + 2] - BLUE.b) < 12;
    if (!white && !blue) count += 1;
  }
  return count;
}

try {
  const settings = defaultSettings();
  const campaign = blankCampaign({ name: "Branded", product: "Strawberries", category: "Fruit & Vegetables", targetAudience: "Families", objective: "Visits", budget: 100, channels: ["web"], startDate: "2026-10-01", endDate: "2026-10-15", country: "AU", notes: "" }, defaultBrand, null, settings);
  const creative = { id: "cr-1", variant: "A", version: 1, headline: "Picked this week", subhead: "Sweet and local", cta: "Shop now", caption: "", prompt: "Strawberries on a sunlit bench", kicker: "" } as never;
  const render = (ownerId: string, extra: Record<string, unknown> = {}) =>
    renderCampaignPoster({ campaign, creative, modelId: "openai:gpt-image-2.5", ownerId, userKey: "sk-browser-offline", ...extra } as never);
  const stored = async (ownerId: string, url: string | null | undefined) => (await readMedia(url as string, "image", ownerId)).bytes;
  const save = (ownerId: string, brand: object) => saveWorkspace(ownerId, { brand: brand as never, campaigns: [], settings, retiredCampaignIds: [], savedInsights: [] });

  /* ---------------------------------------------- the brand logo is on the image */
  const branded = "owner-branded";
  await save(branded, defaultBrand);
  const guard = await loadStoredBrand(branded);
  assert.equal(guard?.logoUrl, defaultBrand.logoUrl, "the stored-brand key matches the one the workspace saves under");

  const first = await render(branded);
  assert.equal(first.status, "ok", first.note);
  assert.equal(first.brand?.logoApplied, true);
  assert.deepEqual(first.brand?.gaps, []);
  assert.match(first.note, /Brand logo added\./);
  const image = await stored(branded, first.url);
  const size = await sharp(image).metadata();
  assert.deepEqual([size.width, size.height], [W, H], "the picture keeps its size");
  const margin = Math.round(W * 0.04);
  const target = Math.round(W * 0.14);
  assert.deepEqual(await pixel(image, margin + 3, margin + 40), { r: 255, g: 255, b: 255 }, "the plate sits in the top-left corner");
  assert.deepEqual(await pixel(image, W - 100, H - 100), BLUE, "the rest of the picture is untouched");
  assert.deepEqual(await pixel(image, W / 2, H / 2), BLUE);
  assert.ok((await logoPixels(image, { left: margin, top: margin, width: target, height: Math.round(target * 0.6) })) > 100, "real logo pixels are present in the corner");

  const sent = JSON.parse(openai.seen.at(-1)!.body) as { prompt?: string };
  for (const hex of ["#008446", "#c8f170", "#25251f"]) assert.ok(sent.prompt?.includes(hex), `the prompt sent to the model names ${hex}`);
  assert.match(sent.prompt ?? "", /top-left corner/);
  assert.match(sent.prompt ?? "", /Do not draw any logo/);
  pass("the stored image carries the brand logo in the clear corner and the model was sent the brand colours");

  /* ---------------------------------------------- revisions do not double the logo */
  const revised = await render(branded, { editFrom: { bytes: image, mime: "image/png", sha256: "x" }, correction: "Make the berries redder." });
  assert.equal(revised.status, "ok", revised.note);
  reply = image;
  const again = await render(branded, { editFrom: { bytes: image, mime: "image/png", sha256: "x" }, promptOverride: "Edit the poster: redder berries, keep everything else the same and keep the corner clear." });
  reply = bluePng;
  assert.equal(again.brand?.logoApplied, true);
  const twice = await stored(branded, again.url);
  assert.deepEqual(await pixel(twice, margin + 3, margin + 40), { r: 255, g: 255, b: 255 });
  // The logo itself, inside the plate: identical after a second pass, so it was covered and not stacked.
  const inner = { left: margin + 20, top: margin + 20, width: target - 30, height: Math.round(target * 0.4) };
  const raw = (bytes: Buffer) => sharp(bytes).extract(inner).raw().toBuffer();
  assert.ok((await raw(twice)).equals(await raw(image)), "applying the logo to an already branded image covers the first copy exactly");
  assert.ok((await logoPixels(twice, inner)) > 50, "and the logo is still there");
  pass("a revision keeps one logo, in the same place");

  /* ---------------------------------------------- missing logo is reported, not invented */
  const noLogo = "owner-no-logo";
  await save(noLogo, { ...defaultBrand, logoUrl: "" });
  clearBrandCache();
  const bare = await render(noLogo);
  assert.equal(bare.status, "ok");
  assert.equal(bare.brand?.logoApplied, false);
  assert.ok(bare.brand?.gaps.some((gap) => /no logo address/.test(gap)));
  assert.match(bare.note, /No brand logo on this image\./);
  assert.deepEqual(await pixel(await stored(noLogo, bare.url), margin + 3, margin + 40), BLUE, "nothing is drawn where a logo would go");
  assert.doesNotMatch(JSON.parse(openai.seen.at(-1)!.body).prompt, /top-left corner/, "no corner is reserved when there is no logo");
  pass("a brand without a logo renders unbranded and says so");

  /* ---------------------------------------------- unreadable logo does not break the render */
  const badLogo = "owner-bad-logo";
  await save(badLogo, { ...defaultBrand, logoUrl: "/does-not-exist.png" });
  clearBrandCache();
  const missing = await render(badLogo);
  assert.equal(missing.status, "ok");
  assert.equal(missing.brand?.logoApplied, false);
  assert.ok(missing.brand?.gaps.some((gap) => /could not be loaded/.test(gap)));
  pass("an unloadable logo is reported and the picture is still delivered");

  /* ---------------------------------------------- a render that cannot be decoded is kept as it came */
  reply = brokenJpeg;
  clearBrandCache();
  const undecodable = await render(branded);
  reply = bluePng;
  assert.equal(undecodable.status, "ok", undecodable.note);
  assert.equal(undecodable.brand?.logoApplied, false);
  assert.ok(undecodable.brand?.gaps.some((gap) => /could not be placed/.test(gap)));
  assert.deepEqual(await stored(branded, undecodable.url), brokenJpeg, "the provider's bytes are stored untouched");
  pass("when the logo cannot be placed the original image is kept and the gap is reported");

  /* ---------------------------------------------- no brand anywhere: behaviour is unchanged */
  const nobody = await render("owner-without-workspace");
  assert.equal(nobody.status, "ok");
  assert.equal(nobody.brand, undefined);
  assert.deepEqual(await stored("owner-without-workspace", nobody.url), bluePng, "the provider's image is stored byte for byte");
  pass("an owner with no stored brand gets exactly the provider's image");

  /* ---------------------------------------------- an explicit brand wins over the stored one */
  const explicit = await render("owner-without-workspace", { brand: { ...defaultBrand, colors: { ...defaultBrand.colors, signal: "#ff0066" } } });
  assert.equal(explicit.brand?.logoApplied, true);
  assert.match(JSON.parse(openai.seen.at(-1)!.body).prompt, /#ff0066/);
  pass("a brand passed by the caller is used instead of the stored one");
} finally {
  await closeDatabase();
  openai.server.close();
}

console.log("\nContent Generation render suite\n");
for (const name of results) console.log(`  ✓ ${name}`);
console.log(`\n${results.length} checks passed.\n`);
