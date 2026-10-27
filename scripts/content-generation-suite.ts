/**
 * Content Generation agent: brand ingestion (logo, colours, visual style) and
 * the brief/prompt built from it. Offline: synthetic images, no provider calls.
 *
 *   npm run test:content-generation
 */
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  contrastRatio,
  deltaE,
  hexToLab,
  ingestBrandInputs,
  ingestLogo,
  ingestPalette,
  ingestStyle,
} from "../src/lib/media/brand-inputs";
import { posterPrompt, posterRequest, productScene } from "../src/lib/media/prompts";
import { defaultBrand, seedCampaigns } from "../src/lib/seed";

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok - ${name}`);
}

const png = (width: number, height: number, background = "#336699") =>
  sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();

const campaign = seedCampaigns(defaultBrand)[0];
const creative = campaign.creatives[0];
assert.ok(campaign && creative, "the seed campaign has a creative to render");

// ── Colours ────────────────────────────────────────────────────────────
await check("palette keeps the default brand colours with roles and Lab values", () => {
  const { palette, gaps } = ingestPalette(defaultBrand.colors);
  assert.deepEqual(palette.entries.map((e) => [e.role, e.hex]), [
    ["background", "#ffffff"],
    ["text", "#25251f"],
    ["accent", "#008446"],
    ["highlight", "#c8f170"],
    ["deep", "#024a1f"],
  ]);
  assert.ok((palette.textOnBackground ?? 0) > 12);
  assert.deepEqual(gaps, []);
});

await check("an invalid or missing colour is reported and left out, never replaced", () => {
  const { palette, gaps } = ingestPalette({ ink: "black", paper: "#FFFFFF", signal: "#12" } as never);
  assert.deepEqual(palette.entries.map((e) => e.role), ["background"]);
  assert.equal(gaps.filter((g) => g.kind === "palette_invalid").length, 2);
});

await check("low contrast between text and background is flagged", () => {
  const { gaps } = ingestPalette({ ink: "#cccccc", paper: "#ffffff", signal: "#008446" });
  assert.ok(gaps.some((g) => g.kind === "palette_low_contrast" && /text on background/.test(g.reason)));
  assert.ok(Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 0.01);
});

await check("deltaE separates a brand colour from an unrelated one", () => {
  const green = hexToLab("#008446");
  assert.ok(deltaE(green, hexToLab("#008446")) < 0.001);
  assert.ok(deltaE(green, hexToLab("#018547")) < 2);
  assert.ok(deltaE(green, hexToLab("#c4342a")) > 40);
});

// ── Visual style ───────────────────────────────────────────────────────
await check("visual style and tone are trimmed and length-capped", () => {
  assert.deepEqual(ingestStyle({ visualStyle: "  Fresh   and\nbright.  ", tone: " Warm. " }), { visualStyle: "Fresh and bright.", tone: "Warm." });
  assert.equal(ingestStyle({ visualStyle: "x".repeat(2000), tone: "" }).visualStyle.length, 600);
  assert.deepEqual(ingestStyle({ visualStyle: undefined as never, tone: undefined as never }), { visualStyle: "", tone: "" });
});

// ── Logo ───────────────────────────────────────────────────────────────
await check("the default brand logo loads from the public folder", async () => {
  const { logo, gaps } = await ingestLogo(defaultBrand.logoUrl);
  assert.deepEqual(gaps, []);
  assert.ok(logo && logo.width >= 64 && logo.mime === "image/jpeg");
});

await check("no logo address is a reported gap, not an invented logo", async () => {
  const { logo, gaps } = await ingestLogo(undefined);
  assert.equal(logo, null);
  assert.equal(gaps[0].kind, "logo_missing");
});

await check("a path that climbs out of public/ is refused", async () => {
  const { logo, gaps } = await ingestLogo("/../package.json");
  assert.equal(logo, null);
  assert.equal(gaps[0].kind, "logo_unfetchable");
  assert.match(gaps[0].reason, /public folder/);
});

await check("private network addresses are refused before any request", async () => {
  for (const url of ["http://127.0.0.1/logo.png", "http://169.254.169.254/latest/meta-data", "http://[::1]/logo.png"]) {
    const { logo, gaps } = await ingestLogo(url);
    assert.equal(logo, null, url);
    assert.match(gaps[0].reason, /private network/, url);
  }
});

await check("a remote logo is accepted through the fetcher; too small and non-image are gaps", async () => {
  const ok = await ingestLogo("https://brand.example/logo.png", { fetchRemote: async () => png(200, 80) });
  assert.ok(ok.logo && ok.logo.width === 200 && ok.logo.hasAlpha);
  const tiny = await ingestLogo("https://brand.example/s.png", { fetchRemote: async () => png(20, 20) });
  assert.equal(tiny.gaps[0].kind, "logo_too_small");
  const junk = await ingestLogo("https://brand.example/x", { fetchRemote: async () => Buffer.from("<html>not an image</html>") });
  assert.equal(junk.gaps[0].kind, "logo_unreadable");
  const down = await ingestLogo("https://brand.example/y", { fetchRemote: async () => { throw new Error("The logo address answered 404."); } });
  assert.equal(down.gaps[0].kind, "logo_unfetchable");
});

await check("data: and stored logos are read; a stored logo with no reader is a gap", async () => {
  const bytes = await png(120, 60);
  const viaData = await ingestLogo(`data:image/png;base64,${bytes.toString("base64")}`);
  assert.ok(viaData.logo);
  const viaStore = await ingestLogo("aisle-media:abc", { readStored: async () => ({ bytes, mime: "image/png" }) });
  assert.ok(viaStore.logo);
  assert.equal((await ingestLogo("aisle-media:abc")).gaps[0].kind, "logo_unfetchable");
});

await check("ingestBrandInputs combines logo, palette, style and gaps", async () => {
  const inputs = await ingestBrandInputs({ ...defaultBrand, logoUrl: undefined });
  assert.equal(inputs.logo, null);
  assert.equal(inputs.palette.entries.length, 5);
  assert.deepEqual(inputs.gaps.map((g) => g.kind), ["logo_missing"]);
  assert.equal(inputs.style.visualStyle, defaultBrand.visualStyle.slice(0, 600).trim());
});

// ── Brief and prompt ───────────────────────────────────────────────────
const brand = await ingestBrandInputs(defaultBrand);

await check("without brand the prompt and request are unchanged", () => {
  assert.equal(posterPrompt(campaign, creative), posterPrompt(campaign, creative, { brand: null }));
  assert.deepEqual(
    posterRequest(campaign, creative, "gpt-image-1", { brand: null }),
    posterRequest(campaign, creative, "gpt-image-1"),
  );
});

await check("with brand the prompt carries the exact hex colours, the look and the logo zone before the copy lines", () => {
  const prompt = posterPrompt(campaign, creative, { brand });
  for (const hex of ["#ffffff", "#25251f", "#008446", "#c8f170"]) assert.ok(prompt.includes(hex), hex);
  assert.ok(prompt.includes(brand.style.visualStyle.slice(0, 30)));
  assert.match(prompt, /top-left corner/);
  assert.match(prompt, /Do not draw any logo/);
  assert.ok(prompt.indexOf("Brand colours") < prompt.indexOf("Set only these words in type."));
  assert.ok(prompt.includes(`Headline: “${creative.headline}”`));
});

await check("no logo means no reserved corner is requested", async () => {
  const bare = await ingestBrandInputs({ ...defaultBrand, logoUrl: undefined });
  const prompt = posterPrompt(campaign, creative, { brand: bare });
  assert.ok(prompt.includes("#008446"));
  assert.doesNotMatch(prompt, /top-left corner/);
});

await check("a legacy campaign missing its audience or retailer still gets the brand prompt", () => {
  const legacy = { ...campaign, targetAudience: undefined as never, sharedContext: { ...campaign.sharedContext, retailer: undefined as never } };
  const prompt = posterPrompt(legacy, creative, { brand });
  assert.ok(prompt.includes("#008446") && prompt.includes("top-left corner"));
});

await check("banned wording is Compliance's check, not this agent's: the prompt is not filtered", () => {
  const prompt = posterPrompt({ ...campaign, product: "bargain bananas" }, creative, { brand });
  assert.ok(prompt.includes("bargain bananas"));
  assert.equal("bannedTerms" in brand, false);
});

// ── Grocery scenes ─────────────────────────────────────────────────────
await check("productScene routes frozen foods before the fresh meat and dairy scenes", () => {
  const frozen = /both in its pack and served hot/;
  const cases: [string, string, RegExp][] = [
    ["Vanilla ice cream", "Frozen", frozen],
    ["Vanilla ice cream", "Dairy", frozen],
    ["Cheese pizza", "Frozen", frozen],
    ["Cheese pizza", "Dairy", frozen],
    ["Frozen chicken nuggets", "Frozen", frozen],
    ["Hot chips", "Frozen", frozen],
    ["Frozen peas", "Vegetables", frozen],
    // Fresh items still reach their own scene.
    ["Chicken breast fillets", "Meat", /cut or pack looking fresh/],
    ["Tasty cheese", "Dairy", /dairy or egg product/],
    ["Free range eggs", "Dairy", /dairy or egg product/],
    ["Strawberries", "Fruit & Vegetables", /fresh produce/],
    ["Sourdough loaf", "Bakery", /baked product/],
    ["Orange juice", "Drinks", /exact drink/],
    ["Salt and vinegar chips", "Snacks", /snack or treat/],
    ["Tim Tams", "Snacks", /snack or treat/],
    ["Pasta sauce", "Pantry", /pantry product/],
    ["Mystery item", "Grocery", /exact grocery product/],
  ];
  for (const [product, category, expected] of cases) {
    assert.match(productScene(product, category), expected, `${product} (${category})`);
  }
});

console.log(`\n${passed} Content Generation checks passed.`);
