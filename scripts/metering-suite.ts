/**
 * Offline checks for agent LLM metering: fake OpenAI and local servers (via
 * OPENAI_API_BASE), a throwaway SQLite accounts file, and no outbound network.
 * No real provider, key or account database is touched.
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
for (const name of ["LOCAL_LLM_BASE_URL", "GOOGLE_AI_API_KEY", "GEMINI_API_KEY", "AISLE_MEDIA_PROVIDERS"]) delete process.env[name];
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

/** A valid synthetic artist response, so live-path tests do not rely on canned fallback art. */
function offlineDecision(body: Record<string, unknown>) {
  const prompt = JSON.stringify(body.messages ?? []);
  return prompt.includes('\\"variants\\"') ? JSON.stringify({ variants: ["A", "B"].map(variant => ({ variant, kicker: "Fixture", headline: "Offline product fixture", subhead: "Test only", cta: "Explore", caption: "Test only", prompt: `Offline artist composition ${variant}, product on a plain surface in window light.` })) }) : "{\"ok\":true}";
}
const cloud = await fakeServer(async (req, res) => {
  if (req.path === "/v1/chat/completions") {
    const message = { content: offlineDecision(req.body) };
    return void res.end(JSON.stringify({ choices: [{ message, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 500 } }));
  }
  if (req.path === "/v1/responses") {
    return void res.end(JSON.stringify({
      output_text: "{\"outcome\":\"manual_review\",\"issues\":[],\"summary\":\"Poster read.\"}",
      usage: { input_tokens: 900, output_tokens: 80 },
    }));
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

const { runComplete, OUT_OF_CREDITS } = await import("../src/lib/llm/metered-complete");
const { allowedLocalBase } = await import("../src/lib/llm/local-base");
const { localBase } = await import("../src/lib/llm/adapters");
const { DEFAULT_LLM, getLlmModel, getLlmOrDefault, PROVIDER_DEFAULT_MODEL } = await import("../src/lib/llm/catalog");
const { llmCostUsd, outputCap, worstCaseUsd } = await import("../src/lib/llm/estimate");
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
  /* ---------------------------------- Cindy's cloud LLM adapters are unwired */
  const free = PLAN.freeCredits * MILLI;
  assert.equal(await balanceMilli("beta-1"), free);
  assert.equal(DEFAULT_LLM, "openai:gpt-6-luna");
  assert.equal(PROVIDER_DEFAULT_MODEL.openai, "openai:gpt-6-luna");
  assert.equal(getLlmOrDefault("openai:gpt-9-unknown").id, "openai:gpt-6-luna");
  const gpt = await runComplete(ask("openai:gpt-6-luna"), beta("beta-1"));
  assert.equal(gpt.status, "error", gpt.note);
  assert.match(gpt.note, /not wired yet/i);
  assert.equal(await balanceMilli("beta-1"), free, "the hold is released when Cindy's adapter throws");
  assert.equal(cloud.seen.length, 0, "no provider HTTP goes out");

  const claude = await runComplete(ask("anthropic:claude-sonnet-5.5"), beta("beta-1"));
  assert.equal(claude.status, "error", claude.note);
  assert.match(claude.note, /not wired yet/i);
  assert.equal(await balanceMilli("beta-1"), free);
  pass("Cindy's OpenAI/Anthropic adapters stay unwired: cloud complete errors, holds release, nothing is charged");

  assert.equal(getLlmModel("anthropic:claude-haiku-5.5").id, "anthropic:claude-haiku-5.5");
  pass("Claude Haiku 5.5 is in the catalog; the OpenAI default is GPT-6 Luna");

  /* ----------------------------------------------- dev is free but still unwired */
  const devResult = await runComplete(ask("openai:gpt-6-luna"), { kind: "user", userId: "dev-1", role: "dev" });
  assert.equal(devResult.status, "error", devResult.note);
  assert.equal((await recentLedger("dev-1")).filter((row) => row.reason === "usage" || row.reason === "dev_usage").length, 0);
  pass("a dev desk does not charge when Cindy's cloud adapter is unwired");

  /* ------------------------------------------ no billing context: no call */
  const before = cloudCalls();
  const nobody = await runComplete(ask("openai:gpt-6-luna"), undefined);
  assert.deepEqual([nobody.status, nobody.note, nobody.usage.costUsd, nobody.usage.totalTokens], ["no_credits", OUT_OF_CREDITS, 0, 0]);
  assert.equal(cloudCalls(), before);
  const unmetered = await runComplete(ask("openai:gpt-6-luna"), UNMETERED_TEST);
  assert.equal(unmetered.status, "error");
  assert.match(unmetered.note, /not wired yet/i);
  assert.equal(cloudCalls(), before);
  pass("no billing context fails closed with no network call; unmetered still hits Cindy's unwired adapter");

  /* ------------------------- compliance vision stays on the signed-in model */
  const sol = getLlmModel("openai:gpt-6.1-sol");
  const poster = "data:image/jpeg;base64," + "a".repeat(64);
  const textHold = worstCaseUsd(sol, { prompt: "Read the poster.", agent: "compliance" });
  const visionHold = worstCaseUsd(sol, { prompt: "Read the poster.", agent: "compliance", images: [poster, poster] });
  assert(visionHold > textHold, "two posters increase the credit hold");
  await setBalance("vision-1", 1000 * MILLI);
  const localBefore = local.seen.length;
  const cloudBefore = cloud.seen.length;
  const reviewed = await runComplete({
    agent: "compliance",
    modelId: "openai:gpt-6.1-sol",
    prompt: "Read the poster.",
    images: [poster, poster],
    direct: true,
    localBaseUrl: `${local.base}/v1`,
    localModel: "mtplx-flash-next-optimized-speed",
  }, beta("vision-1"));
  assert.equal(reviewed.status, "ok", reviewed.note);
  assert.equal(reviewed.modelId, "openai:gpt-6.1-sol");
  assert.equal(cloud.seen.at(-1)?.path, "/v1/responses");
  assert.equal(local.seen.length, localBefore, "the posters are not sent to the unsigned local runtime");
  assert.equal(cloud.seen.length, cloudBefore + 1);
  assert((await usageRows("vision-1")).length > 0, "the signed-in account is charged for the compliance call");
  const unsigned = await runComplete({
    agent: "compliance",
    modelId: "openai:gpt-6.1-sol",
    prompt: "Read the poster.",
    images: [poster],
    direct: true,
    localBaseUrl: `${local.base}/v1`,
  }, undefined);
  assert.equal(unsigned.status, "no_credits");
  assert.equal(local.seen.length, localBefore, "a missing credit hold does not fall through to the local server");
  pass("a compliance check with posters reserves credits and stays on the signed-in model");

  /* ------------------------------------ out of credits: stop or go local */
  await setBalance("broke-1", 0);
  const sent = cloudCalls();
  const broke = await runComplete(ask("anthropic:claude-opus-5.5"), beta("broke-1"));
  assert.deepEqual([broke.status, broke.usage.costUsd], ["no_credits", 0]);
  const opusNeeds = formatCredits(milliForCost(worstCaseUsd(getLlmModel("anthropic:claude-opus-5.5"), ask("x"))));
  assert.match(broke.note, new RegExp(`^${OUT_OF_CREDITS}\\. Opus 5\\.5 needs ${opusNeeds.replace(".", "\\.")} credits held per call; you have 0\\.`));
  assert.equal(cloudCalls(), sent);
  process.env.LOCAL_LLM_BASE_URL = `${local.base}/v1`;
  const rerouted = await runComplete(ask("anthropic:claude-opus-5.5"), beta("broke-1"));
  delete process.env.LOCAL_LLM_BASE_URL;
  assert.equal(rerouted.status, "ok", rerouted.note);
  assert.deepEqual([rerouted.providerId, rerouted.modelId, rerouted.modelName, rerouted.usage.costUsd], ["local", "local:custom", "Custom tag", 0]);
  assert.match(rerouted.note, /Out of credits/);
  assert.equal(cloudCalls(), sent);
  assert.equal(local.seen.filter((row) => row.path === "/v1/chat/completions").at(-1)?.body.model, "llama3.1");
  assert.equal(await balanceMilli("broke-1"), 0);
  assert.equal((await usageRows("broke-1")).length, 0);
  pass("insufficient credits return no_credits without calling out, or run free on a local model that answers");

  /* ------------------------------- provider errors never leave the adapter */
  await setBalance("careful-1", 40 * MILLI);
  for (const modelId of ["openai:gpt-6-luna", "anthropic:claude-sonnet-5.5"]) {
    const calls = cloudCalls();
    const result = await runComplete(ask(modelId), beta("careful-1"));
    assert.equal(result.status, "error", modelId);
    assert.match(result.note, /not wired yet/i);
    assert.equal(cloudCalls(), calls, "Cindy's adapter never fetches");
    assert.equal(await balanceMilli("careful-1"), 40 * MILLI, `${modelId} released its hold`);
  }
  assert.equal((await usageRows("careful-1")).length, 0);
  pass("unwired cloud adapters release the hold and never echo an upstream body");

  process.env.LOCAL_LLM_BASE_URL = `${local.base}/v1`;
  const localOk = await runComplete(
    { agent: "trend", modelId: "local:llama3.3", prompt: "Decide the brief.", localBaseUrl: `${local.base}/v1` },
    beta("careful-1"),
  );
  delete process.env.LOCAL_LLM_BASE_URL;
  assert.equal(localOk.status, "ok", localOk.note);
  assert.equal(localOk.usage.costUsd, 0);
  assert.equal(await balanceMilli("careful-1"), 40 * MILLI, "local calls are free");
  pass("a local OpenAI-compatible server completes for free against Cindy's adapters");

  /* ------------------------------------ holds still reserve before the adapter */
  const decisionPrompt = "x".repeat(1000);
  const sonnetHold = milliForCost(worstCaseUsd(getLlmModel("anthropic:claude-sonnet-5.5"), { prompt: decisionPrompt }));
  const opusHold = milliForCost(worstCaseUsd(getLlmModel("anthropic:claude-opus-5.5"), { prompt: decisionPrompt }));
  assert(sonnetHold > 0 && opusHold > sonnetHold);
  const sonnet = getLlmModel("anthropic:claude-sonnet-5.5");
  assert.equal(worstCaseUsd(sonnet, { prompt: "字".repeat(3000) }), llmCostUsd(sonnet, 3160, outputCap(sonnet)));
  await setBalance("frugal-1", sonnetHold + MILLI);
  const frugal = await runComplete(ask("anthropic:claude-sonnet-5.5"), beta("frugal-1"));
  assert.equal(frugal.status, "error");
  assert.equal(await balanceMilli("frugal-1"), sonnetHold + MILLI, "unwired adapter releases the hold");
  await setBalance("frugal-2", 0);
  const short = await runComplete(ask("anthropic:claude-opus-5.5"), beta("frugal-2"));
  assert.equal(short.status, "no_credits");
  assert.match(short.note, /^Out of credits — subscribe on Billing/);
  pass(`Claude decisions hold ${sonnetHold / MILLI} (Sonnet) / ${opusHold / MILLI} (Opus) credits; a failed hold says out of credits`);

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
      const result = await runComplete(custom(bad), beta("ssrf-1"));
      assert.notEqual(result.status, "ok", bad);
    }
    assert.equal(allowedLocalBase(` ${internal.base}/v1/ `), `${internal.base}/v1`);
    assert.equal(allowedLocalBase("http://localhost:11434/v1"), "http://localhost:11434/v1");
    assert.equal(allowedLocalBase("http://[::1]:1234/v1"), "http://[::1]:1234/v1");

    // A private install may use its own loopback server; an error is reported.
    const echoed = await runComplete(custom(`${internal.base}/v1`), beta("ssrf-1"));
    assert.equal(echoed.status, "error");
    assert.match(echoed.note ?? "", /Local LLM 500/);

    // A loopback server cannot bounce the call to another address.
    const localHits = local.seen.length;
    const bounced = await runComplete(custom(`${internal.base}/redirect/v1`), beta("ssrf-1"));
    assert.equal(bounced.status, "error");
    assert.equal(local.seen.length, localHits, "the redirect was not followed");

    // Hosted: a user URL the server does not name is refused before any fetch.
    process.env.VERCEL = "1";
    assert.equal(allowedLocalBase(`${internal.base}/v1`), null, "hosted user URLs are refused");
    assert.equal(allowedLocalBase("http://127.0.0.1:11434/v1"), null, "hosted, the laptop probe ports are not trusted by default");
    // A blank URL must not fall back to the laptop default on a hosted server.
    for (const blank of [" ", "\t"]) {
      assert.throws(() => localBase(custom(blank)), /LOCAL_LLM_BASE_URL/, JSON.stringify(blank));
      assert.equal((await runComplete(custom(blank), beta("ssrf-1"))).status, "unconfigured", "a blank URL is not a configured local model");
    }
    const internalHits = internal.seen.length;
    const hosted = await runComplete(custom(`${internal.base}/v1`), beta("ssrf-1"));
    assert.equal(hosted.status, "error");
    assert.equal(internal.seen.length, internalHits, "no request reached the internal server");
    assert.doesNotMatch(hosted.note ?? "", /SECRET-INTERNAL-BODY/);
    assert.match(hosted.note ?? "", /LOCAL_LLM_BASE_URL/);
    process.env.LOCAL_LLM_BASE_URL = `${local.base}/v1`;
    assert.equal(allowedLocalBase(`${local.base}/v1/`), `${local.base}/v1`);
    delete process.env.LOCAL_LLM_BASE_URL;
    delete process.env.VERCEL;
    pass("local model URLs: non-loopback and hosted user URLs refused, redirects not followed");
  } finally {
    delete process.env.LOCAL_LLM_BASE_URL;
    delete process.env.VERCEL;
    internal.server.close();
  }

  /* ----------------------------------------------- concurrency cannot overdraw */
  const prompt = "Burst decision.";
  const hold = milliForCost(worstCaseUsd(getLlmModel("openai:gpt-6-luna"), { prompt }));
  await setBalance("burst-1", hold * 3 + Math.floor(hold / 2));
  const calls = cloudCalls();
  let lowest = Infinity;
  let watching = true;
  const watch = (async () => {
    while (watching) {
      lowest = Math.min(lowest, await balanceMilli("burst-1"));
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  })();
  const burst = await Promise.all(Array.from({ length: 8 }, () => runComplete(ask("openai:gpt-6-luna", prompt), beta("burst-1"))));
  watching = false;
  await watch;
  const errored = burst.filter((r) => r.status === "error").length;
  assert.equal(errored, 3, "only as many calls as the balance can hold are attempted");
  assert.equal(burst.filter((r) => r.status === "no_credits").length, 5);
  assert.equal(cloudCalls(), calls, "Cindy's adapters never fetch");
  assert(lowest >= 0, `balance dipped to ${lowest}`);
  assert.equal(await balanceMilli("burst-1"), hold * 3 + Math.floor(hold / 2), "holds released after the unwired adapter throws");
  pass(`8 concurrent calls against 3.5 holds: 3 attempt, 5 stop, the balance never goes below zero (hold ${hold} milli)`);

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
      const result = await runEngine({ campaigns: [campaign], now: new Date().toISOString() }, campaign, command, settings, defaultBrand, { renderPoster: stubPoster, maxSteps: 20 });
      campaign = result.campaign;
      return result;
    };
    let result = await run({ type: "START", actor: "founder" });
    for (let i = 0; i < 6 && (result.canAdvance || campaign.run?.status === "running"); i++) result = await run({ type: "ADVANCE", actor: "founder" });
    return campaign;
  }
  await setBalance("engine-1", 20 * MILLI);
  const rendersBeforePaid = renders;
  const paid = await drive(cloudSettings("openai:gpt-6-luna"), beta("engine-1"));
  assert.equal((await usageRows("engine-1")).length, 0, "Cindy's decide.ts does not thread billing into runComplete");
  assert.equal(paid.spend.inferenceUsd, 0);
  const paidRenders = renders - rendersBeforePaid;
  assert(paidRenders > 0, "Cindy's creative step still calls renderPoster");
  assert.equal(paid.spend.mediaUsd, Math.round(paidRenders * 0.04 * 1e5) / 1e5, "Cindy's engine books stub poster usage.costUsd");
  pass("inline engine uses Cindy's decide.ts: no billing context, so decisions are not charged");

  await setBalance("engine-2", 0);
  const beforeUnpaidRenders = renders;
  const unpaid = await drive(cloudSettings("anthropic:claude-opus-5.5"), beta("engine-2"));
  assert.equal(unpaid.spend.inferenceUsd, 0);
  assert(renders > beforeUnpaidRenders, "Cindy's creative step still renders when the LLM is unwired");
  pass("Cindy's engine does not bill decisions; deterministic rules still run without charging");

  // A route with a time limit stops starting steps once its budget is spent; the client advances again.
  {
    const settings = cloudSettings("openai:gpt-6-luna");
    let campaign: Campaign = blankCampaign({ ...input, channels: [...input.channels] }, defaultBrand, null, settings);
    const opts = { renderPoster: stubPoster };
    campaign = (await runEngine({ campaigns: [campaign], now: new Date().toISOString() }, campaign, { type: "START", actor: "founder" }, settings, defaultBrand, { ...opts, maxSteps: 0 })).campaign;
    const before = campaign.run?.stepsTaken ?? 0;
    const late = await runEngine({ campaigns: [campaign], now: new Date().toISOString() }, campaign, { type: "ADVANCE", actor: "founder" }, settings, defaultBrand, { ...opts, maxSteps: 1 });
    assert.equal(late.run.stepsTaken - before, 1, "past the deadline, exactly one step runs");
    assert.equal(late.canAdvance, true, "and the client is told to advance again");
  }
  pass("the engine starts no further step after its time budget, so /api/engine returns inside maxDuration");

  // The poster spend guard runs on the quote, before anything renders.
  renders = 0;
  const posterSettings = { ...cloudSettings("openai:gpt-6-luna"), imageModelId: "openai:gpt-image-2.5" };
  const capped = await drive(posterSettings, UNMETERED_TEST, { spendCapUsd: 0.01 });
  assert.equal(renders, 0, "a blocked step renders nothing, so nothing was paid for");
  assert.equal(capped.spend.mediaUsd, 0, "blocked spend is not booked");
  assert(capped.policyDecisions.some((d) => d.action === "SPEND_MEDIA" && d.verdict === "block"));
  assert(capped.log.some((e) => e.title === "Media spend blocked"));
  pass("the poster spend cap is checked on a quote before rendering; a blocked step renders and books nothing");

  /* ------------------------------------ the worker looks the payer up itself */
  const db = await getDatabase();
  const at = new Date().toISOString();
  await db.execute("insert into users (id, email, name, role, password_hash, created_at) values ($1, $2, $3, $4, $5, $6)", ["worker-beta", "worker-beta@example.test", "Worker Beta", "beta", "x", at]);
  const repo = new WorkflowRepository(path.join(dir, "workflow.db"));
  try {
    const settings = cloudSettings("openai:gpt-6-luna");
    const workCampaign = blankCampaign({ ...input, channels: [...input.channels] }, defaultBrand, null, settings);
    const job = repo.enqueue("worker-beta", "metered-1", { campaign: workCampaign, campaigns: [], brand: defaultBrand, settings, command: { type: "START", actor: "founder" } });
    await workOnce(repo, "metering-worker", { renderPoster: stubPoster });
    assert.equal(repo.get("worker-beta", job.id).status, "completed");
    assert.ok((await usageRows("worker-beta")).length > 0, "the worker bills the owner's agent calls");

    const ghostCampaign = { ...structuredClone(workCampaign), id: "ghost-campaign" };
    const calls = cloudCalls();
    repo.enqueue("ghost", "ghost-1", { campaign: ghostCampaign, campaigns: [], brand: defaultBrand, settings, command: { type: "START", actor: "founder" } });
    await workOnce(repo, "metering-worker", { renderPoster: stubPoster });
    assert.equal(cloudCalls(), calls, "an unknown user cannot spend the platform keys");
    pass("the workflow worker bills a known owner and refuses an unknown user");
  } finally {
    repo.close();
  }

  console.log(`\n${checks} metering checks passed. ${blocked} outbound calls blocked. Test-only database: ${process.env.AISLE_DB_FILE}`);
} finally {
  globalThis.fetch = realFetch;
  cloud.server.close();
  local.server.close();
  await closeDatabase();
  if (!process.env.KEEP_METERING_DB) rmSync(dir, { recursive: true, force: true });
}
