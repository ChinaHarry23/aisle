/**
 * Renders on the owner's provider key must be paid in credits: Studio's
 * free-form render and the campaign poster both hold the worst case first,
 * settle what the provider billed, and refuse with no credits or no account.
 * A fake OpenAI server on loopback and a throwaway SQLite file; no real calls.
 *
 *   npm run test:media-credits
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { json, serve } from "./fixtures";

const dir = mkdtempSync(path.join(os.tmpdir(), "aisle-media-credits-test-"));
for (const name of ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "AISLE_DATABASE_URL", "NEON_DATABASE_URL", "STORAGE_URL", "AISLE_MEDIA_PROVIDERS", "AISLE_MEDIA_DRIVER", "VERCEL", "AISLE_HOSTED", "AISLE_SEED_PASSWORD"]) delete process.env[name];
Object.assign(process.env, {
  AISLE_DB: "sqlite",
  AISLE_DB_FILE: path.join(dir, "aisle.db"),
  AISLE_MEDIA_DIR: path.join(dir, "media"),
  OPENAI_API_KEY: "sk-test-openai-offline",
  FREE_CREDITS: "0",
});

const JPEG = Buffer.concat([Buffer.from("ffd8ffe0", "hex"), Buffer.from("offline poster jpeg fixture for the credits suite")]);
const PNG_URL = `data:image/png;base64,${Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("offline reference png fixture!!")]).toString("base64")}`;
let broken = false;
const openai = await serve((req, res) => {
  if (req.method === "POST" && (req.url === "/v1/images/generations" || req.url === "/v1/images/edits")) {
    // `broken` returns bytes that are not an image: the provider billed, the render is unusable.
    const bytes = broken ? Buffer.from("not an image at all, but billed") : JPEG;
    return json(res, 200, { data: [{ b64_json: bytes.toString("base64") }], usage: { input_tokens: 100, input_tokens_details: { text_tokens: 100, image_tokens: 0 }, output_tokens: 2000 } });
  }
  json(res, 404, { error: { message: "not found" } });
});
process.env.OPENAI_API_BASE = `${openai.origin}/v1`;

const { runGeneration } = await import("../src/lib/media/generate");
const { renderCampaignPoster } = await import("../src/lib/media/campaign-poster");
const { mediaHoldUsd, estimateUsage } = await import("../src/lib/media/estimate");
const { getModel } = await import("../src/lib/media/catalog");
const { billingFor, holdCredits } = await import("../src/lib/billing/meter");
const { adjustCredits, balanceMilli } = await import("../src/lib/billing/ledger");
const { milliForCost, MILLI } = await import("../src/lib/billing/plan");
const { createUser } = await import("../src/lib/auth/users");
const { closeDatabase } = await import("../src/lib/db");
const { blankCampaign, defaultBrand } = await import("../src/lib/seed");
const { defaultSettings } = await import("../src/lib/settings");
const { posterRequest } = await import("../src/lib/media/prompts");

const results: string[] = [];
const pass = (name: string) => results.push(name);
const calls = () => openai.seen.length;
// 2,000 output tokens at $30/M plus 100 text tokens at $5/M, as the fake reports.
const BILLED_USD = (100 * 5 + 2000 * 30) / 1e6;

try {
  /* ------------------------------------------------------------ the quote */
  {
    const model = getModel("openai:gpt-image-2.5");
    const base = { kind: "image" as const, modelId: model.id, prompt: "Poster" };
    const medium = mediaHoldUsd(model, { ...base, quality: "medium", aspectRatio: "1:1" });
    const large = mediaHoldUsd(model, { ...base, quality: "high", aspectRatio: "16:9", contextImages: [PNG_URL] });
    assert.ok(medium >= estimateUsage(model, base).costUsd, "never below the listed estimate");
    assert.ok(large > medium * 4, "high quality, a large size and a reference image raise the hold");
    pass("the hold covers the quality, size and reference image the request asks for");
  }

  const broke = await createUser({ email: "broke@example.test", name: "Broke", password: "broke-pass-1" });
  const paying = await createUser({ email: "paying@example.test", name: "Paying", password: "paying-pass-1" });
  await adjustCredits(paying.id, 100 * MILLI, "offline test top-up");
  const studio = { kind: "image" as const, modelId: "openai:gpt-image-2.5", prompt: "Olive oil poster", aspectRatio: "4:5" as const, quality: "high" as const, contextImages: [PNG_URL] };

  /* --------------------------------------------------------- Studio render */
  {
    let before = calls();
    const refused = await runGeneration(studio, undefined, billingFor(broke));
    assert.equal(refused.status, "stubbed");
    assert.match(refused.note, /Out of credits/);
    assert.equal(calls(), before, "no credits: nothing goes to the provider");

    const nobody = await runGeneration(studio, undefined, undefined);
    assert.match(nobody.note, /No account to bill/);
    assert.equal(calls(), before, "no account: nothing goes to the provider");

    const start = await balanceMilli(paying.id);
    const paid = await runGeneration(studio, undefined, billingFor(paying));
    assert.equal(paid.status, "ok", paid.note);
    assert.equal(calls(), before + 1);
    assert.equal(start - (await balanceMilli(paying.id)), milliForCost(BILLED_USD), "charged what the provider billed, hold returned");

    // A value the quote does not know must not price the render at nothing.
    const odd = await runGeneration({ ...studio, quality: "auto" as never }, undefined, billingFor(broke));
    assert.equal(odd.status, "stubbed");
    assert.equal(calls(), before + 1, "an unknown quality is quoted as the most expensive, so no free render");
    assert.equal(await holdCredits(billingFor(paying), Number.NaN), null, "a NaN quote holds nothing and lets nothing through");

    before = await balanceMilli(broke.id);
    const ownKey = await runGeneration(studio, "sk-browser-key", billingFor(broke));
    assert.equal(ownKey.status, "ok", "a key typed in the browser pays the provider directly");
    assert.equal(await balanceMilli(broke.id), before, "and no credits move");
    pass("Studio render: refused without credits or an account, settled at the provider's bill, free with the browser's key");
  }

  /* ------------------------------------------------------- campaign poster */
  {
    const settings = defaultSettings();
    const campaign = blankCampaign({ name: "Credits", product: "Olive oil", category: "Pantry", targetAudience: "Home cooks", objective: "Visits", budget: 100, channels: ["web"], startDate: "2026-10-01", endDate: "2026-10-15", country: "AU", notes: "" }, defaultBrand, null, settings);
    const creative = { id: "cr-1", variant: "A", version: 1, headline: "Pressed this week", subhead: "Local grove", cta: "Find it", caption: "", prompt: "Olive oil on a bench", kicker: "" } as never;
    const poster = (ownerId: string) => renderCampaignPoster({ campaign, creative, modelId: "openai:gpt-image-2.5", ownerId });

    // Alibaba always renders on the owner's DASHSCOPE key, so a browser key does not make it free.
    process.env.DASHSCOPE_API_KEY = "test-dashscope-offline";
    const viaAlibaba = await renderCampaignPoster({ campaign, creative, modelId: "alibaba:qwen-image-3", ownerId: broke.id, userKey: "browser-key" });
    assert.equal(viaAlibaba.status, "stubbed");
    assert.match(viaAlibaba.note, /Out of credits/, "an adapter that ignores the browser key still needs credits");
    delete process.env.DASHSCOPE_API_KEY;

    let before = calls();
    const refused = await poster(broke.id);
    assert.equal(refused.status, "stubbed");
    assert.match(refused.note, /Out of credits/);
    assert.match((await poster("no-such-account")).note, /No account to bill/);
    assert.equal(calls(), before, "neither reached the provider");

    const start = await balanceMilli(paying.id);
    const paid = await poster(paying.id);
    assert.equal(paid.status, "ok", paid.note);
    assert.equal(start - (await balanceMilli(paying.id)), milliForCost(BILLED_USD), "the owner pays the provider's bill in credits");

    // The provider billed but the bytes were unusable: the quote is charged, not refunded.
    broken = true;
    before = await balanceMilli(paying.id);
    const failed = await poster(paying.id);
    broken = false;
    assert.equal(failed.status, "stubbed");
    const quote = mediaHoldUsd(getModel("openai:gpt-image-2.5"), posterRequest(campaign, creative, "openai:gpt-image-2.5"));
    assert.equal(before - (await balanceMilli(paying.id)), milliForCost(quote), "a render the provider billed is charged the quote");
    pass("campaign poster: the owner holds credits first, pays the bill, and a billed failure is not refunded");
  }
} finally {
  await closeDatabase();
  openai.server.close();
}

console.log("\nMedia credits suite\n");
for (const name of results) console.log(`  ✓ ${name}`);
console.log(`\n${results.length} checks passed.\n`);
