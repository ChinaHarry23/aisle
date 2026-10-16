/**
 * Offline checks for agent LLM metering: fake OpenAI, Anthropic and local
 * servers (via OPENAI_API_BASE / ANTHROPIC_API_BASE), a throwaway SQLite
 * accounts file, and no outbound network. No real provider, key or account
 * database is touched.
 *
 *   node --import ./scripts/service-loader.mjs --experimental-strip-types scripts/metering-suite.ts
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(os.tmpdir(), "aisle-metering-"));
process.env.AISLE_DB = "sqlite";
process.env.AISLE_DB_FILE = path.join(dir, "accounts.db");
for (const name of ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "AISLE_DATABASE_URL", "NEON_DATABASE_URL", "STORAGE_URL"]) delete process.env[name];
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
for (const name of ["LOCAL_LLM_BASE_URL", "GOOGLE_AI_API_KEY", "GEMINI_API_KEY", "AISLE_MEDIA_PROVIDERS", "AISLE_DEFAULT_BACKEND"]) delete process.env[name];
// No loopback probing: a real MTPLX/Ollama on this Mac must not answer for the tests.
process.env.LOCAL_LLM_PROBE_URLS = "";

// Only this suite's fake servers are reachable — not a real MTPLX or ComfyUI
// already listening on 127.0.0.1 — so agent tools and stray calls fail.
const realFetch = globalThis.fetch;
const suitePorts = new Set<string>();
let blocked = 0;
/** Every host:port the code under test tried to reach, for the SSRF checks. */
const reached: string[] = [];
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  reached.push(url.host);
  if (url.hostname === "127.0.0.1" && suitePorts.has(url.port)) return realFetch(input, init);
  blocked++;
  return new Response("Offline suite", { status: 503 });
}) as typeof fetch;

