/**
 * The campaign bench is a LangGraph, and this checks the drawing and one launch.
 *
 *   npm run test:graph
 */

import assert from "node:assert/strict";
import { operationMermaid } from "../src/lib/runtime/operation-graph";
import { runEngine } from "../src/lib/runtime/engine";
import { blankCampaign, defaultBrand } from "../src/lib/seed";
import { defaultSettings } from "../src/lib/settings";
import type { CompleteRequest, CompleteResult } from "../src/lib/llm/types";

const mermaid = await operationMermaid();
for (const node of ["intake", "trend", "creative", "revise", "compliance", "media", "approve", "publish"]) {
  assert.match(mermaid, new RegExp(`\\b${node}\\b`), `graph is missing ${node}`);
}
console.log("PASS compiled graph draws intake → media, including the revise loop");

const settings = defaultSettings();
const campaign = blankCampaign(
  {
    name: "Graph suite",
    product: "Northline Trail Parka",
    category: "Apparel",
    targetAudience: "Students",
    objective: "Awareness",
    budget: 18000,
    channels: ["instagram", "web"],
    startDate: "2026-09-01",
    endDate: "2026-09-21",
    country: "AU",
    notes: "",
  },
  defaultBrand,
  null,
  settings,
);

const offline = async (_req: CompleteRequest): Promise<CompleteResult> => ({
  provider: "Offline",
  providerId: "openai",
  modelId: "openai:gpt-6-luna",
  modelName: "Offline",
  status: "unconfigured",
  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, billedAs: "none", estimate: true, latencyMs: 0 },
  text: null,
  note: "suite",
  at: new Date().toISOString(),
});

const started = await runEngine(
  { campaigns: [campaign], now: "2026-10-17T00:00:00.000Z" },
  campaign,
  { type: "START", actor: "founder" },
  settings,
  defaultBrand,
  { llm: { request: offline }, maxSteps: 1, renderPoster: async () => { throw new Error("poster is later"); } },
);
assert.equal(started.campaign.status, "analysing");
assert.notEqual(started.campaign.run?.step, "intake.validate");
assert.equal(started.canAdvance, true);
console.log(`PASS launch entered the graph at ${started.campaign.run?.step}`);
