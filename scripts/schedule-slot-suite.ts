/**
 * Same-day posts are allowed. An identical time moves the later campaign by 10 minutes.
 *
 *   npm run test:schedule
 */

import assert from "node:assert/strict";
import { runSchedule, separateSharedSlots, type Work } from "../src/lib/runtime/steps";
import { blankCampaign, defaultBrand } from "../src/lib/seed";
import { defaultSettings } from "../src/lib/settings";
import type { Campaign } from "../src/lib/types";

let checks = 0;
const pass = (label: string) => {
  checks += 1;
  console.log(`PASS ${label}`);
};

function campaign(name: string, start = "2026-11-08") {
  const next = blankCampaign(
    {
      name,
      product: "Face cream",
      category: "Beauty",
      targetAudience: "Shoppers",
      objective: "Awareness",
      budget: 1000,
      channels: ["instagram", "web"],
      startDate: start,
      endDate: "2026-11-22",
      country: "AU",
      notes: "",
    },
    defaultBrand,
    null,
    defaultSettings(),
  );
  next.createdAt = `2026-11-01T0${checks}:00:00.000Z`;
  return next;
}

function work(target: Campaign): Work {
  return {
    campaign: target,
    run: target.run,
    steps: [],
    policy: [],
    toolCalls: [],
    events: [],
    now: "2026-11-01T00:00:00.000Z",
  };
}

const first = campaign("Woolworths", "2026-11-07");
first.status = "published";
runSchedule(work(first), [first]);
assert.deepEqual(
  first.schedule.map((item) => item.at),
  ["2026-11-07T00:00:00.000Z", "2026-11-07T01:30:00.000Z"],
);
assert.equal(first.scheduleConflicts.length, 0);
pass("the first campaign keeps its own times");

const nextDay = campaign("Aesop");
nextDay.status = "scheduled";
runSchedule(work(nextDay), [first, nextDay]);
assert.deepEqual(
  nextDay.schedule.map((item) => item.at),
  ["2026-11-08T00:00:00.000Z", "2026-11-08T01:30:00.000Z"],
);
assert.equal(nextDay.scheduleConflicts.length, 0);
pass("a post the next day is not a conflict");

const later = campaign("ZARA");
runSchedule(work(later), [first, nextDay, later]);
assert.deepEqual(
  later.schedule.map((item) => ({ channel: item.channel, at: item.at })),
  [
    { channel: "instagram", at: "2026-11-08T00:10:00.000Z" },
    { channel: "web", at: "2026-11-08T01:40:00.000Z" },
  ],
);
assert.equal(later.scheduleConflicts.some((conflict) => conflict.kind === "same_slot"), false);
assert.match(later.schedule[0].note, /placed 10 minutes later/);
pass("an identical time moves the later campaign by 10 minutes");

const third = campaign("ZARA again");
runSchedule(work(third), [nextDay, later, third]);
assert.equal(third.schedule.find((item) => item.channel === "instagram")?.at, "2026-11-08T00:20:00.000Z");
assert.equal(third.schedule.find((item) => item.channel === "web")?.at, "2026-11-08T01:50:00.000Z");
assert.equal(third.scheduleConflicts.length, 0);
pass("a third campaign waits another 10 minutes");

const outside = campaign("Too late");
outside.endDate = "2026-11-07";
runSchedule(work(outside), [outside]);
assert.equal(outside.scheduleConflicts.length, 2);
assert.ok(outside.scheduleConflicts.every((conflict) => conflict.kind === "outside_window"));
pass("a time outside the campaign window is still flagged");

const early = campaign("Early Aesop");
const crowded = campaign("Later Aesop");
early.status = "published";
crowded.status = "published";
early.createdAt = "2026-11-01T01:00:00.000Z";
crowded.createdAt = "2026-11-01T02:00:00.000Z";
for (const target of [early, crowded]) {
  target.schedule = [
    { id: `${target.id}-ig`, channel: "instagram", at: "2026-11-08T00:00:00.000Z", status: "published", note: "Tue 11:40 AEST" },
    { id: `${target.id}-web`, channel: "web", at: "2026-11-08T01:30:00.000Z", status: "published", note: "Tue 07:00 AEST" },
  ];
  target.runSchedule = target.schedule.map((item) => ({
    id: item.id,
    channel: item.channel,
    at: item.at,
    status: "published",
    note: item.note,
    channelVersionId: "",
    conflictIds: ["cf-old"],
  }));
  target.scheduleConflicts = [
    {
      id: "cf-old",
      channel: "instagram",
      at: itemTime(target),
      kind: "same_slot",
      detail: "Already occupies instagram within 24 hours of the proposed time.",
      resolved: false,
    },
  ];
}
assert.equal(separateSharedSlots([crowded, early]), true);
assert.equal(early.schedule[0].at, "2026-11-08T00:00:00.000Z");
assert.equal(crowded.schedule[0].at, "2026-11-08T00:10:00.000Z");
assert.equal(crowded.schedule[1].at, "2026-11-08T01:40:00.000Z");
assert.equal(crowded.runSchedule[0].at, crowded.schedule[0].at);
assert.equal(early.scheduleConflicts.length, 0);
assert.equal(crowded.scheduleConflicts.length, 0);
assert.equal(separateSharedSlots([crowded, early]), false);
pass("saved campaigns keep the earlier time and drop the same-slot flag");

function itemTime(target: Campaign) {
  return target.schedule[0]?.at ?? "2026-11-08T00:00:00.000Z";
}

console.log(`${checks} checks passed`);
