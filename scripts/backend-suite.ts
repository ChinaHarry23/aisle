/** Offline checks for "Apply one backend to all": no live models, keys or user data. */
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { BACKENDS, CLOUD_IMAGE_MODEL, CLOUD_VIDEO_MODEL, applyBackend, currentBackend, getBackend } from "../src/lib/backends";
import { allowedLocalBase, buildLlmBody, isLlmConfigured } from "../src/lib/llm/adapters";
import { AGENT_SLOTS, DEFAULT_LLM, LLM_ALIASES, LLM_MODELS, LLM_PROVIDERS, LOCAL_DEFAULT_LLM, PROVIDER_DEFAULT_MODEL, UNAVAILABLE_LLM_PROVIDERS, assignmentFor, getLlmModel, getLlmOrDefault } from "../src/lib/llm/catalog";
import { runComplete } from "../src/lib/llm/complete";
import { getModel } from "../src/lib/media/catalog";
import { quoteLlm } from "../src/lib/llm/estimate";
import { quoteModel } from "../src/lib/media/estimate";
import { renderingModel } from "../src/lib/media/generate";
import { DEFAULT_LOCAL_BASE_URL, defaultSettings, withSettingsDefaults, type WorkspaceSettings } from "../src/lib/settings";

let checks = 0;
const pass = (label: string) => { checks++; console.log(`PASS ${label}`); };
const apply = (settings: WorkspaceSettings, id: Parameters<typeof applyBackend>[1]) => withSettingsDefaults({ ...settings, ...applyBackend(settings, id) });
const seats = (settings: WorkspaceSettings) => AGENT_SLOTS.map(slot => settings.agents[slot.id]);
const SERVED = "mtplx-flash-next-optimized-speed";

const qwen = getLlmModel(LOCAL_DEFAULT_LLM);
assert.equal(qwen.providerId, "local");
assert.equal(qwen.apiModel, SERVED);
assert.equal(PROVIDER_DEFAULT_MODEL.local, LOCAL_DEFAULT_LLM);
assert.deepEqual(assignmentFor("local"), { provider: "local", modelId: LOCAL_DEFAULT_LLM });
pass("Local defaults to Qwen3.8 on MTPLX, not an uninstalled model");

const fresh = defaultSettings();
assert(seats(fresh).every(seat => seat.provider === "local" && seat.modelId === LOCAL_DEFAULT_LLM));
assert.equal(fresh.imageModelId, "comfy:local");
assert.equal(fresh.videoModelId, "comfy:minimax-h3");
assert.equal(fresh.localBaseUrl, DEFAULT_LOCAL_BASE_URL);
assert.equal(currentBackend(fresh), "local");
pass("a new workspace starts fully local");

for (const backend of BACKENDS) {
  assert.equal(getLlmModel(backend.llmModelId).providerId, backend.id);
  assert.equal(getModel(backend.imageModelId).kind, "image");
  assert.equal(getModel(backend.videoModelId).kind, "video");
  assert.equal(getModel(backend.imageModelId).providerId === "comfy", backend.where === "local");
  assert.equal(getModel(backend.videoModelId).providerId === "comfy", backend.where === "local");
  const applied = apply(fresh, backend.id);
  assert(seats(applied).every(seat => seat.provider === backend.id && seat.modelId === PROVIDER_DEFAULT_MODEL[backend.id]));
  assert.equal(applied.imageModelId, backend.imageModelId);
  assert.equal(applied.videoModelId, backend.videoModelId);
  assert.equal(currentBackend(applied), backend.id);
  assert.deepEqual(withSettingsDefaults(JSON.parse(JSON.stringify(applied))), applied);
}
assert.deepEqual(BACKENDS.map(b => b.id), ["local", "openai", "anthropic"]);
pass("every backend moves all four seats and both media models, and survives a save");

