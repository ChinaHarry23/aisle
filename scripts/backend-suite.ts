/** Offline checks for the LLM catalog defaults and a Local seat, adapted to Cindy's catalogs. */
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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
import { runComplete } from "../src/lib/llm/metered-complete";
import { defaultSettings, withSettingsDefaults, type WorkspaceSettings } from "../src/lib/settings";
import { LOCAL_DEFAULT_LLM } from "../src/lib/pr2-shims";

let checks = 0;
const pass = (label: string) => {
  checks++;
  console.log(`PASS ${label}`);
};
const seats = (settings: WorkspaceSettings) => AGENT_SLOTS.map((slot) => settings.agents[slot.id]);

const llama = getLlmModel(LOCAL_DEFAULT_LLM);
assert.equal(llama.providerId, "local");
assert.equal(PROVIDER_DEFAULT_MODEL.local, LOCAL_DEFAULT_LLM);
assert.deepEqual(assignmentFor("local"), { provider: "local", modelId: LOCAL_DEFAULT_LLM });
pass("Local default is Cindy's llama3.3");

const fresh = defaultSettings();
assert(seats(fresh).every((seat) => seat.provider === "openai" && seat.modelId === DEFAULT_LLM));
assert.equal(fresh.imageModelId, "openai:gpt-image-2.5");
assert.equal(fresh.videoModelId, "google:veo-3.1-fast");
assert.equal(fresh.localBaseUrl, "http://127.0.0.1:11434/v1");
pass("a new workspace starts on OpenAI (Cindy's Settings defaults)");

for (const p of LLM_PROVIDERS) {
  assert.equal(getLlmModel(PROVIDER_DEFAULT_MODEL[p.id]).providerId, p.id);
  assert.deepEqual(assignmentFor(p.id), { provider: p.id, modelId: PROVIDER_DEFAULT_MODEL[p.id] });
}
pass("every provider default is a model of that provider");

assert.deepEqual(LLM_PROVIDERS.map((p) => p.id), ["local", "openai", "anthropic", "cursor"]);
assert(LLM_MODELS.some((m) => m.id.startsWith("cursor:")));
assert.equal(DEFAULT_LLM, "openai:gpt-6.1-sol");
assert.equal(PROVIDER_DEFAULT_MODEL.openai, "openai:gpt-6.1-sol");
assert.equal(PROVIDER_DEFAULT_MODEL.anthropic, "anthropic:claude-sonnet-5.5");
assert.equal(getLlmOrDefault("missing-model").id, DEFAULT_LLM);
pass("catalog keeps Cindy's Cursor seats and GPT-6.1 Sol as the OpenAI default; an unknown id falls back to it");
const legacy = withSettingsDefaults({
  agents: {
    trend: { provider: "openai", modelId: "openai:gpt-6-luna" },
    creative: { provider: "openai", modelId: "openai:gpt-6-luna" },
    compliance: { provider: "openai", modelId: "openai:gpt-6-luna" },
    media: { provider: "openai", modelId: "openai:gpt-6-luna" },
  },
});
assert(seats(legacy).every((seat) => seat.modelId === DEFAULT_LLM));
const chosen = withSettingsDefaults({ ...legacy, agents: { ...legacy.agents, trend: { provider: "openai", modelId: "openai:gpt-6-luna" } } });
assert.equal(chosen.agents.trend.modelId, "openai:gpt-6-luna");
assert.equal(chosen.agents.creative.modelId, DEFAULT_LLM);
pass("saved Luna defaults move to Sol once; a later explicit Luna choice stays");

const luna = buildLlmBody(getLlmModel("openai:gpt-6-luna"), {
  agent: "trend",
  modelId: "openai:gpt-6-luna",
  prompt: "hi",
});
assert.equal(luna.model, "gpt-6-luna");
assert.equal(luna.reasoning_effort, "low");
assert.equal("temperature" in luna, false);
const customSeat = getLlmModel("local:custom");
assert.equal(isLlmConfigured(customSeat, "http://127.0.0.1:11434/v1"), true);
assert.equal(isLlmConfigured(getLlmModel("openai:gpt-6-luna")), false);
pass("GPT-6 Luna omits temperature; local is configured when a base URL is set");

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
  const settings = { ...fresh, localBaseUrl: `${base}/v1`, agents: Object.fromEntries(AGENT_SLOTS.map((s) => [s.id, assignmentFor("local")])) as WorkspaceSettings["agents"] };
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
