/**
 * The Approvals queue is one list of founder decisions, split by type.
 *
 *   npm run test:approvals
 */

import assert from "node:assert/strict";
import { approvalsHref, parseReviewType, reviewQueue } from "../src/lib/approvals/queue";
import { trendNoticeKey, withNotedTrendNotice } from "../src/lib/trend/notice";
import { blankCampaign, defaultBrand } from "../src/lib/seed";
import { defaultSettings } from "../src/lib/settings";
import type { AgentRun, ScheduleConflict } from "../src/lib/runtime/types";
import type { Campaign } from "../src/lib/types";
import type { ReviewRequest } from "../src/lib/trend/quality-contracts";

let checks = 0;
const pass = (label: string) => {
  checks++;
  console.log(`PASS ${label}`);
};

function campaign(name: string) {
  return blankCampaign(
    {
      name,
      product: "Olive oil",
      category: "Pantry",
      targetAudience: "Home cooks",
      objective: "Store visits",
      budget: 1000,
      channels: ["web"],
      startDate: "2026-10-01",
      endDate: "2026-10-15",
      country: "AU",
      notes: "",
    },
    defaultBrand,
    null,
    defaultSettings(),
  );
}

function park(target: Campaign, awaiting: AgentRun["awaiting"], step: AgentRun["step"], detail: string, status: AgentRun["status"] = "awaiting_human") {
  target.run = {
    id: `run-${target.id}`,
    campaignId: target.id,
    startedAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    status,
    step,
    stepsTaken: 1,
    maxSteps: 40,
    revisionAttempts: 0,
    toolsUsed: [],
    haltedReason: null,
    awaiting,
    awaitingDetail: detail,
  };
}

const idle = campaign("Idle");
assert.deepEqual(reviewQueue([idle]).map((item) => item.type), []);
pass("a campaign with no founder gate is absent");

const compliance = campaign("Compliance");
compliance.status = "awaiting_approval";
compliance.updatedAt = "2026-10-03T00:00:00.000Z";
const high = campaign("High risk");
high.status = "awaiting_approval";
high.updatedAt = "2026-10-01T00:00:00.000Z";
high.complianceReports = [
  {
    id: "cp",
    creativeId: "cr",
    version: 1,
    risk: "high",
    score: 10,
    verdict: "escalate",
    summary: "Blocked claim.",
    findings: [],
    countryProfile: "AU",
  },
];
const ordered = reviewQueue([compliance, high]).filter((item) => item.type === "compliance");
assert.deepEqual(ordered.map((item) => item.campaign.name), ["High risk", "Compliance"]);
pass("compliance reviews are waiting, highest risk first");

const researching = campaign("Still researching");
researching.running = true;
researching.status = "analysing";
park(researching, null, "trend.research", "", "running");
researching.researchCoverage = [
  {
    category: "current_market",
    evidenceIds: ["e1"],
    status: "retrieved",
    attempts: [{ category: "current_market", tool: "web.search", status: "ok", summary: "Found sources.", evidenceIds: ["e1"] }],
    limitation: "Still being assessed.",
  },
];
assert.equal(reviewQueue([researching]).some((item) => item.type === "trends"), false);
pass("research that is still running is not a trend review");

const gap = campaign("Evidence gap");
gap.researchCoverage = [
  {
    category: "current_market",
    evidenceIds: [],
    status: "missing",
    attempts: [{ category: "current_market", tool: "web.search", status: "empty", summary: "Nothing returned.", evidenceIds: [] }],
    limitation: "No source returned.",
  },
];
const request: ReviewRequest = {
  id: "req-1",
  runId: "run",
  contextVersion: "1",
  reviewVersion: 1,
  category: "context",
  findingIds: [],
  reason: "Country is missing.",
  question: "Which country is this for?",
  neededData: "Country",
  options: ["correct_context", "decline"],
  status: "pending",
  requestedAt: "2026-10-01T00:00:00.000Z",
};
gap.trendRequests = [request];
gap.status = "paused";
park(gap, "trend_clarification", "trend.quality", "Country is missing.");
const trendItems = reviewQueue([gap]).filter((item) => item.type === "trends");
assert.equal(trendItems.length, 1);
assert.equal(trendItems[0].type === "trends" && trendItems[0].pending, 1);
assert.ok(trendItems[0].type === "trends" && trendItems[0].notice);
pass("a pending research decision and its gap are one trend review");

const paused = campaign("Paused research");
paused.status = "paused";
park(paused, "trend_clarification", "trend.receive", "Add a source, then continue.");
const pausedItem = reviewQueue([paused]).find((item) => item.type === "trends");
assert.equal(pausedItem?.type === "trends" && pausedItem.pausedDetail, "Add a source, then continue.");
pass("paused research is a trend review even before a gap is recorded");

