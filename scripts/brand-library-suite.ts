/**
 * A saved brand can be left and opened again.
 *
 *   npm run test:brands
 */

import assert from "node:assert/strict";
import {
  freshBrand,
  normaliseActiveBrandId,
  normaliseSavedBrands,
  rememberBrand,
  startSavedBrand,
  switchSavedBrand,
} from "../src/lib/brand/library";
import { defaultBrand } from "../src/lib/seed";

let checks = 0;
const pass = (label: string) => {
  checks += 1;
  console.log(`PASS ${label}`);
};

const woolworths = { ...defaultBrand, retailerName: "Woolworths" };
const coles = freshBrand("Coles");
coles.website = "https://www.coles.com.au/";

assert.equal(normaliseSavedBrands([{ id: "", profile: woolworths }, null, { id: "b1", profile: { retailerName: "" } }]).length, 0);
const kept = normaliseSavedBrands([
  { id: "b1", savedAt: "2026-11-01T00:00:00.000Z", profile: woolworths },
  { id: "b1", savedAt: "2026-11-01T00:00:00.000Z", profile: coles },
]);
assert.equal(kept.length, 1);
assert.equal(kept[0].profile.retailerName, "Woolworths");
assert.equal(normaliseActiveBrandId("missing", kept), null);
assert.equal(normaliseActiveBrandId("b1", kept), "b1");
pass("a saved brand needs an id and a name, and the active id has to be one of them");

const at = "2026-11-01T01:00:00.000Z";
const saved = rememberBrand([], null, woolworths, at);
assert.equal(saved.savedBrands.length, 1);
assert.equal(saved.savedBrands[0].profile.retailerName, "Woolworths");
const again = rememberBrand(saved.savedBrands, saved.activeBrandId, { ...woolworths, tagline: "Fresh food" }, at);
assert.equal(again.savedBrands.length, 1);
assert.equal(again.activeBrandId, saved.activeBrandId);
assert.equal(again.savedBrands[0].profile.tagline, "Fresh food");
pass("saving the working brand keeps one library entry and updates it");

const started = startSavedBrand(again.savedBrands, again.activeBrandId, again.savedBrands[0].profile, at);
assert.equal(started.savedBrands.length, 2);
assert.equal(started.brand.retailerName, "New brand");
assert.notEqual(started.activeBrandId, again.activeBrandId);
const back = switchSavedBrand(started.savedBrands, started.activeBrandId, started.brand, again.activeBrandId, at);
assert.ok(back);
assert.equal(back?.brand.retailerName, "Woolworths");
assert.equal(back?.brand.tagline, "Fresh food");
assert.equal(back?.savedBrands.find((brand) => brand.id === started.activeBrandId)?.profile.retailerName, "New brand");
pass("a new brand keeps the previous one, and switching brings it back");

const unsaved = { ...coles, retailerName: "Aesop" };
const jumped = switchSavedBrand(back!.savedBrands, null, unsaved, again.activeBrandId, at);
assert.ok(jumped);
assert.equal(jumped?.brand.retailerName, "Woolworths");
assert.equal(jumped?.savedBrands.some((brand) => brand.profile.retailerName === "Aesop"), true);
pass("switching away from a brand that was not saved still keeps it");

console.log(`${checks} checks passed`);
