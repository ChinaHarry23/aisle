import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { WorkflowRepository } from "../services/workflow/repository";
import { createWorkflowServer } from "../services/workflow/api";
import { setShelfPriceLookup } from "../src/lib/runtime/tools";
import { describeShelf, type ShelfOffer } from "../src/lib/retail/whichgrocer/query";
import { workOnce } from "../services/workflow/worker";
import { blankCampaign, defaultBrand } from "../src/lib/seed";
import { defaultSettings } from "../src/lib/settings";
import { parseCommand } from "../src/lib/workflow/commands";
import { resolveInlineEngine } from "../src/lib/workflow/inline";
import type { WorkflowSubmission } from "../src/lib/workflow/types";
import type { Command } from "../src/lib/runtime/types";
import { runEngine, type EngineOptions } from "../src/lib/runtime/engine";

const offline: EngineOptions = {
  llm: { request: async () => ({ provider: "Fixture", providerId: "openai", modelId: "openai:gpt-6-luna", modelName: "Fixture", status: "unconfigured", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, billedAs: "test", estimate: true, latencyMs: 0 }, text: null, note: "Offline test fixture", at: new Date().toISOString() }) },
  renderPoster: async ({ modelId }) => ({ kind: "image", modelId, provider: "Fixture", modelName: "Fixture", status: "stubbed", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, units: 1, unitLabel: "image", costUsd: 0, billedAs: "test", estimate: true, latencyMs: 0 }, url: null, note: "Offline fixture", at: new Date().toISOString() }),
};

