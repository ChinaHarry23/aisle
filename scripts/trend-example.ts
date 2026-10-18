import { blankCampaign, defaultBrand } from "../src/lib/seed";
import { defaultSettings } from "../src/lib/settings";
import { decideTrendBrief, type TrendDecision } from "../src/lib/runtime/decide";
import { createTrendAgentRuntime } from "../src/lib/agents/trend-runtime";
import { getLlmModel } from "../src/lib/llm/catalog";
import { stubComplete } from "../src/lib/llm/stub";

const mock = process.argv.includes("--mock");
const live = process.argv.includes("--live");
const fallback: TrendDecision = {
  priorities: [{ topic: "Product information", relevance: 60, confidence: 40 }],
  angle: "Introduce the product without unsupported trend claims.",
  keyMessage: "Explore the product range.", claimsAllowed: [],
  claimsAvoid: ["Market leadership"], visualDirection: "Show the product clearly.",
  limitations: ["Synthetic example only. No market trend has been established."],
};

async function main() {
  if (mock === live) throw new Error("Choose exactly one of --mock or --live.");
  const id = mock ? "local:custom" : process.env.TA02_MODEL_ID;
  if (!id) throw new Error("Set TA02_MODEL_ID to a team-approved text model ID. No request was sent.");
  const model = getLlmModel(id);
  // This snapshot's shared tool adapter implements local and OpenAI only.
  if (!mock && !["local", "openai"].includes(model.providerId)) {
    throw new Error("This provider is not supported by the current shared agent adapter.");
  }
  if (!mock && !(model.providerId === "local") && !process.argv.includes("--allow-paid")) {
    throw new Error("Cloud testing requires --allow-paid and may incur provider charges.");
  }
  if (!mock && !model.envKeys.every((key) => Boolean(process.env[key]?.trim()))) {
    throw new Error(`Missing configuration. Set ${model.envKeys.join(", ")} locally. Do not send keys in chat.`);
  }
  if (!mock && id === "local:custom" && !process.env.TA02_LOCAL_MODEL) {
    throw new Error("Set TA02_LOCAL_MODEL to the installed local text model name.");
  }
  const settings = defaultSettings();
  settings.agents.trend = { provider: model.providerId, modelId: id };
  settings.localBaseUrl = process.env.LOCAL_LLM_BASE_URL || "";
  settings.localModel = process.env.TA02_LOCAL_MODEL || "";
  const campaign = blankCampaign({
    name: "TA-02 synthetic example", product: "Example oat snack", category: "Grocery",
    targetAudience: "Adult shoppers", objective: "Product awareness", budget: 1000,
    channels: ["web"], startDate: "2026-10-20", endDate: "2026-10-27", country: "AU", notes: "",
  }, defaultBrand, null, settings);
  const before = JSON.stringify(campaign);
  const runtime = createTrendAgentRuntime(mock ? {
    mode: "mock", testCompletion: async (req) => ({
      ...stubComplete(req, "MOCK ONLY"), status: "ok", text: JSON.stringify(fallback),
    }),
  } : {
    // Owner-run synthetic smoke test only. Never use this billing context in a public route.
    billing: (model.providerId === "local") ? undefined : { kind: "unmetered", reason: "Explicit --allow-paid TA-02 owner smoke test" },
  });
  const result = await decideTrendBrief({
    campaign, brand: defaultBrand, settings, llm: runtime, fallback,
    evidenceLines: ["example-1 · synthetic founder brief · 2026-10-17 · The example product is an oat snack. Not market evidence."],
  });
  if (JSON.stringify(campaign) !== before) throw new Error("Campaign input was mutated.");
  if (!mock && (result.trace.path !== "live_model" || result.trace.status !== "ok" || result.trace.modelId !== id)) {
    throw new Error(`Live acceptance FAILED. ${result.trace.note} A fallback or different model does not satisfy TA-02.`);
  }
  console.log(JSON.stringify({
    mode: mock ? "MOCK ONLY — no real provider call" : "LIVE",
    inputUnchanged: true, decision: result.decision, trace: result.trace,
  }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Trend example failed."); process.exitCode = 1; });
