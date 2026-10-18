import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createTrendAgentRuntime } from "../src/lib/agents/trend-runtime";
import { stubComplete } from "../src/lib/llm/stub";
import type { CompleteRequest } from "../src/lib/llm/types";
import { runEngine } from "../src/lib/runtime/engine";
import { blankCampaign, defaultBrand } from "../src/lib/seed";
import { defaultSettings } from "../src/lib/settings";
import { createServerTrendRuntime } from "../src/lib/agents/trend-server";
import { decideTrendBrief } from "../src/lib/runtime/decide";

// Every response in this suite is synthetic, including the loopback HTTP server.
// Passing this suite is NOT proof of a real LLM call.
delete process.env.LANGSMITH_TRACING;
delete process.env.LANGCHAIN_TRACING_V2;
const request: CompleteRequest = { agent: "trend", modelId: "local:custom", prompt: "Synthetic oat snack campaign. Evidence is insufficient to establish a market trend." };
const answer = {
  priorities: [{ topic: "Product context", relevance: 60, confidence: 20 }],
  angle: "Introduce the product", keyMessage: "Discover the product", claimsAllowed: [],
  claimsAvoid: ["Market leader"], visualDirection: "Show the product", limitations: ["No trend evidence"],
};
let checks = 0;
const pass = (name: string) => { checks++; console.log(`PASS ${name}`); };
const enabledBefore = process.env.TA02_AGENT_ENABLED;
try {
  delete process.env.TA02_AGENT_ENABLED;
  assert.equal(createServerTrendRuntime(), undefined);
  process.env.TA02_AGENT_ENABLED = "true";
  assert.equal(createServerTrendRuntime(), undefined);
  pass("server integration is disabled unless explicitly set to 1");
  process.env.TA02_AGENT_ENABLED = "1";
  const serverRuntime = createServerTrendRuntime()!;
  assert.equal((await serverRuntime.request({ ...request, modelId: "anthropic:claude-sonnet-5.5" })).status, "unconfigured");
  pass("server workflows reject unsupported providers");
  assert.equal((await serverRuntime.request({ ...request, modelId: "openai:gpt-6-luna" })).status, "no_credits");
  const unmetered = createServerTrendRuntime({ kind: "unmetered", reason: "test" })!;
  assert.equal((await unmetered.request({ ...request, modelId: "openai:gpt-6-luna" })).status, "no_credits");
  pass("server cloud calls cannot use absent or unmetered billing identities");
} finally {
  if (enabledBefore === undefined) delete process.env.TA02_AGENT_ENABLED;
  else process.env.TA02_AGENT_ENABLED = enabledBefore;
}
assert.throws(() => createTrendAgentRuntime({ testCompletion: async (req) => stubComplete(req, "test") }), /mock/);
pass("injected completions cannot masquerade as live mode");
let calls = 0;
const mock = createTrendAgentRuntime({ mode: "mock", testCompletion: async (req) => {
  calls++;
  assert.equal(req.agent, "trend");
  assert.equal(req.maxOutputTokens, 1600);
  assert.ok(!req.tools?.some((t) => t.name.startsWith("web.") || t.name.startsWith("retail.")));
  return { ...stubComplete(req, "test"), status: "ok", text: JSON.stringify(answer) };
} });
const mockResult = await mock.request(request);
assert.equal(calls, 1);
assert.equal(mockResult.status, "stubbed");
assert.deepEqual(JSON.parse(mockResult.text!), answer);
pass("one bounded agent decision with validated JSON and explicit mock label");
const invalid = createTrendAgentRuntime({ mode: "mock", testCompletion: async (req) => ({
  ...stubComplete(req, "test"), status: "ok", text: '{"angle":"incomplete"}',
}) });
assert.equal((await invalid.request(request)).status, "error");
pass("incomplete model output is rejected");
const secret = "SECRET_TEST_SENTINEL";
const failed = createTrendAgentRuntime({ mode: "mock", testCompletion: async () => { throw new Error(secret); } });
const failure = await failed.request(request);
assert.equal(failure.status, "error");
assert.ok(!JSON.stringify(failure).includes(secret));
pass("connection failure has a readable error without leaking provider details");
await assert.rejects(mock.request({ ...request, modelId: "not-a-real-model" }), /Unknown LLM/);
pass("unknown model is rejected without silently choosing a default");
await assert.rejects(mock.request({ ...request, agent: "creative" }), /only accepts Trend/);
pass("mock runtime cannot accidentally call a live non-Trend provider");
let retryCalls = 0;
const retry = createTrendAgentRuntime({ mode: "mock", testCompletion: async (req) => {
  retryCalls++;
  return { ...stubComplete(req, "test"), status: "ok", text: null,
    toolCalls: [{ id: "invalid-tool", name: "not_an_allowed_tool", args: {} }] };
} });
assert.equal((await retry.request(request)).status, "error");
assert.equal(retryCalls, 1);
pass("agent cannot trigger a second provider attempt");
const rerouted = createTrendAgentRuntime({ mode: "mock", testCompletion: async (req) => ({
  ...stubComplete(req, "test"), status: "ok", modelId: "local:other", text: JSON.stringify(answer),
  usage: { ...stubComplete(req, "test").usage, totalTokens: 42 },
}) });
const rerouteResult = await rerouted.request(request);
assert.equal(rerouteResult.status, "error");
assert.match(rerouteResult.note, /rerouted/);
assert.equal(rerouteResult.usage.totalTokens, 42);
pass("reroutes cannot count as selected-model success and incurred usage is retained");

