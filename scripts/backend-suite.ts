/** Offline checks for "Apply one backend to all", adapted to Cindy's catalogs. */
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  BACKENDS,
  CLOUD_IMAGE_MODEL,
  CLOUD_VIDEO_MODEL,
  applyBackend,
  currentBackend,
  getBackend,
  DEFAULT_LOCAL_BASE_URL,
} from "../src/lib/backends";
import { buildLlmBody, isLlmConfigured } from "../src/lib/llm/adapters";
import {
  AGENT_SLOTS,
  DEFAULT_LLM,
  LLM_MODELS,
  LLM_PROVIDERS,
  PROVIDER_DEFAULT_MODEL,
  assignmentFor,
  getLlmModel,
  getLlmOrDefault,
} from "../src/lib/llm/catalog";
import { runComplete } from "../src/lib/llm/complete";
import { getModel } from "../src/lib/media/catalog";
import { defaultSettings, withSettingsDefaults, type WorkspaceSettings } from "../src/lib/settings";
import { LOCAL_DEFAULT_LLM, renderingModel } from "../src/lib/pr2-shims";

let checks = 0;
const pass = (label: string) => {
  checks++;
  console.log(`PASS ${label}`);
};
const apply = (settings: WorkspaceSettings, id: Parameters<typeof applyBackend>[1]) =>
  withSettingsDefaults({ ...settings, ...applyBackend(settings, id) });
const seats = (settings: WorkspaceSettings) => AGENT_SLOTS.map((slot) => settings.agents[slot.id]);

const llama = getLlmModel(LOCAL_DEFAULT_LLM);
assert.equal(llama.providerId, "local");
assert.equal(PROVIDER_DEFAULT_MODEL.local, LOCAL_DEFAULT_LLM);
assert.deepEqual(assignmentFor("local"), { provider: "local", modelId: LOCAL_DEFAULT_LLM });
pass("Local default is Cindy's llama3.3");

const fresh = defaultSettings();
assert(seats(fresh).every((seat) => seat.provider === "openai" && seat.modelId === DEFAULT_LLM));
assert.equal(fresh.imageModelId, "openai:gpt-image-2");
assert.equal(fresh.videoModelId, "google:veo-3.1-fast");
assert.equal(fresh.localBaseUrl, DEFAULT_LOCAL_BASE_URL);
assert.equal(currentBackend(fresh), "openai");
pass("a new workspace starts on OpenAI (Cindy's Settings defaults)");

for (const backend of BACKENDS) {
  assert.equal(getLlmModel(backend.llmModelId).providerId, backend.id);
  assert.equal(getModel(backend.imageModelId).kind, "image");
  assert.equal(getModel(backend.videoModelId).kind, "video");
  const applied = apply(fresh, backend.id);
  assert(
    seats(applied).every(
      (seat) => seat.provider === backend.id && seat.modelId === PROVIDER_DEFAULT_MODEL[backend.id],
    ),
  );
  assert.equal(applied.imageModelId, backend.imageModelId);
  assert.equal(applied.videoModelId, backend.videoModelId);
  assert.equal(currentBackend(applied), backend.id);
  assert.deepEqual(withSettingsDefaults(JSON.parse(JSON.stringify(applied))), applied);
}
assert.deepEqual(BACKENDS.map((b) => b.id), ["local", "openai", "anthropic", "cursor"]);
pass("every backend moves all four seats and both media models, and survives a save");

const local = getBackend("local");
assert.equal(local.llmModelId, LOCAL_DEFAULT_LLM);
assert.equal(local.imageModelId, "openai:gpt-image-2");
assert.equal(local.videoModelId, "google:veo-3.1-fast");
for (const id of ["openai", "anthropic", "cursor"] as const) {
  const cloud = getBackend(id);
  assert.equal(cloud.where, "cloud");
  assert.deepEqual([cloud.imageModelId, cloud.videoModelId], [CLOUD_IMAGE_MODEL, CLOUD_VIDEO_MODEL]);
}
assert.equal(CLOUD_IMAGE_MODEL, "openai:gpt-image-2");
assert.equal(CLOUD_VIDEO_MODEL, "bytedance:seedance-2-fast");
pass("cloud backends share Cindy's GPT Image 2 + Seedance Fast");