const local = getBackend("local");
assert.deepEqual([local.llmModelId, local.imageModelId, local.videoModelId], [LOCAL_DEFAULT_LLM, "comfy:local", "comfy:minimax-h3"]);
assert.deepEqual([getModel(local.imageModelId).name, getModel(local.videoModelId).name], ["Z-Image Turbo", "MiniMax H3"]);
for (const id of ["openai", "anthropic"] as const) {
  const cloud = getBackend(id);
  assert.equal(cloud.where, "cloud");
  assert.deepEqual([cloud.imageModelId, cloud.videoModelId], [CLOUD_IMAGE_MODEL, CLOUD_VIDEO_MODEL]);
}
assert.equal(CLOUD_VIDEO_MODEL, "bytedance:seedance-2.5");
pass("Local is Qwen3.8 + Z-Image Turbo + MiniMax H3; cloud is GPT Image 2 + Gemini Omni Flash");

assert.deepEqual(LLM_PROVIDERS.map(p => p.id), ["local", "openai", "anthropic"]);
assert(LLM_MODELS.every(m => !m.id.startsWith("cursor:")));
assert.match(UNAVAILABLE_LLM_PROVIDERS.find(p => p.id === "cursor")?.reason ?? "", /no public completions API/);
assert.deepEqual(LLM_MODELS.filter(m => m.providerId === "anthropic").map(m => [m.apiModel, m.billing.inputPerM, m.billing.outputPerM]), [["claude-opus-5-5", 4, 20], ["claude-sonnet-5-5", 2, 10], ["claude-haiku-4-5", 1, 5]]);
assert.equal(PROVIDER_DEFAULT_MODEL.anthropic, "anthropic:claude-sonnet-5-5");
assert.equal(PROVIDER_DEFAULT_MODEL.openai, "openai:gpt-6.1-sol");
assert.equal(DEFAULT_LLM, "openai:gpt-6.1-sol");
assert.equal(getBackend("openai").llmModelId, "openai:gpt-6.1-sol");
const luna = getLlmModel("openai:gpt-6-luna");
assert.deepEqual([luna.billing.inputPerM, luna.billing.outputPerM, luna.reasoning], [0.1, 0.5, true]);
const sol = getLlmModel("openai:gpt-6.1-sol");
assert.deepEqual([sol.apiModel, sol.billing.inputPerM, sol.billing.outputPerM, sol.reasoning, sol.effort, sol.sunset], ["gpt-6.1-sol", 2, 10, true, "low", undefined]);
const astra = getLlmModel("openai:gpt-6-astra");
assert.deepEqual([astra.apiModel, astra.billing.inputPerM, astra.billing.outputPerM, astra.reasoning, astra.effort], ["gpt-6-astra", 10, 50, true, "low"]);
assert.deepEqual(LLM_MODELS.filter(m => m.providerId === "openai").slice(0, 3).map(m => m.id), ["openai:gpt-6.1-sol", "openai:gpt-6-astra", "openai:gpt-6-luna"]);
// Each cloud label is the typical trend call, rounded to the tenth of a cent.
for (const m of LLM_MODELS.filter(m => m.providerId !== "local")) {
  const label = Number(m.estimateLabel.match(/\$([\d.]+)/)?.[1]);
  const typical = quoteLlm(m.id, "trend").costUsd;
  assert(Math.abs(label - typical) <= Math.max(0.0015, typical * 0.1), `${m.id} label ${m.estimateLabel} vs ${typical}`);
}
for (const id of ["openai:gpt-5", "openai:gpt-5-mini", "openai:o3"]) assert.equal(getLlmModel(id).sunset, "2026-12-11");
assert(LLM_MODELS.filter(m => m.providerId !== "local").every(m => (m.maxOutputTokens ?? 0) > 0), "every cloud model is capped");
pass("catalog: Cursor gone (shown disabled), Claude 5.5 / Haiku 4.5 prices, GPT-6.1 Sol default + Astra + Luna, GPT-5 family sunsets");