const settings = defaultSettings();
settings.agents.trend = { provider: "local", modelId: "local:custom" };
const campaign = blankCampaign({
  name: "TA-02 integration", product: "Example oat snack", category: "Grocery",
  targetAudience: "Adult shoppers", objective: "Product awareness", budget: 1000,
  channels: ["web"], startDate: "2026-10-20", endDate: "2026-10-27", country: "AU", notes: "",
}, defaultBrand, null, settings);
campaign.internalDataAuthorised = false;
const before = JSON.stringify(campaign);
const originalFetch = globalThis.fetch;
const savedOpenAIKey = process.env.OPENAI_API_KEY;
const savedOpenAIBase = process.env.OPENAI_API_BASE;
process.env.OPENAI_API_KEY = "offline-test-key";
process.env.OPENAI_API_BASE = "https://api.openai.com/v1";
try {
  for (const [modelId, endpoint, cap] of [
    ["openai:gpt-6-luna", "/chat/completions", "max_completion_tokens"],
    ["openai:gpt-6.1-sol", "/responses", "max_output_tokens"],
  ]) {
    let sent = 0;
    globalThis.fetch = async (url, init) => {
      sent++;
      assert.equal(String(url), `https://api.openai.com/v1${endpoint}`);
      const body = JSON.parse(String(init?.body));
      assert.equal(body[cap], 1600);
      assert.ok(body.tools.length > 0, "shared structured-output tool is advertised");
      return Response.json(endpoint === "/responses" ? {
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }],
        usage: { input_tokens: 100, output_tokens: 80 },
      } : {
        choices: [{ message: { role: "assistant", content: JSON.stringify(answer) } }],
        usage: { prompt_tokens: 100, completion_tokens: 80 },
      });
    };
    const result = await createTrendAgentRuntime({ billing: { kind: "unmetered", reason: "offline fixture" } })
      .request({ ...request, modelId });
    assert.equal(result.status, "ok");
    assert.equal(sent, 1);
    pass(`MOCK ${endpoint} carries the 1600-token cap through the shared adapter`);
  }
} finally {
  globalThis.fetch = originalFetch;
  if (savedOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedOpenAIKey;
  if (savedOpenAIBase === undefined) delete process.env.OPENAI_API_BASE;
  else process.env.OPENAI_API_BASE = savedOpenAIBase;
}
globalThis.fetch = async () => { throw new Error("Offline integration test. No external research."); };
try {
  const previousCalls = calls;
  const result = await runEngine({ campaigns: [campaign], now: "2026-10-17T00:00:00.000Z" },
    campaign, { type: "START", actor: "founder" }, settings, defaultBrand,
    { llm: mock, maxSteps: 2, renderPoster: async () => { throw new Error("Creative execution is outside this test."); } });
  assert.equal(calls, previousCalls + 1);
  assert.equal(JSON.stringify(campaign), before);
  for (const field of ["product", "category", "targetAudience", "objective", "budget", "country", "startDate", "endDate", "channels"] as const) {
    assert.deepEqual(result.campaign[field], campaign[field]);
  }
  assert.ok(result.campaign.brief);
  assert.ok(JSON.stringify(result).includes("MOCK ONLY"));
  pass("existing LangGraph Trend node consumes injected runtime and preserves founder scope");
} finally { globalThis.fetch = originalFetch; }

let httpCalls = 0;
let responseStatus = 200;
const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const sent = JSON.parse(body);
  httpCalls++;
  assert.equal(req.url, "/v1/chat/completions");
  assert.equal(sent.model, "synthetic-test-model");
  res.writeHead(responseStatus, { "Content-Type": "application/json" });
  res.end(JSON.stringify(responseStatus === 200 ? {
    choices: [{ message: { role: "assistant", content: JSON.stringify(answer) } }],
    usage: { prompt_tokens: 100, completion_tokens: 80 },
  } : { error: secret }));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
try {
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const req = { ...request, localBaseUrl: `http://127.0.0.1:${address.port}/v1`, localModel: "synthetic-test-model" };
  const livePath = createTrendAgentRuntime();
  const result = await livePath.request(req);
  assert.equal(result.status, "ok");
  assert.deepEqual(JSON.parse(result.text!), answer);
  assert.equal(result.usage.totalTokens, 180);
  assert.equal(httpCalls, 1);
  pass("shared metered adapter HTTP path works against a LOCAL FAKE server");
  const testSettings = structuredClone(settings);
  testSettings.localBaseUrl = req.localBaseUrl;
  testSettings.localModel = req.localModel;
  const enabled = process.env.TA02_AGENT_ENABLED;
  process.env.TA02_AGENT_ENABLED = "1";
  try {
    const decision = await decideTrendBrief({
      campaign, brand: defaultBrand, settings: testSettings,
      llm: createServerTrendRuntime()!, evidenceLines: ["Synthetic fixture only"],
      fallback: { ...answer, claimsAllowed: ["Fallback claim must not appear in a live decision"] },
    });
    assert.equal(decision.trace.path, "live_model");
    assert.equal(decision.decision.priorities[0].confidence, 20);
    assert.deepEqual(decision.decision.claimsAllowed, []);
    pass("server hook preserves low confidence and empty substantiated claims through decision parsing");
  } finally {
    if (enabled === undefined) delete process.env.TA02_AGENT_ENABLED;
    else process.env.TA02_AGENT_ENABLED = enabled;
  }
  responseStatus = 503;
  const unavailable = await livePath.request(req);
  assert.equal(unavailable.status, "error");
  assert.ok(!JSON.stringify(unavailable).includes(secret));
  pass("shared transport failure remains an error, never live success");
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
const old = process.env.LOCAL_LLM_BASE_URL;
delete process.env.LOCAL_LLM_BASE_URL;
try {
  assert.equal((await createTrendAgentRuntime().request(request)).status, "unconfigured");
  pass("missing model connection is reported without an outbound request");
} finally {
  if (old !== undefined) process.env.LOCAL_LLM_BASE_URL = old;
}
console.log(`${checks} checks passed. OFFLINE evidence only, no real LLM used.`);
