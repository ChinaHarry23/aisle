/**
 * The graphs LangSmith Studio serves: the bench can run a command, and a seat
 * is the same agent the app builds.
 *
 *   npm run test:studio
 */

import assert from "node:assert/strict";
import { assembleStudioSeat, type StudioSeatSession } from "../src/lib/studio/seats";
import { graph, setStudioOperationDeps } from "../src/lib/studio/operation";
import {
  graphServerUrl,
  operationThreadId,
  readGraphFailure,
  readGraphOutcome,
  studioHref,
} from "../src/lib/studio/remote";
import { operationMermaid } from "../src/lib/runtime/operation-graph";
import { openEngineWork, openStepEnv } from "../src/lib/runtime/engine";
import { blankCampaign, defaultBrand } from "../src/lib/seed";
import { defaultSettings } from "../src/lib/settings";
import type { BillingContext } from "../src/lib/billing/meter";
import type { CompleteRequest, CompleteResult } from "../src/lib/llm/types";

const billing: BillingContext = { kind: "unmetered", reason: "studio suite" };
const usage: CompleteResult["usage"] = {
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
  costUsd: 0,
  billedAs: "test",
  estimate: true,
  latencyMs: 0,
};

function answered(partial: Pick<CompleteResult, "text" | "toolCalls">): CompleteResult {
  return {
    provider: "Test",
    providerId: "openai",
    modelId: "openai:gpt-6-luna",
    modelName: "Test",
    status: "ok",
    usage,
    note: "studio suite",
    at: "2026-10-18T00:00:00.000Z",
    ...partial,
  };
}