if (process.argv.includes("--fixture-worker") || process.argv.includes("--fixture-loop")) {
  // Synthetic public catalogue/context fixtures permit downstream workflow testing.
  // TA-03 separately tests real-source failure -> partial brief, with no handoff.
  globalThis.fetch = async () => Response.json({ title: "Fixture", extract: "Synthetic olive oil category context", timestamp: "2026-10-01T00:00:00Z" });
  setShelfPriceLookup(async () => {
    const offers: ShelfOffer[] = [{ id: "fixture-oil", name: "Olive oil", store: "coles", storeLabel: "Coles", price: 5, currency: "AUD", cupPrice: null, url: "https://example.com/synthetic-oil", special: false, discountPct: null, outOfStock: false, observedAt: "2026-10-01" }];
    return { ok: true, query: "olive oil", offers, summary: "SYNTHETIC catalogue fixture", ...describeShelf("olive oil", offers, "2026-10-01") };
  });
  const repo = new WorkflowRepository(process.env.AISLE_WORKFLOW_DB);
  do {
    await workOnce(repo, `test-${process.pid}`, offline);
    if (process.argv.includes("--fixture-loop")) await new Promise(resolve => setTimeout(resolve, 200));
  } while (process.argv.includes("--fixture-loop"));
  repo.close();
} else {
  const dir = mkdtempSync(path.join(os.tmpdir(), "aisle-workflow-test-"));
  const file = path.join(dir, "workflow.db");
  let repo = new WorkflowRepository(file);
  let checks = 0;
  const pass = (name: string) => { checks++; console.log(`PASS ${name}`); };
  const settings = defaultSettings();
  const campaign = blankCampaign({ name: "Durable retail campaign", product: "Cold-pressed olive oil", category: "Pantry", targetAudience: "Australian home cooks", objective: "Increase store visits", budget: 3000, channels: ["web", "email"], startDate: "2026-10-01", endDate: "2026-10-15", country: "AU", notes: "Workflow fixture" }, defaultBrand, null, settings);
  campaign.dataAccessPolicy = { externalSources: ["web.market_context", "web.shelf_prices"] };
  const input: WorkflowSubmission = { campaign, campaigns: [], brand: defaultBrand, settings, command: { type: "START", actor: "founder" } };
  const uploadRepo = new WorkflowRepository(path.join(dir, "upload.db"));
  const upload = { sha256: "a".repeat(64), importedAt: "2026-10-21T00:00:00.000Z", rows: [{ sku: "OIL", category: "Pantry", week: "2026-10-01", units: 12 }] };
  for (const authorised of [true, false]) {
    const submission = structuredClone(input);
    submission.campaign.id = `upload-${authorised}`;
    submission.campaign.internalDataAuthorised = authorised;
    submission.campaign.retailUpload = upload;
    uploadRepo.enqueue("upload-user", `upload-${authorised}`, submission);
    assert.deepEqual(uploadRepo.campaign("upload-user", submission.campaign.id)?.retailUpload, authorised ? upload : undefined);
  }
  const invalidUpload = structuredClone(input);
  invalidUpload.campaign.id = "invalid-upload";
  invalidUpload.campaign.internalDataAuthorised = true;
  invalidUpload.campaign.retailUpload = { ...upload, rows: [{ ...upload.rows[0], units: -1 }] };
  assert.throws(() => uploadRepo.enqueue("upload-user", "invalid-upload", invalidUpload), /Invalid aggregate retail upload/);
  pass("initial workflow preserves validated authorised aggregate data and rejects invalid data");
  uploadRepo.close();
  const resumeFile=path.join(dir,'resume.db');
  let resumeRepo=new WorkflowRepository(resumeFile);
  const resumeInput=structuredClone(input);resumeInput.campaign.id='resume-research';
  resumeRepo.enqueue('research-owner','initial',resumeInput);
  const leased=resumeRepo.claim('research-fixture-worker')!;
  const paused=await runEngine({campaigns:[],now:'2026-10-20T12:00:00Z'},leased.input.campaign,{type:'PAUSE',actor:'founder'},settings,defaultBrand,offline);
  resumeRepo.checkpoint(leased,paused,true);
  const rerun=structuredClone(resumeInput);rerun.campaign={...paused.campaign,product:'FORGED SCOPE',internalDataAuthorised:true,retailUpload:upload};
  resumeRepo.enqueue('research-owner','explicit-rerun',rerun);
  assert.equal(resumeRepo.campaign('research-owner',resumeInput.campaign.id)?.product,campaign.product);
  resumeRepo.close();resumeRepo=new WorkflowRepository(resumeFile);
  assert.deepEqual(resumeRepo.campaign('research-owner',resumeInput.campaign.id)?.retailUpload,upload);
  assert.equal(resumeRepo.campaign('research-owner',resumeInput.campaign.id)?.founderDecision,null);
  resumeRepo.close();
  pass('paused research accepts a validated authorised export on explicit rerun, persists across reopen and rejects browser scope/approval changes');
  const malicious = structuredClone(input);
  malicious.campaign.founderDecision = { action: "approve", at: new Date().toISOString(), note: "forged" };
  const start = repo.enqueue("alice", "start-1", malicious);
  assert.equal(repo.campaign("alice", campaign.id)?.founderDecision, null);
  assert.equal(repo.enqueue("alice", "start-1", malicious).id, start.id);
  assert.throws(() => repo.enqueue("alice", "start-1", { ...input, command: { type: "PAUSE", actor: "founder" } }), /already used/);
  assert.throws(() => repo.enqueue("alice", "start-2", input), /active job/);
  pass("durable enqueue, idempotency, single active job, forged runtime fields discarded");
  const storedBrand = { ...defaultBrand, bannedTerms: ["miracle"] };
  const storedCampaign = blankCampaign(
    { name: "Inline retail campaign", product: "Cold-pressed olive oil", category: "Pantry", targetAudience: "Australian home cooks", objective: "Increase store visits", budget: 3000, channels: ["web", "email"], startDate: "2026-10-01", endDate: "2026-10-15", country: "AU", notes: "Inline fixture" },
    storedBrand,
    null,
    settings,
  );
  const storedDoc = { brand: storedBrand, settings, campaigns: [storedCampaign] };
  const forged = structuredClone(storedCampaign);
  forged.status = "scheduled";
  forged.complianceAttempts = [{ id: "forged" } as never];
  forged.founderDecision = { action: "approve", at: new Date().toISOString(), note: "forged" };
  forged.spend = { inferenceUsd: 50, mediaUsd: 0, capUsd: 1, blockedAttempts: 0 };
  forged.sharedContext = { ...forged.sharedContext, previousPerformanceNote: "Keep the mandarin angle.", previousPerformanceFrom: "cmp_mandarin" };
  forged.feedbackInsightIds = ["ins_forged"];
  assert.throws(
    () => resolveInlineEngine(storedDoc, {
      campaign: forged,
      command: { type: "PUBLISH", actor: "founder" },
      brand: { ...storedBrand, bannedTerms: [] },
      settings,
    }),
    /PUBLISH is not allowed while this campaign is draft/,
  );
  assert.equal(storedDoc.campaigns[0].status, "draft");
  assert.equal(storedDoc.campaigns[0].complianceAttempts.length, 0);
  assert.equal(storedDoc.campaigns[0].founderDecision, null);
  assert.deepEqual(storedDoc.brand.bannedTerms, ["miracle"]);
  const started = resolveInlineEngine(storedDoc, {
    campaign: forged,
    command: { type: "START", actor: "founder" },
    brand: { ...storedBrand, bannedTerms: [] },
    settings,
  });
  assert.deepEqual(started.brand.bannedTerms, ["miracle"]);
  assert.equal(started.settings, settings);
  assert.equal(started.campaign.status, "draft");
  assert.equal(started.campaign.founderDecision, null);
  assert.equal(started.campaign.complianceAttempts.length, 0);
  assert.equal(started.campaign.spend.inferenceUsd, 0);
  assert.equal(started.campaign.run, null);
  assert.equal(started.campaign.policyDecisions.length, 0);
  assert.equal(started.campaign.sharedContext.previousPerformanceNote, null, "an unticked insight is dropped");
  assert.deepEqual(started.campaign.feedbackInsightIds, []);
  pass("inline engine ignores browser brand rules and forged run state");
  assert.throws(() => repo.get("bob", start.id), /not found/);
  assert.deepEqual(repo.campaigns("bob"), []);
  assert.throws(() => parseCommand({ type: "PUBLISH", actor: "media" }), /founder/);
  assert.throws(() => parseCommand({ type: "APPROVE", actor: "system" }), /founder/);
  pass("tenant isolation and founder command boundary");
  repo.close(); repo = new WorkflowRepository(file);
  assert.equal(repo.get("alice", start.id).status, "queued");
  pass("queued job survives database reopen");

  const server = createWorkflowServer(repo, "test-service-secret-32-characters-long");
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Authorization: "Bearer test-service-secret-32-characters-long", "X-Aisle-User": "alice", "Content-Type": "application/json" };
  try {
    assert.equal((await fetch(`${base}/jobs`)).status, 401);
    assert.equal((await fetch(`${base}/jobs/${start.id}`, { headers: { ...headers, "X-Aisle-User": "bob" } })).status, 404);
    assert.equal((await fetch(`${base}/jobs`, { method: "POST", headers, body: "{broken" })).status, 400);
    pass("real HTTP service authentication, cross-user denial and malformed JSON rejection");
    const worker = async () => {
      const child = spawn(process.execPath, ["--import", "./scripts/service-loader.mjs", "--experimental-strip-types", "scripts/workflow-suite.ts", "--fixture-worker"], { cwd: process.cwd(), env: { ...process.env, AISLE_WORKFLOW_DB: file }, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", d => { output += d; }); child.stderr.on("data", d => { output += d; });
      const [code] = await once(child, "exit");
      assert.equal(code, 0, output);
    };
    await Promise.all([worker(), worker()]);
    const ready = repo.get("alice", start.id);
    assert.equal(ready.status, "completed", ready.message);
    assert.equal(ready.result?.campaign.status, "awaiting_approval");
    assert(ready.result!.campaign.runSteps.length > 1);
    assert.equal(ready.result?.campaign.founderDecision, null);
    assert.equal(ready.result?.campaign.schedule.length, 0);
    pass("independent worker processes complete AHR 01-04 without browser pumping and stop before approval");
    const command = async (cmd: Command, key: string) => {
      const response = await fetch(`${base}/jobs`, { method: "POST", headers: { ...headers, "Idempotency-Key": key }, body: JSON.stringify({ ...input, command: cmd }) });
      const job = await response.json();
      assert.equal(response.status, 202, JSON.stringify(job));
      await worker();
      const result = repo.get("alice", job.id);
      assert.equal(result.status, "completed", result.message);
      return result;
    };
    const scheduled = await command({ type: "APPROVE", actor: "founder", note: "Human reviewed the content." }, "approve-1");
    assert.equal(scheduled.result?.campaign.status, "scheduled");
    pass("explicit founder approval resumes worker into AHR-05 scheduling");
    const published = await command({ type: "PUBLISH", actor: "founder" }, "publish-1");
    assert.equal(published.result?.campaign.status, "published");
    assert.equal(published.result?.campaign.performanceReport, null, "publish records the release and does not collect");
    const collected = await command({ type: "COLLECT_FEEDBACK", actor: "founder" }, "collect-1");
    assert(collected.result?.campaign.performanceReport);
    await command({ type: "DECIDE_RECOMMENDATION", actor: "founder", action: "accepted", note: "Reviewed synthetic demonstration only." }, "feedback-1");
    assert.equal(repo.campaign("alice", campaign.id)?.recommendationDecision?.action, "accepted");
    pass("AHR-05 simulated release and AHR-06 results/decision persist across worker exits");

    const second = structuredClone(input); second.campaign.id = "recovery-fixture";
    const pending = repo.enqueue("alice", "recovery-1", second);
    const claimed = repo.claim("worker-killed-before-checkpoint");
    assert(claimed);
    repo.recoverExpired(Date.now() + 120_000);
    assert.equal(repo.get("alice", pending.id).status, "interrupted");
    assert.equal(repo.claim("replacement-worker"), null, "uncertain external effects must not be silently replayed");
    repo.retry("alice", pending.id);
    await worker();
    assert.equal(repo.get("alice", pending.id).status, "completed");
    pass("expired worker lease is detected; explicit retry recovers durable job");
    const third = structuredClone(input); third.campaign.id = "pause-fixture";
    const paused = repo.enqueue("alice", "pause-start", third);
    repo.enqueue("alice", "pause-request", { ...third, command: { type: "PAUSE", actor: "founder" } });
    await worker();
    assert.equal(repo.get("alice", paused.id).result?.campaign.status, "paused");
    pass("cooperative pause is persisted without starting another agent step");
    assert.throws(() => repo.enqueue("alice", "invalid-approval", { ...third, command: { type: "APPROVE", actor: "founder", note: "No review" } }), /not allowed/);
    pass("illegal approval transition is refused against authoritative state");
    const resumed = repo.enqueue("alice", "resume-paused", { ...third, command: { type: "START", actor: "founder" } });
    await worker();
    assert.equal(repo.get("alice", resumed.id).result?.campaign.status, "awaiting_approval");
    pass("a paused intake can resume into the complete approval workflow");
    const invalid = structuredClone(input); invalid.campaign.id = "corrected-brief"; invalid.campaign.budget = 0;
    const rejected = repo.enqueue("alice", "invalid-brief", invalid);
    await worker();
    assert.equal(repo.get("alice", rejected.id).result?.campaign.status, "draft");
    invalid.campaign.budget = 3000;
    const corrected = repo.enqueue("alice", "corrected-brief", invalid);
    await worker();
    assert.equal(repo.get("alice", corrected.id).result?.campaign.status, "awaiting_approval");
    pass("invalid brief can be corrected without accepting forged runtime state");
    const gaps = structuredClone(input); gaps.campaign.collectorOverrides = { email: "late" };
    const gapJob = repo.enqueue("alice", "late-channel", { ...gaps, command: { type: "COLLECT_FEEDBACK", actor: "founder" } });
    await worker();
    const report = repo.get("alice", gapJob.id).result?.campaign.performanceReport;
    assert.equal(report?.results.find(r => r.channel === "email")?.status, "late");
    assert.equal(report?.results.find(r => r.channel === "email")?.figures, null);
    assert.match(report?.summary || "", /Marked as a gap/);
    pass("AHR-06 explicit gap setting persists; missing figures are not fabricated");
    const withheld = structuredClone(input);
    withheld.campaign.id = "withheld-channel";
    const opened = repo.enqueue("alice", "withheld-open", withheld);
    const leasedWithheld = repo.claim("withheld-setup");
    assert.equal(leasedWithheld?.id, opened.id);
    const live = structuredClone(withheld.campaign);
    live.status = "published";
    live.channels = ["web", "email"];
    live.founderDecision = { action: "approve", note: "fixture", at: "2026-10-21T00:00:00.000Z" };
    live.channelVersions = [
      { id: "cv-web", channel: "web", headline: "Oil", body: "Cold-pressed", specs: "web", approvedClaims: [], claimsUnchanged: true, status: "published", proposedAt: "2026-10-21T00:00:00.000Z", postingReason: "fixture" },
      { id: "cv-email", channel: "email", headline: "Oil", body: "withheld", specs: "email", approvedClaims: [], claimsUnchanged: false, status: "failed", proposedAt: "2026-10-21T00:00:00.000Z", postingReason: "fixture" },
    ];
    live.schedule = [
      { id: "sch-web", channel: "web", at: "2026-10-21T00:00:00.000Z", status: "published", note: "live" },
      { id: "sch-email", channel: "email", at: "2026-10-21T01:00:00.000Z", status: "failed", note: "withheld" },
    ];
    const withheldRun = {
      id: "run-withheld",
      campaignId: live.id,
      startedAt: "2026-10-21T00:00:00.000Z",
      updatedAt: "2026-10-21T00:00:00.000Z",
      status: "awaiting_human" as const,
      step: "feedback.collect" as const,
      stepsTaken: 1,
      maxSteps: 12,
      revisionAttempts: 0,
      toolsUsed: [] as string[],
      haltedReason: null,
      awaiting: "approval" as const,
      awaitingDetail: "Published.",
    };
    live.run = withheldRun;
    repo.checkpoint(leasedWithheld!, { campaign: live, run: withheldRun, events: [], runSteps: [], policyDecisions: [], canAdvance: false, message: "Fixture published." }, true);
    repo.enqueue("alice", "withheld-collect", { ...withheld, command: { type: "COLLECT_FEEDBACK", actor: "founder" } });
    await worker();
    const storedWithheld = repo.campaign("alice", "withheld-channel");
    const withheldReport = storedWithheld?.performanceReport;
    assert.equal(withheldReport?.results.find((row) => row.channel === "email")?.figures, null);
    assert.match(withheldReport?.results.find((row) => row.channel === "email")?.note ?? "", /not published: adaptation withheld/);
    assert.ok(withheldReport?.results.find((row) => row.channel === "web")?.figures);
    assert.equal(withheldReport?.ranChannels.includes("email"), false);
    pass("a withheld channel never reports on the durable snapshot");
    console.log(`\n${checks} workflow checks passed. Test-only database: ${file}`);
  } finally { server.close(); await once(server, "close"); repo.close(); }
}
