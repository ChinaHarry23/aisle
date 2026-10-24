import assert from "node:assert/strict";
import { advertisementLabel, excerptFormatter, reviewedAdvertisements } from "../src/lib/compliance/presentation";
import type { Campaign } from "../src/lib/types";

const format = excerptFormatter([{ creativeId: "asset-dynamic", headline: "Actual title" }]);
assert.equal(format("asset-dynamic"), "Advertisement A — Actual title");
assert.equal(format("asset-dynamic: $5"), "Advertisement A — Actual title: $5");
assert.equal(format("asset-dynamic：offer"), "Advertisement A — Actual title：offer");
assert.equal(format("asset-dynamic-extra: offer"), "asset-dynamic-extra: offer");
assert.equal(format("Ordinary quoted copy"), "Ordinary quoted copy");
assert.equal(format("cr_deleted: offer"), "Advertisement (reviewed content unavailable): offer");
assert.equal(advertisementLabel(26, "Title"), "Advertisement AA — Title");
const campaign = {
  creatives: [{ id: "same-id", headline: "New title", version: 2 }],
  complianceReviewRuns: [{ submission: { version: 1, content: [{ creativeId: "same-id", headline: "Reviewed title" }] } }],
} as unknown as Campaign;
assert.equal(excerptFormatter(reviewedAdvertisements(campaign, 1))("same-id: offer"), "Advertisement A — Reviewed title: offer");
assert.deepEqual(reviewedAdvertisements(campaign, 0), []);
assert.equal(reviewedAdvertisements(campaign, 2)[0].headline, "New title");
console.log("Compliance presentation checks passed.");
