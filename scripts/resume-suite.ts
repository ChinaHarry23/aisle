/**
 * A campaign left on the trend hand-off can be continued, and a stale workspace
 * read must not rewind it.
 *
 *   node --import ./scripts/service-loader.mjs --experimental-strip-types scripts/resume-suite.ts
 */

import assert from "node:assert/strict";
import type { Campaign } from "../src/lib/types";
import { campaignCanAdvance, mergeCampaignLists } from "../src/lib/runtime/resume";

function campaign(partial: Pick<Campaign, "id" | "updatedAt"> & Partial<Campaign>): Campaign {
  return partial as Campaign;
}

const parked = campaign({
  id: "cmp_parked",
  updatedAt: "2026-10-17T02:01:55.747Z",
  running: true,
  status: "analysing",
  run: {
    id: "run_parked",
    campaignId: "cmp_parked",
    startedAt: "2026-10-17T02:01:55.313Z",
    updatedAt: "2026-10-17T02:01:55.747Z",
    status: "running",
    step: "creative.receive",
    stepsTaken: 1,
    maxSteps: 36,
    revisionAttempts: 0,
    toolsUsed: [],
    haltedReason: null,
    awaiting: null,
    awaitingDetail: null,
  },
});

assert.equal(campaignCanAdvance(parked), true);
assert.equal(
  campaignCanAdvance({
    ...parked,
    run: { ...parked.run!, status: "running", step: "founder.gate" },
  }),
  false,
);
assert.equal(
  campaignCanAdvance({
    ...parked,
    run: { ...parked.run!, status: "awaiting_human", step: "founder.gate" },
  }),
  false,
);
assert.equal(campaignCanAdvance({ ...parked, run: null }), false);
console.log("PASS a trend hand-off is waiting for the next command; a founder gate is not");

const newer = { ...parked, updatedAt: "2026-10-17T03:00:00.000Z", status: "generating" as const };
const merged = mergeCampaignLists([newer], [parked], {});
assert.equal(merged.length, 1);
assert.equal(merged[0].status, "generating");

const serverWins = mergeCampaignLists([parked], [newer], {});
assert.equal(serverWins[0].status, "generating");

const inFlight = campaign({ id: "cmp_new", updatedAt: "2026-10-17T04:00:00.000Z", status: "draft" });
const kept = mergeCampaignLists([inFlight, parked], [parked], { cmp_new: true });
assert.deepEqual(kept.map((item) => item.id).sort(), ["cmp_new", "cmp_parked"]);

const dropped = mergeCampaignLists([inFlight], [parked], {});
assert.deepEqual(dropped.map((item) => item.id), ["cmp_parked"]);
console.log("PASS a newer or in-flight campaign survives a stale workspace read");