const settings = defaultSettings();
const campaign = blankCampaign(
  {
    name: "Studio suite",
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

const offline = async (): Promise<CompleteResult> =>
  answered({ text: null });

const now = "2026-10-18T00:00:00.000Z";
const work = openEngineWork(campaign, now);
const env = openStepEnv({ campaigns: [work.campaign], now }, work.campaign, settings, defaultBrand, {
  llm: { request: offline },
  renderPoster: async () => {
    throw new Error("poster is later");
  },
});

let saved = 0;
setStudioOperationDeps({
  async load() {
    return { userId: "dev-alex", work, env };
  },
  async save() {
    saved += 1;
  },
});

const studio = graph.compile();
const drawing = await studio.getGraphAsync();
const mermaid = drawing.drawMermaid();
const product = await operationMermaid();
for (const node of ["intake", "trend", "creative", "revise", "compliance", "media", "approve", "publish"]) {
  assert.match(product, new RegExp(`\\b${node}\\b`), `product graph is missing ${node}`);
  assert.match(mermaid, new RegExp(`\\b${node}\\b`), `studio graph is missing ${node}`);
}
assert.match(mermaid, /\bhydrate\b/, "studio graph loads the campaign before the bench");
console.log("PASS studio operation graph draws the bench, plus hydrate");

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => Response.json({ title: "Synthetic fixture", extract: "Synthetic category context; not measured market research." });
const started = await studio.invoke({ command: { type: "START", actor: "founder" } });
globalThis.fetch = originalFetch;
assert.equal(started.work?.campaign.status, "analysing");
assert.notEqual(started.work?.campaign.run?.step, "intake.validate");
assert.equal(started.canAdvance, true);
assert.ok(saved > 0, "the command was written back");
console.log(`PASS studio START entered the bench at ${started.work?.campaign.run?.step}`);

const session: StudioSeatSession = {
  userId: "dev-alex",
  billing,
  work,
  env,
  settings,
  brand: defaultBrand,
};

const trendAnswer = {
  priorities: [{ topic: "Rain", relevance: 80, confidence: 70 }],
  angle: "A wet-weather layer for the walk to class",
  keyMessage: "A parka for the walk between lectures",
  claimsAllowed: ["water resistant shell"],
  claimsAvoid: ["best"],
  visualDirection: "Grey street, no logos",
  limitations: ["no competitor prices"],
};

function scripted(seat: "trend" | "media") {
  return async (req: CompleteRequest): Promise<CompleteResult> => {
    const names = (req.tools ?? []).map((item) => item.name);
    if (seat === "trend") {
      assert.ok(names.includes("web.shelf_prices"), "trend keeps the real registry");
    } else {
      assert.equal(names.some((name) => name.includes(".")), false, "media receives no research tools");
    }
    const structured = names.find((name) => !name.includes("."));
    const already = (req.history ?? []).some((turn) => turn.role === "tool");
    if (structured && !already) {
      const args = seat === "trend" ? trendAnswer : { points: [] };
      return answered({ text: "", toolCalls: [{ id: "call_structured", name: structured, args }] });
    }
    return answered({ text: JSON.stringify(seat === "trend" ? trendAnswer : { points: [] }) });
  };
}

const trend = assembleStudioSeat("trend", { ...session, complete: scripted("trend") });
const trendRun = await trend.invoke({ messages: [{ role: "user", content: "Brief this campaign." }] });
const trendAnswered = (trendRun as { structuredResponse?: { angle?: string } }).structuredResponse;
assert.equal(trendAnswered?.angle, trendAnswer.angle);
const trendDrawing = await (trend as { getGraphAsync: () => Promise<{ drawMermaid: () => string }> }).getGraphAsync();
assert.match(trendDrawing.drawMermaid(), /aisle_trend|agent|tools/);
console.log("PASS studio trend seat uses the registry and returns the brief");

const media = assembleStudioSeat("media", { ...session, complete: scripted("media") });
const mediaRun = await media.invoke({ messages: [{ role: "user", content: "What should we keep?" }] });
const mediaAnswered = (mediaRun as { structuredResponse?: { points?: unknown[] } }).structuredResponse;
assert.deepEqual(mediaAnswered?.points, []);
console.log("PASS studio media seat has no research tools");

const threadA = operationThreadId("cmp_demo");
const threadB = operationThreadId("cmp_demo");
assert.equal(threadA, threadB, "one campaign keeps one Studio thread");
assert.match(threadA, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
assert.notEqual(operationThreadId("cmp_other"), threadA);
assert.deepEqual(readGraphOutcome({ canAdvance: true, message: "Trend analysis" }), {
  canAdvance: true,
  message: "Trend analysis",
});
assert.deepEqual(readGraphOutcome(null), { canAdvance: false, message: "" });
assert.equal(
  readGraphFailure({
    __error__: { error: "Error", message: JSON.stringify({ error: "Error", message: "No campaign \"cmp_x\"." }) },
  }),
  "No campaign \"cmp_x\".",
);
assert.equal(readGraphFailure({ canAdvance: false, message: "" }), null);
const previousGraph = process.env.AISLE_GRAPH_URL;
const previousNodeEnv = process.env.NODE_ENV;
process.env.AISLE_GRAPH_URL = "off";
assert.equal(graphServerUrl(), null);
process.env.AISLE_GRAPH_URL = "http://127.0.0.1:2024/";
assert.equal(graphServerUrl(), "http://127.0.0.1:2024");
delete process.env.AISLE_GRAPH_URL;
const mutableEnv = process.env as Record<string, string | undefined>;
mutableEnv.NODE_ENV = "production";
assert.equal(graphServerUrl(), null, "production does not assume a local graph server");
mutableEnv.NODE_ENV = "development";
assert.equal(graphServerUrl(), "http://127.0.0.1:2024");
assert.match(
  studioHref("http://127.0.0.1:2024", threadA),
  new RegExp(`/studio/thread/${threadA}\\?baseUrl=http%3A%2F%2F127.0.0.1%3A2024$`),
);
if (previousGraph === undefined) delete mutableEnv.AISLE_GRAPH_URL;
else mutableEnv.AISLE_GRAPH_URL = previousGraph;
if (previousNodeEnv === undefined) delete mutableEnv.NODE_ENV;
else mutableEnv.NODE_ENV = previousNodeEnv;
console.log("PASS a campaign thread is the graph Studio opens and the run it traces");
