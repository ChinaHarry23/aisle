/**
 * Brand research uses a Brandfetch profile when the domain is listed, and only
 * then falls back to reading the website. No network.
 *
 *   npm run test:brand-research
 */

import assert from "node:assert/strict";
import { brandfetchDomain, lookupBrandfetch, profileFromBrandfetch } from "../src/lib/brand/brandfetch";
import { researchBrand } from "../src/lib/brand/research";
import type { CompleteRequest, CompleteResult } from "../src/lib/llm/types";

const coles = {
  name: "Coles",
  domain: "coles.com.au",
  description: "Shop your way at Coles.",
  longDescription: "Coles offers groceries, deli, meat, fresh fruit and vegetables.",
  logos: [
    {
      type: "logo",
      theme: "dark",
      formats: [{ src: "https://asset.brandfetch.io/coles/dark.png", format: "png", background: "transparent" }],
    },
    {
      type: "logo",
      theme: "light",
      formats: [
        { src: "https://evil.example/logo.png", format: "png" },
        { src: "https://asset.brandfetch.io/coles/light.svg", format: "svg", background: "transparent" },
        { src: "https://asset.brandfetch.io/coles/light.png", format: "png", background: "transparent" },
      ],
    },
  ],
  colors: [
    { hex: "#E01A22", type: "brand" },
    { hex: "#FF6B00", type: "accent" },
    { hex: "#111111", type: "dark" },
    { hex: "#fff", type: "light" },
  ],
};

assert.equal(brandfetchDomain("https://www.coles.com.au/shop"), "coles.com.au");
const profile = profileFromBrandfetch("coles.com.au", coles);
assert.ok(profile);
assert.equal(profile.logoUrl, "https://asset.brandfetch.io/coles/light.png");
assert.equal(profile.colors.signal, "#e01a22");
assert.equal(profile.colors.accent, "#ff6b00");
assert.equal(profile.colors.deep, "#111111");
assert.equal(profile.colors.paper, "#ffffff");
assert.equal(profile.tagline, "Shop your way at Coles.");

const colesListed = profileFromBrandfetch("coles.com.au", {
  name: "Coles",
  domain: "coles.com.au",
  description: "Discover quick and easy recipes.",
  logos: [
    { type: "icon", theme: "dark", formats: [{ src: "https://cdn.brandfetch.io/coles/icon.jpeg", format: "jpeg" }] },
    {
      type: "logo",
      theme: "dark",
      formats: [
        { src: "https://cdn.brandfetch.io/coles/logo.png", format: "png", background: "transparent" },
        { src: "https://cdn.brandfetch.io/coles/logo.svg", format: "svg", background: "transparent" },
      ],
    },
  ],
  colors: [
    { hex: "#707070", type: "dark" },
    { hex: "#e4606d", type: "light" },
    { hex: "#be161d", type: "accent" },
  ],
});
assert.ok(colesListed);
assert.equal(colesListed.logoUrl, "https://cdn.brandfetch.io/coles/logo.png");
assert.equal(colesListed.colors.signal, "#be161d");
assert.equal(colesListed.colors.accent, "#e4606d");
assert.equal(colesListed.colors.deep, "#707070");
assert.equal(colesListed.colors.paper, "#ffffff");
assert.match(profile.about, /groceries/);
assert.equal(profileFromBrandfetch("unknown.example", {}), null);

const miss = await lookupBrandfetch("coles.com.au", { apiKey: "" });
assert.deepEqual(miss, { miss: "not_configured" });

const notFound = await lookupBrandfetch("small-grocer.example", {
  apiKey: "test",
  fetch: async () => new Response(JSON.stringify({ message: "Brand not found" }), { status: 404 }),
});
assert.deepEqual(notFound, { miss: "not_found" });

let modelCalls = 0;
const complete = async (req: CompleteRequest): Promise<CompleteResult> => {
  modelCalls += 1;
  return {
    status: "ok",
    text: JSON.stringify({ about: "From the page", tagline: "Page title", tone: "Warm", visualStyle: "Plain", colors: { signal: "#123456", accent: "#654321", deep: "#000000" } }),
    note: "",
    modelId: req.modelId,
    modelName: "test",
    provider: "test",
    providerId: "local",
    at: "2026-10-31T00:00:00.000Z",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, billedAs: "test", estimate: true, latencyMs: 0 },
  };
};

const fromBrandfetch = await researchBrand({
  name: "Coles",
  website: "https://www.coles.com.au/",
  modelId: "local:mtplx",
  complete,
  lookup: async () => ({ profile: profile! }),
});
assert.equal(modelCalls, 0);
assert.equal(fromBrandfetch.logoUrl, profile!.logoUrl);
assert.equal(fromBrandfetch.colors.signal, "#e01a22");
assert.equal(fromBrandfetch.tone, "");

console.log("brand research suite passed");