const look = campaign("Needs a look");
look.researchCoverage = [
  {
    category: "current_market",
    evidenceIds: [],
    status: "missing",
    attempts: [{ category: "current_market", tool: "web.search", status: "empty", summary: "Nothing returned.", evidenceIds: [] }],
    limitation: "No source returned.",
  },
];
const lookKey = trendNoticeKey(look);
assert.equal(reviewQueue([look]).some((item) => item.type === "trends"), true);
assert.ok(lookKey);
look.trendNoticeAck = lookKey!;
assert.equal(reviewQueue([look]).some((item) => item.type === "trends"), false, "noting the current reminder clears it");
look.trendNoticeAck = "some other reminder";
assert.equal(reviewQueue([look]).some((item) => item.type === "trends"), true, "a different mark does not clear this reminder");
look.trendNoticeAck = lookKey!;
look.researchCoverage = [
  ...(look.researchCoverage ?? []),
  {
    category: "customer_interest",
    evidenceIds: [],
    status: "missing",
    attempts: [{ category: "customer_interest", tool: "web.search", status: "empty", summary: "Nothing returned.", evidenceIds: [] }],
    limitation: "No source returned.",
  },
];
assert.equal(reviewQueue([look]).some((item) => item.type === "trends"), true, "a new gap is a new reminder");
const originalCoverage = look.researchCoverage.slice(0, 1);
const kept = withNotedTrendNotice(
  { ...look, researchCoverage: originalCoverage, trendNoticeAck: lookKey! },
  { ...look, researchCoverage: originalCoverage },
);
assert.equal(kept.trendNoticeAck, lookKey);
assert.equal(reviewQueue([kept]).some((item) => item.type === "trends"), false, "the same reminder stays cleared when another copy arrives");
const replaced = withNotedTrendNotice(
  { ...look, researchCoverage: originalCoverage, trendNoticeAck: lookKey! },
  { ...look, trendNoticeAck: undefined },
);
assert.equal(reviewQueue([replaced]).some((item) => item.type === "trends"), true, "a newer gap list is shown again");
pass("noting a trend reminder clears that reminder only");

const notedDecision = campaign("Noted decision");
notedDecision.researchCoverage = look.researchCoverage.slice(0, 1);
notedDecision.trendRequests = [request];
notedDecision.status = "paused";
park(notedDecision, "trend_clarification", "trend.quality", "Country is missing.");
notedDecision.trendNoticeAck = trendNoticeKey(notedDecision)!;
const notedItem = reviewQueue([notedDecision]).find((item) => item.type === "trends");
assert.equal(notedItem?.type === "trends" && notedItem.pending, 1);
assert.equal(notedItem?.type === "trends" && notedItem.notice, null);
pass("noting a reminder leaves a real research decision in the queue");

const slots = campaign("Slots");
const openConflict: ScheduleConflict = {
  id: "conf-open",
  channel: "instagram",
  at: "2026-10-02T09:00:00.000Z",
  kind: "same_slot",
  detail: "Overlaps the spring campaign.",
  resolved: false,
};
slots.scheduleConflicts = [
  openConflict,
  { ...openConflict, id: "conf-done", resolved: true, detail: "Already accepted." },
];
slots.status = "scheduled";
park(slots, "failure", "media.publish", "1 channel submission did not confirm.");
const channelItems = reviewQueue([slots]).filter((item) => item.type === "channels");
assert.equal(channelItems.length, 2);
assert.equal(channelItems.some((item) => item.type === "channels" && item.conflict?.id === "conf-open"), true);
assert.equal(channelItems.some((item) => item.type === "channels" && item.title === "Channel delivery"), true);
pass("an open distribution conflict and a failed delivery are both channel decisions; a resolved conflict is not");

const brief = campaign("Brief");
brief.updatedAt = "2026-10-03T00:00:00.000Z";
park(brief, "brief_correction", "intake.validate", "budget: Enter a budget.");
brief.validationProblems = [{ field: "budget", message: "Enter a budget.", clause: "intake" }];
const live = campaign("Live");
live.status = "published";
live.updatedAt = "2026-10-02T00:00:00.000Z";
const advised = campaign("Advised");
advised.status = "published";
advised.performanceReport = {
  id: "pr",
  at: "2026-10-02T00:00:00.000Z",
  publishedAt: "2026-10-01T00:00:00.000Z",
  ranChannels: ["web"],
  results: [],
  gaps: [],
  totals: null,
  summary: "Quiet week.",
  recommendationPoints: [],
  recommendationText: "Keep the offer.",
  recommendationUnsupported: false,
};
advised.recommendationDecision = {
  action: "accepted",
  text: "Keep the offer.",
  note: "",
  at: "2026-10-02T01:00:00.000Z",
  author: "Founder",
  attachedToCampaignId: null,
};
const other = reviewQueue([brief, live, advised]).filter((item) => item.type === "other");
assert.deepEqual(
  other.map((item) => (item.type === "other" ? item.kind : "")),
  ["brief", "collect"],
);
pass("a brief correction and uncollected results need a person; a decided recommendation does not");

const archived = campaign("Archived");
archived.status = "awaiting_approval";
archived.archivedAt = "2026-10-04T00:00:00.000Z";
assert.equal(reviewQueue([archived]).length, 0);
pass("trash is left out of the queue");

const mixed = reviewQueue([compliance, gap, slots, brief]);
assert.deepEqual(
  [...new Set(mixed.map((item) => item.type))],
  ["compliance", "trends", "channels", "other"],
);
pass("one desk holds compliance, trends, distribution channels and other decisions");

assert.equal(parseReviewType("trends"), "trends");
assert.equal(parseReviewType("nope"), "all");
assert.equal(approvalsHref("channels"), "/approvals?type=channels");
assert.equal(approvalsHref("all"), "/approvals");
pass("approval links stay on the approvals desk and name the type");

console.log(`${checks} checks passed`);