type Seen = { path: string; headers: IncomingMessage["headers"]; body: Record<string, unknown> };
async function fakeServer(handle: (req: Seen, res: ServerResponse) => Promise<void> | void) {
  const seen: Seen[] = [];
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString();
    const row = { path: req.url ?? "", headers: req.headers, body: raw ? JSON.parse(raw) : {} };
    seen.push(row);
    res.setHeader("content-type", "application/json");
    await handle(row, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  suitePorts.add(String(address.port));
  return { seen, base: `http://127.0.0.1:${address.port}`, server };
}

/** Cloud behaviour the next calls get. */
let mode: "ok" | "refusal" | "5xx" | "slow" | "hang" = "ok";
/** A valid synthetic artist response, so live-path tests do not rely on canned fallback art. */
function offlineDecision(body: Record<string, unknown>) {
  const prompt = JSON.stringify(body.messages ?? []);
  return prompt.includes('\\"variants\\"') ? JSON.stringify({ variants: ["A", "B"].map(variant => ({ variant, kicker: "Fixture", headline: "Offline product fixture", subhead: "Test only", cta: "Explore", caption: "Test only", prompt: `Offline artist composition ${variant}, product on a plain surface in window light.` })) }) : "{\"ok\":true}";
}
const cloud = await fakeServer(async (req, res) => {
  if (mode === "slow") await new Promise((resolve) => setTimeout(resolve, 150));
  if (mode === "hang") await new Promise((resolve) => setTimeout(resolve, 1200));
  if (mode === "5xx") {
    res.statusCode = 529;
    return void res.end(JSON.stringify({ error: { type: "overloaded_error" } }));
  }
  if (req.path === "/v1/chat/completions") {
    const message = mode === "refusal" ? { content: null, refusal: "I can't help with that." } : { content: offlineDecision(req.body) };
    return void res.end(JSON.stringify({ choices: [{ message, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 500 } }));
  }
  if (req.path === "/v1/messages") {
    if (mode === "refusal") {
      return void res.end(JSON.stringify({ content: [], stop_reason: "refusal", stop_details: { category: "cyber" }, usage: { input_tokens: 1200, output_tokens: 3 } }));
    }
    return void res.end(JSON.stringify({ content: [{ type: "text", text: offlineDecision(req.body) }], stop_reason: "end_turn", usage: { input_tokens: 1200, output_tokens: 800 } }));
  }
  res.statusCode = 404;
  res.end("{}");
});
const local = await fakeServer((req, res) => {
  if (req.path === "/v1/models") return void res.end(JSON.stringify({ data: [{ id: "fake-local" }] }));
  if (req.path === "/v1/chat/completions") {
    return void res.end(JSON.stringify({ choices: [{ message: { content: offlineDecision(req.body) } }], usage: { prompt_tokens: 40, completion_tokens: 8 } }));
  }
  res.statusCode = 404;
  res.end("{}");
});
process.env.OPENAI_API_BASE = `${cloud.base}/v1`;
process.env.ANTHROPIC_API_BASE = `${cloud.base}/v1/`;

const { runComplete, OUT_OF_CREDITS } = await import("../src/lib/llm/complete");
const { allowedLocalBase, LLM_TIMEOUTS } = await import("../src/lib/llm/adapters");
const { DEFAULT_LLM, getLlmModel, getLlmOrDefault, PROVIDER_DEFAULT_MODEL } = await import("../src/lib/llm/catalog");
const { estimateLlmUsage, llmCostUsd, worstCaseUsd } = await import("../src/lib/llm/estimate");
const { UNMETERED_TEST } = await import("../src/lib/billing/meter");
const { adjustCredits, balanceMilli, recentLedger } = await import("../src/lib/billing/ledger");
const { formatCredits, milliForCost, MILLI, PLAN } = await import("../src/lib/billing/plan");
const { getDatabase, closeDatabase } = await import("../src/lib/db");
const { runEngine } = await import("../src/lib/runtime/engine");
const { blankCampaign, defaultBrand } = await import("../src/lib/seed");
const { defaultSettings } = await import("../src/lib/settings");
const { WorkflowRepository } = await import("../services/workflow/repository");
const { workOnce } = await import("../services/workflow/worker");
type BillingContext = import("../src/lib/billing/meter").BillingContext;
type CompleteRequest = import("../src/lib/llm/types").CompleteRequest;
type MediaGeneration = import("../src/lib/media/types").MediaGeneration;
type Campaign = import("../src/lib/types").Campaign;
type Command = import("../src/lib/runtime/types").Command;
type WorkspaceSettings = import("../src/lib/settings").WorkspaceSettings;

let checks = 0;
const pass = (label: string) => { checks++; console.log(`PASS ${label}`); };
const beta = (userId: string): BillingContext => ({ kind: "user", userId, role: "beta" });
const ask = (modelId: string, prompt = "Decide the brief from this evidence."): CompleteRequest => ({ agent: "trend", modelId, prompt });
const cloudCalls = () => cloud.seen.length;
const usageRows = async (userId: string) => (await recentLedger(userId, 200)).filter((row) => row.reason === "usage");
const setBalance = async (userId: string, milli: number) => adjustCredits(userId, milli - (await balanceMilli(userId)), "suite");

try {
  /* ------------------------------------------------ beta pays 2× real usage */
  const free = PLAN.freeCredits * MILLI;
  assert.equal(await balanceMilli("beta-1"), free);
  const gpt = await runComplete(ask("openai:gpt-4.1-mini"), beta("beta-1"));
  assert.equal(gpt.status, "ok", gpt.note);
  assert.equal(gpt.usage.estimate, false);
  // 1000 in × $0.40/M + 500 out × $1.60/M = $0.0012 → ×2 = 0.24 credits = 240 milli.
  assert.equal(gpt.usage.costUsd, 0.0012);
  assert.equal(milliForCost(0.0012), 240);
  assert.equal(await balanceMilli("beta-1"), free - 240);
  const openaiCall = cloud.seen.at(-1)!;
  assert.equal(openaiCall.path, "/v1/chat/completions");
  assert.equal(openaiCall.headers.authorization, "Bearer test-openai-key");
  assert.equal(openaiCall.body.max_completion_tokens, 2000);

  const claude = await runComplete(ask("anthropic:claude-sonnet-5-5"), beta("beta-1"));
  assert.equal(claude.status, "ok", claude.note);
  // 1200 in × $2/M + 800 out × $10/M = $0.0104 → 2,080 milli.
  assert.equal(claude.usage.costUsd, 0.0104);
  assert.equal(await balanceMilli("beta-1"), free - 240 - 2080);
  const anthropicCall = cloud.seen.at(-1)!;
  assert.equal(anthropicCall.path, "/v1/messages");
  assert.equal(anthropicCall.headers["x-api-key"], "test-anthropic-key");
  assert.equal(anthropicCall.headers["anthropic-version"], "2023-06-01");
  assert.deepEqual([anthropicCall.body.max_tokens, anthropicCall.body.output_config], [3000, { effort: "low" }]);
  const charged = await usageRows("beta-1");
  assert.deepEqual(charged.map((row) => row.deltaMilli).sort((a, b) => a - b), [-2080, -240]);
  assert.deepEqual(charged.map((row) => row.modelId).sort(), ["anthropic:claude-sonnet-5-5", "openai:gpt-4.1-mini"]);
  pass("a beta user is charged 2× the provider's reported usage, in milli-credits, with a ledger row per call");

  // An old id resolves to the direct model and is billed at that model's price.
  const legacy = await runComplete(ask("anthropic:claude-haiku-3.5"), beta("beta-1"));
  assert.equal(legacy.modelId, "anthropic:claude-haiku-4-5");
  assert.equal(cloud.seen.at(-1)!.body.model, "claude-haiku-4-5");
  assert.equal("output_config" in cloud.seen.at(-1)!.body, false);
  assert.equal(await balanceMilli("beta-1"), free - 240 - 2080 - milliForCost(0.0012 + 0.004));
  pass("a retired Claude id runs (and bills) as Haiku 4.5, without the 5.x effort setting");

  /* ----------------------------------------------- dev is free but logged */
  const devResult = await runComplete(ask("openai:gpt-4.1-mini"), { kind: "user", userId: "dev-1", role: "dev" });
  assert.equal(devResult.status, "ok", devResult.note);
  const devRows = await recentLedger("dev-1");
  assert.equal(devRows.length, 1);
  assert.deepEqual([devRows[0].reason, devRows[0].deltaMilli, devRows[0].costUsd], ["dev_usage", 0, 0.0012]);
  pass("a dev desk runs cloud models for free, and the real cost is logged at zero");

  /* ------------------------------------------ no billing context: no call */
  const before = cloudCalls();
  const nobody = await runComplete(ask("openai:gpt-4.1-mini"), undefined);
  assert.deepEqual([nobody.status, nobody.note, nobody.usage.costUsd, nobody.usage.totalTokens], ["no_credits", OUT_OF_CREDITS, 0, 0]);
  assert.equal(cloudCalls(), before);
  const unmetered = await runComplete(ask("openai:gpt-4.1-mini"), UNMETERED_TEST);
  assert.equal(unmetered.status, "ok");
  assert.equal(cloudCalls(), before + 1);
  pass("no billing context fails closed with no network call; the unmetered test context runs without a ledger");

  /* ------------------------------------ out of credits: stop or go local */
  await setBalance("broke-1", 0);
  const sent = cloudCalls();
  const broke = await runComplete(ask("anthropic:claude-opus-5-5"), beta("broke-1"));
  assert.deepEqual([broke.status, broke.usage.costUsd], ["no_credits", 0]);
  // The note says what the hold needs against what the user has, not just "out of credits".
  const opusNeeds = formatCredits(milliForCost(worstCaseUsd(getLlmModel("anthropic:claude-opus-5-5"), ask("x"))));
  assert.equal(broke.note, `${OUT_OF_CREDITS}. Opus 5.5 needs ${opusNeeds} credits held per call; you have 0.`);
  assert.equal(cloudCalls(), sent);
  process.env.LOCAL_LLM_PROBE_URLS = `${local.base}/v1`;
  const rerouted = await runComplete(ask("anthropic:claude-opus-5-5"), beta("broke-1"));
  process.env.LOCAL_LLM_PROBE_URLS = "";
  assert.equal(rerouted.status, "ok", rerouted.note);
  assert.deepEqual([rerouted.providerId, rerouted.modelId, rerouted.modelName, rerouted.usage.costUsd], ["local", "local:custom", "fake-local", 0]);
  assert.match(rerouted.note, /Out of credits/);
  assert.equal(cloudCalls(), sent);
  assert.equal(local.seen.filter((row) => row.path === "/v1/chat/completions").at(-1)?.body.model, "fake-local");
  assert.equal(await balanceMilli("broke-1"), 0);
  assert.equal((await usageRows("broke-1")).length, 0);
  pass("insufficient credits return no_credits without calling out, or run free on a local model that answers");

  /* ------------------------------- provider errors cost nothing; refusals are billed */
  await setBalance("careful-1", 40 * MILLI);
  for (const modelId of ["openai:gpt-6-luna", "anthropic:claude-opus-5-5"]) {
    mode = "5xx";
    const calls = cloudCalls();
    const result = await runComplete(ask(modelId), beta("careful-1"));
    assert.equal(result.status, "error", modelId);
    assert.equal(result.usage.costUsd, 0);
    assert.equal(result.note, `HTTP 529 from ${getLlmModel(modelId).provider}`, "the upstream body is not echoed");
    assert.equal(cloudCalls(), calls + 1, "the call did go out");
    assert.equal(await balanceMilli("careful-1"), 40 * MILLI, `5xx ${modelId} released its hold`);
  }
  assert.equal((await usageRows("careful-1")).length, 0);
  pass("a 5xx releases the whole hold, and the note says only the status and provider");

  mode = "refusal";
  // OpenAI reports 1000 in / 500 out: $0.0012 on GPT-4.1 mini. Claude reports 1200 in / 3 out on Sonnet: $0.00243.
  const refusals = [["openai:gpt-4.1-mini", 1000, 500], ["anthropic:claude-sonnet-5-5", 1200, 3]] as const;
  let refusedMilli = 0;
  for (const [modelId, inputTokens, outputTokens] of refusals) {
    const cost = llmCostUsd(getLlmModel(modelId), inputTokens, outputTokens);
    const result = await runComplete(ask(modelId), beta("careful-1"));
    assert.equal(result.status, "error", modelId);
    assert.deepEqual([result.usage.inputTokens, result.usage.outputTokens, result.usage.estimate], [inputTokens, outputTokens, false]);
    assert.equal(result.usage.costUsd, Math.round(cost * 1e5) / 1e5);
    refusedMilli += milliForCost(cost);
    assert.equal(await balanceMilli("careful-1"), 40 * MILLI - refusedMilli, `${modelId} refusal settled at its reported tokens`);
  }
  mode = "ok";
  const refusedRows = await usageRows("careful-1");
  assert.equal(refusedRows.length, 2);
  assert(refusedRows.every((row) => row.note?.includes("(refused)")));
  pass("a refusal (OpenAI or Claude) is settled at the tokens the provider reports, not released");

  /* --------------------------------- a client timeout settles a typical call */
  await setBalance("slowpoke-1", 40 * MILLI);
  const savedTimeouts = { ...LLM_TIMEOUTS };
  LLM_TIMEOUTS.openai = 300;
  mode = "hang";
  const timedOut = await runComplete(ask("openai:gpt-4.1-mini"), beta("slowpoke-1"));
  mode = "ok";
  Object.assign(LLM_TIMEOUTS, savedTimeouts);
  const typical = estimateLlmUsage(getLlmModel("openai:gpt-4.1-mini"), ask("openai:gpt-4.1-mini"));
  assert.equal(timedOut.status, "error");
  assert.match(timedOut.note, /did not answer in time/);
  assert.deepEqual([timedOut.usage.costUsd, timedOut.usage.estimate], [typical.costUsd, true]);
  assert.equal(await balanceMilli("slowpoke-1"), 40 * MILLI - milliForCost(typical.costUsd));
  assert.match((await usageRows("slowpoke-1"))[0]?.note ?? "", /timed out/);
  await new Promise((resolve) => setTimeout(resolve, 1000)); // let the hung reply drain
  pass("a client-side timeout after the request went out settles a typical call instead of releasing");

  /* -------------------- GPT-6.1 Sol is the OpenAI default, and its body is capped */
  assert.equal(DEFAULT_LLM, "openai:gpt-6.1-sol");
  assert.equal(PROVIDER_DEFAULT_MODEL.openai, "openai:gpt-6.1-sol");
  assert.equal(getLlmOrDefault("openai:gpt-9-unknown").id, "openai:gpt-6.1-sol");
  await setBalance("sol-1", 40 * MILLI);
  const sol = await runComplete(ask("openai:gpt-6.1-sol"), beta("sol-1"));
  assert.equal(sol.status, "ok", sol.note);
  const solBody = cloud.seen.at(-1)!.body;
  assert.deepEqual(
    [solBody.model, solBody.max_completion_tokens, solBody.reasoning_effort, "temperature" in solBody, "max_tokens" in solBody],
    ["gpt-6.1-sol", 2000, "low", false, false],
  );
  // 1000 in × $2/M + 500 out × $10/M = $0.007 → 1,400 milli.
  assert.equal(sol.usage.costUsd, 0.007);
  assert.equal(await balanceMilli("sol-1"), 40 * MILLI - 1400);
  const astra = await runComplete(ask("openai:gpt-6-astra"), beta("sol-1"));
  assert.equal(astra.status, "ok", astra.note);
  assert.deepEqual([cloud.seen.at(-1)!.body.model, cloud.seen.at(-1)!.body.reasoning_effort], ["gpt-6-astra", "low"]);
  // 1000 × $10/M + 500 × $50/M = $0.035 → 7,000 milli.
  assert.equal(await balanceMilli("sol-1"), 40 * MILLI - 1400 - 7000);
  pass("GPT-6.1 Sol is the OpenAI default: max_completion_tokens 2000, reasoning_effort low, no temperature, billed at $2/$10");

  /* ------------------------------------ holds are small enough to use a free grant */
  const decisionPrompt = "x".repeat(1000);
  const sonnetHold = milliForCost(worstCaseUsd(getLlmModel("anthropic:claude-sonnet-5-5"), { prompt: decisionPrompt }));
  const opusHold = milliForCost(worstCaseUsd(getLlmModel("anthropic:claude-opus-5-5"), { prompt: decisionPrompt }));
  assert(sonnetHold <= 7 * MILLI, `Sonnet hold ${sonnetHold}`);
  assert(opusHold <= 13 * MILLI, `Opus hold ${opusHold}`);
  // One token per UTF-16 unit, so a CJK or emoji prompt cannot be held at a third of its cost.
  const sonnet = getLlmModel("anthropic:claude-sonnet-5-5");
  assert.equal(worstCaseUsd(sonnet, { prompt: "字".repeat(3000) }), llmCostUsd(sonnet, 3160, 3000));
  await setBalance("frugal-1", 9 * MILLI);
  const frugal = await runComplete(ask("anthropic:claude-sonnet-5-5"), beta("frugal-1"));
  assert.equal(frugal.status, "ok", "9 credits still cover a Sonnet decision");
  await setBalance("frugal-2", 5 * MILLI);
  const short = await runComplete(ask("anthropic:claude-opus-5-5"), beta("frugal-2"));
  assert.equal(short.status, "no_credits");
  assert.match(short.note, /^Out of credits — subscribe on Billing\. Opus 5\.5 needs 12(\.\d)? credits held per call; you have 5\.$/);
  pass(`Claude decisions hold ${sonnetHold / MILLI} (Sonnet) / ${opusHold / MILLI} (Opus) credits, and a failed hold says needed vs available`);

  /* ------------------------------ SSRF: a user's local URL cannot aim the server */
  // An "internal service" on loopback that answers with something private.
  const internal = await fakeServer((req, res) => {
    if (req.path === "/v1/chat/completions") {
      res.statusCode = 500;
      return void res.end("SECRET-INTERNAL-BODY");
    }
    if (req.path === "/redirect/v1/chat/completions") {
      res.statusCode = 302;
      res.setHeader("location", `${local.base}/v1/chat/completions`);
      return void res.end();
    }
    res.statusCode = 404;
    res.end("SECRET-INTERNAL-BODY");
  });
  try {
    const custom = (localBaseUrl: string): CompleteRequest => ({ agent: "trend", modelId: "local:custom", prompt: "x", localBaseUrl, localModel: "m" });
    const port = new URL(internal.base).port;
    for (const bad of ["http://169.254.169.254/latest?", "http://10.0.0.7:8080/v1", "http://metadata.google.internal/v1", "file:///etc/passwd", "gopher://127.0.0.1:6379/", `http://user:pw@127.0.0.1:${port}/v1`, `http://127.0.0.1:${port}/v1?x=1`, "http://127.0.0.1.nip.io/v1", "not a url"]) {
      assert.equal(allowedLocalBase(bad), null, bad);
      const before = reached.length;
      const result = await runComplete(custom(bad), beta("ssrf-1"));
      assert.equal(result.status, "unconfigured", bad);
      assert.deepEqual(reached.slice(before), [], `${bad} was never fetched`);
    }
    assert.equal(allowedLocalBase(` ${internal.base}/v1/ `), `${internal.base}/v1`);
    assert.equal(allowedLocalBase("http://localhost:11434/v1"), "http://localhost:11434/v1");
    assert.equal(allowedLocalBase("http://[::1]:1234/v1"), "http://[::1]:1234/v1");

    // Locally a loopback URL is allowed, but its body never comes back and redirects are refused.
    const echoed = await runComplete(custom(`${internal.base}/v1`), beta("ssrf-1"));
    assert.equal(echoed.status, "error");
    assert.equal(echoed.note, "HTTP 500 from Local");
    assert(!JSON.stringify(echoed).includes("SECRET"), "the upstream body stays in the server log");
    const localChats = local.seen.length;
    const redirected = await runComplete(custom(`${internal.base}/redirect/v1`), beta("ssrf-1"));
    assert.equal(redirected.status, "error");
    assert.equal(local.seen.length, localChats, "the redirect target was not followed");

    // Hosted: only the server's own LOCAL_LLM_BASE_URL / probe list, never the user's URL.
    process.env.VERCEL = "1";
    const internalHits = internal.seen.length;
    assert.equal(allowedLocalBase(`${internal.base}/v1`), null);
    const hostedNone = await runComplete(custom(`${internal.base}/v1`), beta("ssrf-1"));
    assert.equal(hostedNone.status, "unconfigured");
    process.env.LOCAL_LLM_BASE_URL = `${local.base}/v1`;
    assert.equal(allowedLocalBase(`${local.base}/v1/`), `${local.base}/v1`);
    const hostedOwn = await runComplete(custom(`${internal.base}/v1`), beta("ssrf-1"));
    assert.equal(hostedOwn.status, "ok", hostedOwn.note);
    // A cloud seat out of credits reroutes only to configured local servers.
    await setBalance("ssrf-2", 0);
    const rerouteHosted = await runComplete({ ...ask("anthropic:claude-opus-5-5"), localBaseUrl: `${internal.base}/v1` }, beta("ssrf-2"));
    assert.equal(rerouteHosted.providerId, "local");
    assert.equal(internal.seen.length, internalHits, "the internal service was never called while hosted");
    delete process.env.LOCAL_LLM_BASE_URL;
    delete process.env.VERCEL;
    pass("SSRF: non-loopback, credentialed and odd-scheme local URLs are never fetched; bodies and redirects stay server-side; hosted ignores user URLs");
  } finally {
    delete process.env.LOCAL_LLM_BASE_URL;
    delete process.env.VERCEL;
    internal.server.close();
  }

  /* ----------------------------------------------- concurrency cannot overdraw */
  const prompt = "Burst decision.";
  const hold = milliForCost(worstCaseUsd(getLlmModel("openai:gpt-4.1-mini"), { prompt }));
  await setBalance("burst-1", hold * 3 + Math.floor(hold / 2));
  mode = "slow";
  const calls = cloudCalls();
  let lowest = Infinity;
  let watching = true;
  const watch = (async () => {
    while (watching) {
      lowest = Math.min(lowest, await balanceMilli("burst-1"));
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  })();
  const burst = await Promise.all(Array.from({ length: 8 }, () => runComplete(ask("openai:gpt-4.1-mini", prompt), beta("burst-1"))));
  watching = false;
  await watch;
  mode = "ok";
  const ok = burst.filter((r) => r.status === "ok").length;
  assert.equal(ok, 3, "only as many calls as the balance can hold go out");
  assert.equal(burst.filter((r) => r.status === "no_credits").length, 5);
  assert.equal(cloudCalls(), calls + 3);
  assert(lowest >= 0, `balance dipped to ${lowest}`);
  assert(lowest < hold, "the worst case really was held while the calls were in flight");
  assert.equal(await balanceMilli("burst-1"), hold * 3 + Math.floor(hold / 2) - 3 * 240);
  pass(`8 concurrent calls against 3.5 holds: 3 go out, 5 stop, the balance never goes below zero (hold ${hold} milli)`);

  /* ---------------------------------------------- the engine threads billing */
  const cloudSettings = (modelId: string): WorkspaceSettings => {
    const settings = defaultSettings();
    for (const slot of ["trend", "creative", "compliance", "media"] as const) settings.agents[slot] = { provider: getLlmModel(modelId).providerId, modelId };
    return settings;
  };
  let renders = 0;
  const stubPoster = async ({ modelId }: { modelId: string }): Promise<MediaGeneration> => {
    renders++;
    return { kind: "image", modelId, provider: "stub", modelName: "stub", status: "stubbed", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, units: 1, unitLabel: "image", costUsd: 0.04, billedAs: "stub", latencyMs: 0, estimate: true }, url: null, note: "suite", at: new Date().toISOString() };
  };
  const input = { name: "Metered run", product: "Cold-pressed olive oil", category: "Pantry", targetAudience: "Australian home cooks", objective: "Increase store visits", budget: 3000, channels: ["web", "email"], startDate: "2026-10-01", endDate: "2026-10-15", country: "AU", notes: "Metering suite" } as const;
  async function drive(settings: WorkspaceSettings, billing: BillingContext | undefined, patch: Partial<Campaign> = {}) {
    let campaign: Campaign = { ...blankCampaign({ ...input, channels: [...input.channels] }, defaultBrand, null, settings), ...patch };
    const run = async (command: Command) => {
      const result = await runEngine({ campaigns: [campaign], now: new Date().toISOString() }, campaign, command, settings, defaultBrand, { billing, renderPoster: stubPoster, maxSteps: 20 });
      campaign = result.campaign;
      return result;
    };
    let result = await run({ type: "START", actor: "founder" });
    for (let i = 0; i < 6 && (result.canAdvance || campaign.run?.status === "running"); i++) result = await run({ type: "ADVANCE", actor: "founder" });
    return campaign;
  }
  const insights = (c: Campaign) => c.log.filter((e) => e.kind === "insight" && / · /.test(e.title));

  await setBalance("engine-1", 20 * MILLI);
  const paid = await drive(cloudSettings("openai:gpt-4.1-mini"), beta("engine-1"));
  const paidRows = await usageRows("engine-1");
  assert(paidRows.length >= 3, "each live decision is a ledger row");
  assert(paid.spend.inferenceUsd > 0);
  assert.equal(Math.round(paid.spend.inferenceUsd * 1e5), Math.round(paidRows.reduce((n, row) => n + (row.costUsd ?? 0), 0) * 1e5));
  assert.equal(paid.spend.mediaUsd, 0, "stubbed posters are not booked as spend");
  assert(insights(paid).every((e) => e.title.endsWith("GPT-4.1 mini")));
  pass("inline engine runs bill each decision to the user, and campaign spend matches the ledger");

  await setBalance("engine-2", 0);
  const beforeUnpaidRenders = renders;
  const unpaid = await drive(cloudSettings("anthropic:claude-opus-5-5"), beta("engine-2"));
  assert.equal(unpaid.spend.inferenceUsd, 0);
  assert(insights(unpaid).length >= 2);
  assert.equal(unpaid.status, "paused", "production artwork stops when no creative model answers");
  assert.equal(renders, beforeUnpaidRenders, "out-of-credits fallback cannot render canned artwork");
  assert(insights(unpaid).every((e) => e.detail.includes("Out of credits — subscribe on Billing") && e.detail.includes("Deterministic rules")));
  process.env.LOCAL_LLM_PROBE_URLS = `${local.base}/v1`;
  const local2 = await drive(cloudSettings("anthropic:claude-opus-5-5"), beta("engine-2"));
  process.env.LOCAL_LLM_PROBE_URLS = "";
  assert(insights(local2).every((e) => e.title.endsWith("fake-local") && !e.title.includes("Opus")), "the trace names the model that actually ran");
  assert.equal(local2.spend.inferenceUsd, 0);
  assert.equal(await balanceMilli("engine-2"), 0);
  pass("out of credits, the engine says so in the trace and books nothing; a local reroute is labelled as local");

  // A route with a time limit stops starting steps once its budget is spent; the client advances again.
  {
    const settings = cloudSettings("openai:gpt-4.1-mini");
    let campaign: Campaign = blankCampaign({ ...input, channels: [...input.channels] }, defaultBrand, null, settings);
    const opts = { billing: UNMETERED_TEST, renderPoster: stubPoster };
    campaign = (await runEngine({ campaigns: [campaign], now: new Date().toISOString() }, campaign, { type: "START", actor: "founder" }, settings, defaultBrand, { ...opts, maxSteps: 0 })).campaign;
    const before = campaign.run?.stepsTaken ?? 0;
    const late = await runEngine({ campaigns: [campaign], now: new Date().toISOString() }, campaign, { type: "ADVANCE", actor: "founder" }, settings, defaultBrand, { ...opts, maxSteps: 12, stepDeadline: Date.now() - 1 });
    assert.equal(late.run.stepsTaken - before, 1, "past the deadline, exactly one step runs");
    assert.equal(late.canAdvance, true, "and the client is told to advance again");
  }
  pass("the engine starts no further step after its time budget, so /api/engine returns inside maxDuration");

  // The poster spend guard runs on the quote, before anything renders.
  renders = 0;
  const posterSettings = { ...cloudSettings("openai:gpt-4.1-mini"), imageModelId: "openai:gpt-image-2" };
  const capped = await drive(posterSettings, UNMETERED_TEST, { spendCapUsd: 0.01 });
  assert.equal(renders, 0, "a blocked step renders nothing");
  assert(capped.policyDecisions.some((d) => d.action === "SPEND_MEDIA" && d.verdict === "block"));
  assert(capped.log.some((e) => e.title === "Media spend blocked"));
  pass("the poster spend cap is checked against the quote before rendering, so a blocked step spends nothing");

  /* ------------------------------------ the worker looks the payer up itself */
  const db = await getDatabase();
  const at = new Date().toISOString();
  await db.execute("insert into users (id, email, name, role, password_hash, created_at) values ($1, $2, $3, $4, $5, $6)", ["worker-beta", "worker-beta@example.test", "Worker Beta", "beta", "x", at]);
  const repo = new WorkflowRepository(path.join(dir, "workflow.db"));
  try {
    const settings = cloudSettings("openai:gpt-4.1-mini");
    const workCampaign = blankCampaign({ ...input, channels: [...input.channels] }, defaultBrand, null, settings);
    const job = repo.enqueue("worker-beta", "metered-1", { campaign: workCampaign, campaigns: [], brand: defaultBrand, settings, command: { type: "START", actor: "founder" } });
    await workOnce(repo, "metering-worker", { renderPoster: stubPoster });
    assert.equal(repo.get("worker-beta", job.id).status, "completed");
    assert((await usageRows("worker-beta")).length >= 3, "worker decisions are billed to the job's user");

    const ghostCampaign = { ...structuredClone(workCampaign), id: "ghost-campaign" };
    const calls = cloudCalls();
    repo.enqueue("ghost", "ghost-1", { campaign: ghostCampaign, campaigns: [], brand: defaultBrand, settings, command: { type: "START", actor: "founder" } });
    await workOnce(repo, "metering-worker", { renderPoster: stubPoster });
    assert.equal(cloudCalls(), calls, "an unknown user cannot spend the platform keys");
    pass("the workflow worker bills the job's user from the accounts DB, and fails closed for an unknown user");

    // Hosted: a dev desk is billed like anyone else unless AISLE_UNLIMITED_USERS lists it (by email here).
    await db.execute("insert into users (id, email, name, role, password_hash, created_at) values ($1, $2, $3, $4, $5, $6)", ["worker-dev", "Desk@Example.test", "Worker Dev", "dev", "x", at]);
    await setBalance("worker-dev", 40 * MILLI);
    process.env.VERCEL = "1";
    delete process.env.AISLE_UNLIMITED_USERS;
    try {
      repo.enqueue("worker-dev", "dev-1", { campaign: { ...structuredClone(workCampaign), id: "dev-campaign-1" }, campaigns: [], brand: defaultBrand, settings, command: { type: "START", actor: "founder" } });
      await workOnce(repo, "metering-worker", { renderPoster: stubPoster });
      const paidDev = await recentLedger("worker-dev", 200);
      assert(paidDev.filter((row) => row.reason === "usage").length >= 3, "a hosted dev desk not on the list pays credits");
      assert.equal(paidDev.filter((row) => row.reason === "dev_usage").length, 0);
      process.env.AISLE_UNLIMITED_USERS = "someone@else.test, desk@example.test";
      const spent = await balanceMilli("worker-dev");
      repo.enqueue("worker-dev", "dev-2", { campaign: { ...structuredClone(workCampaign), id: "dev-campaign-2" }, campaigns: [], brand: defaultBrand, settings, command: { type: "START", actor: "founder" } });
      await workOnce(repo, "metering-worker", { renderPoster: stubPoster });
      assert.equal(await balanceMilli("worker-dev"), spent, "listed by email: unlimited");
      assert((await recentLedger("worker-dev", 200)).some((row) => row.reason === "dev_usage"));
    } finally {
      delete process.env.VERCEL;
      delete process.env.AISLE_UNLIMITED_USERS;
    }
    pass("the worker applies the hosted unlimited list to the DB user's id or email");
  } finally {
    repo.close();
  }

  assert(blocked > 0, "agent tools tried the network and were refused");
  console.log(`\n${checks} metering checks passed. ${blocked} outbound calls blocked. Test-only database: ${process.env.AISLE_DB_FILE}`);
} finally {
  globalThis.fetch = realFetch;
  cloud.server.close();
  local.server.close();
  await closeDatabase();
  if (!process.env.KEEP_METERING_DB) rmSync(dir, { recursive: true, force: true });
}