for (const [old, now] of Object.entries(LLM_ALIASES)) {
  assert.equal(getLlmOrDefault(old).id, now);
  assert.equal(getLlmModel(old).id, now);
}
assert.equal(getLlmOrDefault("anthropic:claude-opus-4.1").id, "anthropic:claude-opus-5-5");
assert.equal(getLlmOrDefault("anthropic:claude-sonnet-4").id, "anthropic:claude-sonnet-5-5");
assert.equal(getLlmOrDefault("anthropic:claude-haiku-3.5").id, "anthropic:claude-haiku-4-5");
assert.equal(getLlmOrDefault("cursor:claude-sonnet-4").providerId, "anthropic");
assert.equal(getLlmOrDefault("cursor:gpt-5").id, "openai:gpt-5");
// An id nobody knows stays with its provider instead of jumping to OpenAI.
assert.equal(getLlmOrDefault("anthropic:claude-9").id, PROVIDER_DEFAULT_MODEL.anthropic);
assert.equal(getLlmOrDefault("local:gone").id, LOCAL_DEFAULT_LLM);
assert.deepEqual(assignmentFor("anthropic", "anthropic:claude-haiku-3.5"), { provider: "anthropic", modelId: "anthropic:claude-haiku-4-5" });
const legacy = withSettingsDefaults(JSON.parse(JSON.stringify({ ...fresh, agents: { trend: { provider: "cursor", modelId: "cursor:composer" }, creative: { provider: "cursor", modelId: "cursor:claude-sonnet-4" }, compliance: { provider: "anthropic", modelId: "anthropic:claude-opus-4.1" }, media: { provider: "local", modelId: "local:custom" } } })));
assert.deepEqual(legacy.agents, {
  trend: { provider: "openai", modelId: "openai:gpt-6.1-sol" },
  creative: { provider: "anthropic", modelId: "anthropic:claude-sonnet-5-5" },
  compliance: { provider: "anthropic", modelId: "anthropic:claude-opus-5-5" },
  media: { provider: "local", modelId: "local:custom" },
});
assert.deepEqual(withSettingsDefaults(legacy), legacy);
assert.equal(currentBackend(withSettingsDefaults({ ...fresh, agents: Object.fromEntries(AGENT_SLOTS.map(s => [s.id, { provider: "cursor", modelId: "cursor:auto" }])) as unknown as WorkspaceSettings["agents"], imageModelId: CLOUD_IMAGE_MODEL, videoModelId: CLOUD_VIDEO_MODEL })), "openai");
pass("stored retired-Claude and Cursor seats migrate to the direct model, keeping provider and price class");

const stale: WorkspaceSettings = { ...fresh, agents: { trend: { provider: "local", modelId: "local:llama3.3" }, creative: { provider: "openai", modelId: "openai:o3" }, compliance: { provider: "anthropic", modelId: "anthropic:claude-opus-4.1" }, media: { provider: "local", modelId: "local:custom" } }, imageModelId: "ideogram:v4-quality", videoModelId: "kling:3.0" };
assert.equal(currentBackend(stale), null);
const roundTrip = apply(apply(apply(stale, "openai"), "anthropic"), "local");
// Cloud clips are 10 s at most, so the round trip keeps the snapped length rather than the default.
assert.deepEqual({ ...roundTrip, localBaseUrl: fresh.localBaseUrl, videoDurationSec: fresh.videoDurationSec }, { ...fresh, theme: roundTrip.theme });
assert.equal(apply(fresh, "local").videoDurationSec, fresh.videoDurationSec, "Local keeps a 30 s story ad");
assert.equal(apply(fresh, "openai").videoDurationSec, 10, "cloud clips snap to the longest they render");
pass("switching cloud → cloud → local restores the full local set from any mix");

