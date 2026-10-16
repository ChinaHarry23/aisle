import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { WorkflowRepository } from "../services/workflow/repository";
import { workOnce } from "../services/workflow/worker";
import { blankCampaign, defaultBrand } from "../src/lib/seed";
import { defaultSettings } from "../src/lib/settings";
import { stubGenerate } from "../src/lib/media/stub";

const base = process.env.AISLE_EVAL_LOCAL_URL || "http://127.0.0.1:8000/v1";
const url = new URL(base);
assert(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "This evaluation is restricted to a local model; paid cloud calls are not enabled.");
const response = await fetch(`${base}/models`, { signal: AbortSignal.timeout(2000) });
assert(response.ok, "Local model list unavailable");
const models = await response.json();
const model = process.env.AISLE_EVAL_MODEL || models.data?.[0]?.id;
assert(model, "No local model advertised");
const settings = defaultSettings();
settings.localBaseUrl = base;
settings.localModel = model;
for (const slot of ["trend", "creative", "compliance", "media"] as const) settings.agents[slot] = { provider: "local", modelId: "local:custom" };
const directory = mkdtempSync(path.join(os.tmpdir(), "aisle-local-evaluation-"));
const repo = new WorkflowRepository(path.join(directory, "workflow.db"));
const campaign = blankCampaign({ name: "Local model evaluation", product: "Reusable cotton grocery bag", category: "Household", targetAudience: "Australian grocery shoppers", objective: "Explain the product and invite store visits", budget: 1000, channels: ["web"], startDate: "2026-10-01", endDate: "2026-10-10", country: "AU", notes: "Synthetic coursework test. No sustainability performance claim is approved." }, defaultBrand, null, settings);
campaign.internalDataAuthorised = false;
try {
  const job = repo.enqueue("local-evaluation", "local-model-1", { campaign, campaigns: [], settings, brand: defaultBrand, command: { type: "START", actor: "founder" } });
  const started = Date.now();
  await workOnce(repo, "local-evaluation-worker", { billing: undefined /* nobody pays: no cloud call can go out */, renderPoster: async ({modelId}) => stubGenerate({ kind: "image", modelId, prompt: "Evaluation placeholder" }, "Media deliberately stubbed: evaluating text-agent decisions only.") });
  const result = repo.get("local-evaluation", job.id);
  const live = result.result?.campaign.log.filter(e => e.detail.includes("LLM decision")) || [];
  const report = { at: new Date().toISOString(), model, elapsedSeconds: Math.round((Date.now()-started)/1000), jobStatus: result.status, campaignStatus: result.result?.campaign.status, liveDecisionCount: live.length, decisions: live.map(e=>({agent:e.agent,title:e.title,detail:e.detail})), toolOutcomes: result.result?.campaign.toolCalls.map(t=>({tool:t.tool,status:t.status})), limitations: ["Synthetic campaign; not a business efficacy evaluation", "Poster generation deliberately stubbed", "No paid cloud APIs or real publishing used"] };
  writeFileSync(path.join(directory,"evaluation.json"), JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,reportFile:path.join(directory,"evaluation.json")},null,2));
  assert.equal(result.status, "completed", result.message);
  assert.equal(result.result?.campaign.status, "awaiting_approval");
  assert(live.length >= 3, "Fewer than three live decision records; do not claim a verified multi-role LLM run.");
} finally { repo.close(); }
