/**
 * The browser mirror must stay small enough for local storage.
 *
 *   npm run test:browser-cache
 */

import assert from "node:assert/strict";
import { cachedWorkspaceHasCampaigns, workspaceForBrowser } from "../src/lib/browser-workspace";
import { defaultBrand } from "../src/lib/seed";
import { defaultSettings } from "../src/lib/settings";

let checks = 0;
const pass = (label: string) => {
  checks += 1;
  console.log(`PASS ${label}`);
};

const settings = defaultSettings();
settings.trendSources = [
  {
    id: "src",
    kind: "document",
    value: "notes.txt",
    label: "Notes",
    enabled: true,
    addedAt: "2026-11-01T00:00:00.000Z",
    lastFetchedAt: null,
    content: "x".repeat(8_000),
  },
];
const brand = {
  ...defaultBrand,
  logoUrl: `data:image/png;base64,${"a".repeat(5_000)}`,
  retailData: { schemaVersion: "1.0" as const, fileName: "coles.json", uploadedAt: "2026-11-01", retailer: { id: "coles", name: "Coles", country: "AU" as const }, currency: "AUD" as const, extractedAt: "2026-11-01", note: "demo", products: [] },
  guidelines: [{ id: "g", name: "guide", size: 9000, uploadedAt: "2026-11-01", text: "y".repeat(9_000), truncated: false }],
};
const mirror = workspaceForBrowser({
  brand,
  savedBrands: [{ id: "b1", savedAt: "2026-11-01T00:00:00.000Z", profile: brand }],
  activeBrandId: "b1",
  retiredCampaignIds: [],
  savedInsights: [],
  settings,
});
assert.equal("campaigns" in mirror, false);
assert.equal(mirror.brand.retailData, null);
assert.equal(mirror.brand.logoUrl, "");
assert.ok((mirror.brand.guidelines?.[0].text.length ?? 0) <= 2_000);
assert.equal(mirror.savedBrands[0].profile.retailData, null);
assert.ok((mirror.settings.trendSources[0].content?.length ?? 0) <= 2_000);
const encoded = JSON.stringify({ state: mirror, version: 0 });
assert.ok(encoded.length < 100_000, `mirror is ${encoded.length} characters`);
pass("the browser mirror drops campaigns, pictures, retail files and long documents");

assert.equal(cachedWorkspaceHasCampaigns(JSON.stringify({ state: { campaigns: [{ id: "c" }] } })), true);
assert.equal(cachedWorkspaceHasCampaigns(JSON.stringify({ state: mirror })), false);
assert.equal(cachedWorkspaceHasCampaigns("not json"), false);
pass("only an older mirror is treated as holding campaigns");

console.log(`${checks} checks passed`);