assert.equal(apply({ ...fresh, localBaseUrl: "  " }, "local").localBaseUrl, DEFAULT_LOCAL_BASE_URL);
// Every workspace saved before MTPLX holds the old Ollama default; Qwen3.8 is not there.
assert.equal(apply({ ...fresh, localBaseUrl: "http://127.0.0.1:11434/v1" }, "local").localBaseUrl, DEFAULT_LOCAL_BASE_URL);
assert.equal(apply({ ...fresh, localBaseUrl: "http://127.0.0.1:11434/v1/" }, "local").localBaseUrl, DEFAULT_LOCAL_BASE_URL);
assert.equal(apply({ ...fresh, localBaseUrl: "http://127.0.0.1:8002/v1" }, "local").localBaseUrl, "http://127.0.0.1:8002/v1");
// An unchosen URL follows the server's own Local URL (its LOCAL_LLM_BASE_URL) when the page knows it.
assert.equal(applyBackend({ ...fresh, localBaseUrl: "" }, "local", "http://127.0.0.1:8002/v1").localBaseUrl, "http://127.0.0.1:8002/v1");
assert.equal(applyBackend({ ...fresh, localBaseUrl: "http://127.0.0.1:11434/v1" }, "local", "http://127.0.0.1:8002/v1").localBaseUrl, "http://127.0.0.1:8002/v1");
assert.equal("localBaseUrl" in applyBackend({ ...fresh, localBaseUrl: "" }, "openai"), false);
assert.equal("localBaseUrl" in applyBackend({ ...fresh, localBaseUrl: "http://127.0.0.1:11434/v1" }, "anthropic"), false);
pass("Local moves a blank or old-Ollama URL to MTPLX, keeps a typed one; cloud leaves it alone");

// Omni Flash renders 4–10 s: a saved 15 s default snaps to 10, and back on Local 10 s is kept.
const long = { ...fresh, videoDurationSec: 15 };
assert.equal(apply(long, "openai").videoDurationSec, 10);
assert.equal(apply(long, "local").videoDurationSec, 15);
assert.equal(apply(apply(long, "anthropic"), "local").videoDurationSec, 10);
assert.equal(apply({ ...fresh, videoDurationSec: 5 }, "openai").videoDurationSec, 4);
pass("applying a backend snaps the saved video length to one its video model can render");

// The local URL comes from user settings, so only loopback (locally) or the server's own URLs pass.
const savedHosting = [process.env.VERCEL, process.env.LOCAL_LLM_BASE_URL, process.env.LOCAL_LLM_PROBE_URLS];
delete process.env.VERCEL;
delete process.env.LOCAL_LLM_BASE_URL;
process.env.LOCAL_LLM_PROBE_URLS = "";
const customSeat = getLlmModel("local:custom");
assert.equal(allowedLocalBase("http://127.0.0.1:8002/v1/"), "http://127.0.0.1:8002/v1");
assert.equal(allowedLocalBase("https://localhost/v1"), "https://localhost/v1");
for (const bad of ["http://192.168.1.10:11434/v1", "http://169.254.169.254/", "ftp://127.0.0.1/v1", "http://a:b@localhost:1/v1", "http://localhost:1/v1#x", "", undefined]) {
  assert.equal(allowedLocalBase(bad), null, String(bad));
  assert.equal(isLlmConfigured(customSeat, bad), false, String(bad));
}
process.env.VERCEL = "1";
assert.equal(allowedLocalBase("http://127.0.0.1:8002/v1"), null);
assert.equal(isLlmConfigured(customSeat, "http://127.0.0.1:8002/v1"), false);
process.env.LOCAL_LLM_PROBE_URLS = "http://127.0.0.1:8002/v1";
assert.equal(allowedLocalBase("http://127.0.0.1:8002/v1/"), "http://127.0.0.1:8002/v1");
for (const [key, value] of [["VERCEL", savedHosting[0]], ["LOCAL_LLM_BASE_URL", savedHosting[1]], ["LOCAL_LLM_PROBE_URLS", savedHosting[2]]] as const) {
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
}
pass("local URLs: loopback only on a local install; a hosted install accepts only its configured servers");