assert.deepEqual(LLM_PROVIDERS.map((p) => p.id), ["local", "openai", "anthropic", "cursor"]);
assert(LLM_MODELS.some((m) => m.id.startsWith("cursor:")));
assert.equal(DEFAULT_LLM, "openai:gpt-4.1-mini");
assert.equal(PROVIDER_DEFAULT_MODEL.openai, "openai:gpt-4.1-mini");
assert.equal(PROVIDER_DEFAULT_MODEL.anthropic, "anthropic:claude-sonnet-4");
assert.equal(getBackend("openai").llmModelId, "openai:gpt-4.1-mini");
pass("catalog keeps Cindy's Cursor seats and GPT-4.1 mini default");

assert.equal(getLlmOrDefault("missing-model").id, DEFAULT_LLM);
assert.equal(apply({ ...fresh, localBaseUrl: "  " }, "local").localBaseUrl, DEFAULT_LOCAL_BASE_URL);
assert.equal(
  apply({ ...fresh, localBaseUrl: "http://127.0.0.1:8002/v1" }, "local").localBaseUrl,
  "http://127.0.0.1:8002/v1",
);
assert.equal("localBaseUrl" in applyBackend({ ...fresh, localBaseUrl: "" }, "openai"), false);
pass("Local fills a blank URL with Ollama; a typed URL is kept; cloud leaves it alone");

const custom = {
  ...fresh,
  agents: Object.fromEntries(
    AGENT_SLOTS.map((s) => [s.id, { provider: "local", modelId: "local:custom" }]),
  ) as WorkspaceSettings["agents"],
};
assert.equal(currentBackend(custom), "local");
assert.equal(
  currentBackend({ ...fresh, agents: { ...fresh.agents, media: { provider: "openai", modelId: "openai:gpt-5" } } }),
  "openai",
);
pass("the Now readout tracks a single provider across seats");

const mini = buildLlmBody(getLlmModel("openai:gpt-4.1-mini"), {
  agent: "trend",
  modelId: "openai:gpt-4.1-mini",
  prompt: "hi",
});
assert.equal(mini.model, "gpt-4.1-mini");
assert.equal(mini.temperature, 0.4);
const customSeat = getLlmModel("local:custom");
assert.equal(isLlmConfigured(customSeat, "http://127.0.0.1:11434/v1"), true);
assert.equal(isLlmConfigured(getLlmModel("openai:gpt-4.1-mini")), false);
pass("Cindy's OpenAI bodies use temperature; local is configured when a base URL is set");

const rendered = renderingModel({ kind: "image", modelId: fresh.imageModelId });
assert.equal(rendered.id, fresh.imageModelId);
pass("Studio quotes Cindy's default image model");

const seen: { path?: string; body?: Record<string, unknown> }[] = [];
const fake = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString();
  seen.push({ path: req.url, body: raw ? JSON.parse(raw) : undefined });
  res.setHeader("content-type", "application/json");
  if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: llama.apiModel }] }));
  if (req.url === "/v1/chat/completions") {
    return res.end(
      JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 4 },
      }),
    );
  }
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
  const done = await runComplete({
    agent: "compliance",
    modelId: settings.agents.compliance.modelId,
    prompt: "Check copy",
    localBaseUrl: settings.localBaseUrl,
    localModel: settings.localModel,
  });
  assert.equal(done.status, "ok", done.note);
  assert.equal(done.text, '{"ok":true}');
  const call = seen.find((row) => row.path === "/v1/chat/completions");
  assert.equal(call?.body?.model, llama.apiModel);
  pass("a Local seat completes end to end against an OpenAI-compatible server");

  const { GET } = await import("../src/app/api/settings/status/route");
  const up = await (await GET()).json();
  assert.deepEqual(Object.keys(up.llm).sort(), ["anthropic", "cursor", "local", "openai"]);
  assert(up.media && typeof up.media === "object");
  pass("status reports Cindy's LLM and media provider connection booleans");
} finally {
  if (fake.listening) fake.close();
}

console.log(`\n${checks} backend checks passed.`);