const mediaKeys = ["OPENAI_API_KEY", "GOOGLE_AI_API_KEY", "GEMINI_API_KEY", "AISLE_MEDIA_PROVIDERS"] as const;
const savedKeys = mediaKeys.map(key => process.env[key]);
for (const key of mediaKeys) delete process.env[key];
const cloud = apply(fresh, "openai");
for (const kind of ["image", "video"] as const) {
  const runs = renderingModel({ kind, modelId: kind === "image" ? cloud.imageModelId : cloud.videoModelId });
  assert.equal(runs.providerId, "comfy");
  assert.equal(quoteModel(runs.id, { durationSec: 15 }).costUsd, 0);
  assert.equal(renderingModel({ kind, modelId: kind === "image" ? fresh.imageModelId : fresh.videoModelId }).providerId, "comfy");
}
process.env.GOOGLE_AI_API_KEY = "test-only";
assert.equal(renderingModel({ kind: "video", modelId: CLOUD_VIDEO_MODEL }).id, CLOUD_VIDEO_MODEL);
mediaKeys.forEach((key, i) => { if (savedKeys[i] === undefined) delete process.env[key]; else process.env[key] = savedKeys[i]; });
pass("Studio budgets the model that really renders: keyless cloud media is quoted as free ComfyUI");

const custom = { ...fresh, agents: Object.fromEntries(AGENT_SLOTS.map(s => [s.id, { provider: "local", modelId: "local:custom" }])) as WorkspaceSettings["agents"] };
assert.equal(currentBackend(custom), "local");
assert.equal(currentBackend({ ...fresh, agents: { ...fresh.agents, media: { provider: "openai", modelId: "openai:gpt-5" } } }), null);
assert.equal(currentBackend({ ...fresh, imageModelId: CLOUD_IMAGE_MODEL }), null);
assert.equal(currentBackend({ ...apply(fresh, "openai"), videoModelId: "comfy:minimax-h3" }), null);
assert.equal(currentBackend({ ...apply(fresh, "anthropic"), imageModelId: "ideogram:v4-quality" }), "anthropic");
pass("the Now readout tracks where things run and flags a split");

const body = buildLlmBody(qwen, { agent: "trend", modelId: qwen.id, prompt: "hi" });
assert.equal(body.model, SERVED);
assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
pass("Qwen3.8 requests name the model MTPLX serves, with thinking off");

const ask = { agent: "trend" as const, prompt: "hi" };
const mini = buildLlmBody(getLlmModel("openai:gpt-4.1-mini"), { ...ask, modelId: "openai:gpt-4.1-mini" });
assert.deepEqual([mini.max_completion_tokens, mini.temperature, "reasoning_effort" in mini, "max_tokens" in mini], [2000, 0.4, false, false]);
for (const id of ["openai:gpt-6.1-sol", "openai:gpt-6-astra", "openai:gpt-6-luna", "openai:gpt-5", "openai:o3"]) {
  const reasoning = buildLlmBody(getLlmModel(id), { ...ask, modelId: id });
  assert.deepEqual([reasoning.max_completion_tokens, reasoning.reasoning_effort, "temperature" in reasoning], [2000, "low", false], id);
}
for (const id of ["anthropic:claude-opus-5-5", "anthropic:claude-sonnet-5-5"]) {
  const claude = buildLlmBody(getLlmModel(id), { ...ask, modelId: id });
  assert.deepEqual([claude.max_tokens, claude.output_config, "temperature" in claude], [3000, { effort: "low" }, false], id);
}
const haiku = buildLlmBody(getLlmModel("anthropic:claude-haiku-4-5"), { ...ask, modelId: "anthropic:claude-haiku-4-5" });
assert.deepEqual([haiku.max_tokens, "output_config" in haiku, "temperature" in haiku], [3000, false, false]);
const savedCursor = process.env.CURSOR_API_KEY;
process.env.CURSOR_API_KEY = "test-only";
assert.equal(isLlmConfigured({ ...getLlmModel("openai:gpt-4.1-mini"), providerId: "cursor" as never, envKeys: ["CURSOR_API_KEY"] }), false);
if (savedCursor === undefined) delete process.env.CURSOR_API_KEY; else process.env.CURSOR_API_KEY = savedCursor;
pass("cloud bodies are capped: max_completion_tokens, low reasoning effort without temperature, Claude effort only on 5.x; removed providers never configured");

const { emptyWorkspace, demoWorkspace } = await import("../src/lib/auth/workspace");
const savedDefault = process.env.AISLE_DEFAULT_BACKEND;
delete process.env.AISLE_DEFAULT_BACKEND;
assert.equal(currentBackend(emptyWorkspace().settings), "local");
process.env.AISLE_DEFAULT_BACKEND = "anthropic";
assert.equal(currentBackend(emptyWorkspace().settings), "anthropic");
assert.equal(currentBackend(demoWorkspace().settings), "anthropic");
assert(seats(emptyWorkspace().settings).every(seat => seat.modelId === "anthropic:claude-sonnet-5-5"));
process.env.AISLE_DEFAULT_BACKEND = " OpenAI ";
assert.equal(currentBackend(emptyWorkspace().settings), "openai");
process.env.AISLE_DEFAULT_BACKEND = "cursor";
assert.equal(currentBackend(emptyWorkspace().settings), "local");
if (savedDefault === undefined) delete process.env.AISLE_DEFAULT_BACKEND; else process.env.AISLE_DEFAULT_BACKEND = savedDefault;
pass("AISLE_DEFAULT_BACKEND starts new server-created workspaces on that backend; unknown values stay local");

const seen: { path?: string; body?: Record<string, unknown> }[] = [];
let lmStudio = false;
const fake = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString();
  seen.push({ path: req.url, body: raw ? JSON.parse(raw) : undefined });
  res.setHeader("content-type", "application/json");
  if (lmStudio && req.url === "/api/v0/models") return res.end(JSON.stringify({ data: [{ id: "installed-not-loaded", state: "not-loaded", type: "llm" }, { id: "qwen-loaded", state: "loaded", type: "llm" }] }));
  if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: SERVED }] }));
  if (req.url === "/system_stats") return res.end(JSON.stringify({ system: {} }));
  if (req.url === "/v1/chat/completions") return res.end(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }], usage: { prompt_tokens: 12, completion_tokens: 4 } }));
  res.statusCode = 404;
  res.end("{}");
});
fake.listen(0, "127.0.0.1");
await once(fake, "listening");
const address = fake.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
try {
  const settings = apply({ ...fresh, localBaseUrl: `${base}/v1` }, "local");
  // No billing context at all: a Local seat is free, so it still runs.
  const done = await runComplete({ agent: "compliance", modelId: settings.agents.compliance.modelId, prompt: "Check copy", localBaseUrl: settings.localBaseUrl, localModel: settings.localModel }, undefined);
  assert.equal(done.status, "ok", done.note);
  assert.equal(done.modelName, "Qwen3.8 Flash-Next");
  assert.equal(done.text, "{\"ok\":true}");
  const call = seen.find(row => row.path === "/v1/chat/completions");
  assert.equal(call?.body?.model, SERVED);
  const padded = await runComplete({ agent: "trend", modelId: LOCAL_DEFAULT_LLM, prompt: "Brief", localBaseUrl: ` ${base}/v1/ ` }, undefined);
  assert.equal(padded.status, "ok", padded.note);
  pass("a Local seat completes end to end against an MTPLX-shaped server, even with a padded URL");

  process.env.LOCAL_LLM_BASE_URL = `${base}/v1`;
  process.env.COMFYUI_URL = base;
  const { GET } = await import("../src/app/api/settings/status/route");
  const up = await (await GET()).json();
  assert.deepEqual(Object.keys(up.llm).sort(), ["anthropic", "local", "openai"]);
  assert.deepEqual(up.runtime, { localBase: `${base}/v1`, localModel: SERVED, comfy: true });
  lmStudio = true;
  assert.equal((await (await GET()).json()).runtime.localModel, "qwen-loaded");
  lmStudio = false;
  fake.close();
  await once(fake, "close");
  const down = await (await GET()).json();
  assert.deepEqual(down.runtime, { localBase: `${base}/v1`, localModel: null, comfy: false });
  pass("status names the probed URL and its loaded model (not an unloaded LM Studio one), and reports absence");
} finally {
  if (fake.listening) fake.close();
}

console.log(`\n${checks} backend checks passed.`);
