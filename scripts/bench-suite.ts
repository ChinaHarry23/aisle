/**
 * Agent bench scenario suite.
 *
 * Runs the Stage 1 use cases end to end against the real engine, with no browser
 * and no network dependency: `node --experimental-strip-types scripts/bench-suite.ts`.
 *
 * It is the regression net for the behaviour the requirements actually name —
 * the three-attempt compliance loop, the manual-review escalation, the policy
 * refusals, and the feedback gaps — so a change to the engine can be checked in
 * one command instead of by clicking through the app.
 */

import assert from "node:assert/strict";
/* The app's modules import each other as "@/…"; register the resolver before loading them. */
import "./service-loader.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();

const engineUrl = pathToFileURL(path.join(root, "src/lib/runtime/engine.ts")).href;
const seedUrl = pathToFileURL(path.join(root, "src/lib/seed.ts")).href;
const settingsUrl = pathToFileURL(path.join(root, "src/lib/settings.ts")).href;
const retailUrl = pathToFileURL(path.join(root, "src/lib/retail-data.ts")).href;

const { runEngine } = (await import(engineUrl)) as typeof import("../src/lib/runtime/engine");
const { blankCampaign, defaultBrand } = (await import(seedUrl)) as typeof import("../src/lib/seed");
const { defaultSettings } = (await import(settingsUrl)) as typeof import("../src/lib/settings");
const { parseRetailUpload } = (await import(retailUrl)) as typeof import("../src/lib/retail-data");

import type { Campaign, CampaignInput } from "../src/lib/types";
import type { Command } from "../src/lib/runtime/types";
import type { CompleteRequest, CompleteResult } from "../src/lib/llm/types";

const settings = defaultSettings();
// Synthetic category reference for downstream scenarios; source failure/pausing is
// covered by trend-evidence-suite. No live retrieval is implied by this fixture.
globalThis.fetch = async () => Response.json({ title: "Synthetic fixture", extract: "Synthetic category context; not measured market research." });

function usageStub() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    billedAs: "none",
    estimate: true,
    latencyMs: 0,
  };
}

/** No backend configured: every decision takes the deterministic path. */
type LlmStub = { request: (req: CompleteRequest) => Promise<CompleteResult> };

const offlineLlm: LlmStub = {
  request: async () => ({
    provider: "Offline",
    providerId: "openai" as const,
    modelId: "openai:gpt-6-luna",
    modelName: "Offline",
    status: "unconfigured" as const,
    usage: usageStub(),
    text: null,
    note: "suite: deterministic path",
    at: new Date().toISOString(),
  }),
};

/** A scripted "model" that answers each decision call with valid JSON. */
function scriptedLlm(): LlmStub {
  return {
    request: async (req: CompleteRequest) => {
      let text: string | null = null;
      if (req.agent === "creative") {
        const variant = (n: "A" | "B") => ({
          variant: n,
          kicker: "Weekly",
          headline: n === "A" ? "Olive oil, honestly described" : "Pantry staple",
          subhead: n === "A" ? "Cold-pressed, in store this week." : "In store this week.",
          cta: "See the range",
          caption: "Lane & Co. grocery.",
          prompt: "studio ad",
        });
        text = JSON.stringify({ variants: [variant("A"), variant("B")] });
      } else if (req.agent === "compliance") {
        text = JSON.stringify({ issues: [], summary: "Scripted review." });
      } else if (req.agent === "trend") {
        text = JSON.stringify({
          priorities: [{ topic: "Weekly pantry demand", relevance: 88, confidence: 80 }],
          angle: "Pantry staples, plainly described.",
          keyMessage: "In store this week.",
          claimsAllowed: ["Cold-pressed"],
          claimsAvoid: ["guaranteed"],
          visualDirection: "Cream stock, ink type.",
          limitations: ["Scripted brief."],
        });
      }
      return {
        provider: "Scripted",
        providerId: "openai" as const,
        modelId: "openai:gpt-6-luna",
        modelName: "Scripted",
        status: text ? ("ok" as const) : ("unconfigured" as const),
        usage: usageStub(),
        text,
        note: "suite: scripted",
        at: new Date().toISOString(),
      };
    },
  };
}

const stubPoster = async ({ modelId }: { modelId: string }) => ({
  kind: "image" as const,
  modelId,
  provider: "stub",
  modelName: "stub",
  status: "stubbed" as const,
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    units: 1,
    unitLabel: "image",
    costUsd: 0.04,
    billedAs: "stub",
    latencyMs: 1,
    estimate: true,
  },
  url: null,
  note: "suite",
  at: new Date().toISOString(),
});

const options = { llm: offlineLlm, renderPoster: stubPoster, maxSteps: 20 };
const woolworthsUpload = parseRetailUpload(
  JSON.parse(readFileSync(new URL("../src/data/retail/woolworths.json", import.meta.url), "utf8")),
  "woolworths.json",
);
if (!woolworthsUpload.ok) throw new Error(woolworthsUpload.error);
const benchBrand = { ...defaultBrand, retailData: woolworthsUpload.dataset };

const baseInput: CampaignInput = {
  name: "Bench suite campaign",
  product: "Northline Trail Parka (navy)",
  category: "Apparel",
  targetAudience: "Australian university students, 18–24",
  objective: "Drive awareness and add-to-cart",
  budget: 18000,
  channels: ["instagram", "web", "email"],
  startDate: "2026-09-01",
  endDate: "2026-09-21",
  country: "AU",
  notes: "Suite run.",
};

/** A campaign plus the command loop the browser performs. */
function session(
  input: Partial<CampaignInput> = {},
  campaignPatch: Partial<Campaign> = {},
  engineOptions: Partial<typeof options> = {},
) {
  let campaign: Campaign = {
    ...blankCampaign({ ...baseInput, ...input }, benchBrand, null, settings),
    ...campaignPatch,
  };
  const ctx = { campaigns: [campaign], now: new Date().toISOString() };

  async function run(command: Command) {
    const result = await runEngine(ctx, campaign, command, settings, benchBrand, {
      ...options,
      ...engineOptions,
    });
    campaign = result.campaign;
    ctx.campaigns = [campaign];
    return result;
  }

  return { run, get campaign() { return campaign; } };
}

const results: { name: string; detail: string }[] = [];
function pass(name: string, detail: string) {
  results.push({ name, detail });
}

/** Drive the bench to its next gate, exactly as the browser pump does. */
async function startAndAdvance(
  input: Partial<CampaignInput> = {},
  campaignPatch: Partial<Campaign> = {},
  engineOptions: Partial<typeof options> = {},
) {
  const s = session(input, campaignPatch, engineOptions);
  await s.run({ type: "START", actor: "founder" });
  let i = 0;
  let result = await s.run({ type: "ADVANCE", actor: "founder" });
  while ((result.canAdvance || s.campaign.run?.status === "running") && i++ < 12) {
    result = await s.run({ type: "ADVANCE", actor: "founder" });
  }
  return s;
}

/**
 * Drive the bench to a founder-approvable draft that the Media Manager can adapt.
 *
 * A review run without an authorised policy registry escalates straight to
 * manual review. The founder resolves that the way the desk does: request
 * changes once, then approve the brief-written draft.
 */
async function startAndClear(...args: Parameters<typeof startAndAdvance>) {
  const s = await startAndAdvance(...args);
  if (s.campaign.complianceAttempts.at(-1)?.outcome === "manual_review") {
    let r = await s.run({ type: "REQUEST_CHANGES", actor: "founder", note: "Remove the unsupported claims." });
    let i = 0;
    while ((r.canAdvance || s.campaign.run?.status === "running") && i++ < 12) {
      r = await s.run({ type: "ADVANCE", actor: "founder" });
    }
  }
  return s;
}

/** Approve the draft, then drive the run to its next gate. */
async function approveAndAdvance(s: ReturnType<typeof session>, note: string) {
  await s.run({ type: "APPROVE", actor: "founder", note });
  let i = 0;
  let r = await s.run({ type: "ADVANCE", actor: "founder" });
  while ((r.canAdvance || s.campaign.run?.status === "running") && i++ < 8) {
    r = await s.run({ type: "ADVANCE", actor: "founder" });
  }
}

/* ------------------------------------------------- UC-01 ext 3.a / 4.a / 5.a */

{
  const s = session({ budget: 0, channels: [], startDate: "2026-09-21", endDate: "2026-09-01" });
  const r = await s.run({ type: "START", actor: "founder" });
  assert.equal(s.campaign.status, "draft", "an invalid brief must stay a draft");
  assert.equal(s.campaign.run?.awaiting, "brief_correction");
  const fields = s.campaign.validationProblems.map((p) => p.field).sort();
  assert.deepEqual(fields, ["budget", "channels", "endDate"]);
  assert.match(r.message, /did not start/);
  pass("UC-01 ext 4.a — invalid brief refused", `kept draft; flagged ${fields.join(", ")}`);
}

{
  const s = session({ name: "No brand" });
  const r = await runEngine(
    { campaigns: [s.campaign], now: new Date().toISOString() },
    s.campaign,
    { type: "START", actor: "founder" },
    settings,
    null as unknown as typeof defaultBrand,
  );
  assert.equal(r.campaign.status, "draft", "missing brand settings must block launch (ext 5.a)");
  assert.ok(r.campaign.validationProblems.some((p) => p.clause.includes("5.a")));
  pass("UC-01 ext 5.a — missing brand/country-law settings block launch", r.message.slice(0, 60));
}

/* --------------------------------------------------- AHR-02 evidence + gaps */

{
  const s = await startAndAdvance({ channels: ["instagram", "web", "email", "print"] }, { internalDataAuthorised: true });
  const c = s.campaign;
  assert.ok(c.evidence.length > 0, "the trend step must record evidence");
  assert.ok(
    c.trendFindings.some((f) => f.basis === "supported"),
    "at least one finding must cite a source",
  );
  assert.ok(c.trendGaps.length > 0, "limitations must be recorded");
  assert.ok(
    c.evidence.every((e) => e.sourceName && e.fetchedAt && (e.observedAt === null || typeof e.observedAt === "string")),
    "every evidence row needs provenance, retrieval time and an explicit known or unknown information date",
  );
  assert.ok(c.toolCalls.length > 0, "tool calls must be recorded");
  assert.ok(c.evidence.some((e) => e.sourceName === "Woolworths POS"), "authorised POS must cite the uploaded Woolworths file");
  assert.ok(!c.evidence.some((e) => /Lane & Co/i.test(e.sourceName)), "another retailer's warehouse must not be cited");
  pass(
    "AHR-02 — sourced brief with labelled assumptions",
    `${c.evidence.length} evidence rows, ${c.trendFindings.filter((f) => f.basis === "supported").length} supported, ${c.trendGaps.length} limitations`,
  );
}

{
  const s = await startAndAdvance({ channels: ["web"] }, { internalDataAuthorised: false });
  const c = s.campaign;
  assert.ok(
    c.evidence.some((e) => e.sourceName === "Woolworths POS"),
    "the Brand POS file is used without a separate campaign authorisation",
  );
  assert.ok(
    !c.policyDecisions.some((d) => d.action === "READ_INTERNAL_DATA" && d.verdict === "block"),
    "a loaded Brand file must not be blocked as unauthorised",
  );
  pass("UC-02 — Brand POS file authorises the trend read", `${c.evidence.length} evidence rows`);
}

/* CC-03: missing trusted policy must stop the automatic revision chain. */
{
  // The bundled registry has binding AU law, so its copyright, ethics, brand
  // and platform gaps are reported as limitations, not as missing policy.
  const bundled = await startAndAdvance({ channels: ["web"] });
  const selection = bundled.campaign.complianceReviewRuns?.[0].ruleSelection;
  assert.equal(selection?.problems.length, 0, "binding AU advertising and consumer law are present");
  assert.ok(selection?.limitations?.some((line) => line.includes("copyright")));
  assert.ok(bundled.campaign.complianceReviewRuns?.[0].report?.limitations.some((line) => line.includes("copyright")), "gaps reach the report");
  pass("CC-03 — coverage gaps are reported, not treated as missing law", `${selection?.limitations?.length ?? 0} limitation(s)`);
}
const bundledRules = process.env.AISLE_COMPLIANCE_RULES_FILE;
process.env.AISLE_COMPLIANCE_RULES_FILE = path.join(root, "data", "no-such-policy-registry.json");
{
  const s = await startAndAdvance({ channels: ["web"] });
  const c = s.campaign;
  assert.equal(c.complianceReviewRuns?.length, 1);
  assert.equal(c.complianceReviewRuns?.[0].status, "COMPLETED");
  assert.equal(c.complianceReviewRuns?.[0].report?.status, "MANUAL_REVIEW_REQUIRED");
  assert.equal(c.complianceReports.at(-1)?.verdict, "escalate");
  assert.ok(c.complianceReviewRuns?.[0].ruleSelection?.problems.length);
  assert.equal(c.complianceAttempts[0].outcome, "manual_review");
  assert.equal(c.creatives[0].version, 1);
  assert.equal(c.status, "awaiting_approval");
  const painted = `${c.creatives[0].headline} ${c.creatives[1].headline} ${c.creatives[0].prompt}`;
  assert.doesNotMatch(painted, /healthiest breakfast|miracle mornings|warmest jacket/i);
  assert.match(c.creatives[0].prompt, /Northline Trail Parka/i);
  assert.match(c.creatives[0].headline, /Weatherproof|Northline Trail Parka/i);
  assert.equal(c.complianceAttempts[0].issues.length, 0, "a missing agent review must not invent findings");
  assert.ok(!c.complianceAttempts[0].issues.some(i => i.rule === "review.price"));
  pass("CC-03/04 — unavailable policy stops automatic work", "Exact submitted version retained; manual review required; no content scan.");
}
{
  const s = await startAndAdvance({ channels: ["web"] }, {}, { llm: scriptedLlm() });
  assert.equal(s.campaign.complianceAttempts[0].outcome, "manual_review", "empty model findings cannot clear unavailable policy");
  assert.notEqual(s.campaign.status, "published");
  pass("CC-03 — model pass cannot override missing policy", "Unpublished, awaiting human resolution.");
}
if (bundledRules === undefined) delete process.env.AISLE_COMPLIANCE_RULES_FILE;
else process.env.AISLE_COMPLIANCE_RULES_FILE = bundledRules;

/* ---------------------------------------------------- AHR-05 distribution -- */

{
  const s = await startAndClear({ channels: ["instagram", "web", "email", "print"], budget: 18000 });
  await approveAndAdvance(s, "Ship variant A.");
  const c = s.campaign;
  assert.ok(c.channelVersions.length > 0, "channel versions must exist after approval");
  const frozen = c.channelVersions.filter((v) => v.claimsUnchanged);
  assert.ok(frozen.length > 0, "at least one channel must carry the cleared wording");
  assert.ok(
    c.channelVersions.every((v) => v.approvedClaims.length > 0),
    "each channel version must record the claims it froze",
  );
  if (c.channelVersions.some((v) => v.status === "failed")) {
    assert.ok(
      c.policyDecisions.some((d) => d.action === "EDIT_APPROVED_CLAIM" && d.verdict === "block"),
      "a blocked adaptation must leave a guard record",
    );
  }
  pass(
    "AHR-05 — per-channel versions with frozen claims",
    c.channelVersions.map((v) => `${v.channel}:${v.status}`).join(" "),
  );
}

/* -------------------------------------------------------- guard refusals --- */

{
  const s = await startAndAdvance({ channels: ["instagram", "print"] });
  const blockedBefore = s.campaign.spend.blockedAttempts;
  const blocked: Record<string, string> = {};
  for (const action of [
    "PUBLISH_CONTENT",
    "SPEND_MEDIA",
    "EDIT_APPROVED_CLAIM",
    "CHANGE_CAMPAIGN_SCOPE",
    "SKIP_ITEM_SILENTLY",
  ] as const) {
    await s.run({ type: "ATTEMPT_BLOCKED", actor: action });
    const decision = s.campaign.policyDecisions.at(-1);
    assert.equal(decision?.verdict, "block", `${action} must be refused`);
    assert.ok(decision?.clause.length, `${action} must cite its requirement clause`);
    blocked[action] = decision!.rule;
  }
  assert.equal(s.campaign.spend.blockedAttempts - blockedBefore, 5, "each refusal must be counted");
  assert.ok(
    s.campaign.log.some((e) => e.kind === "policy"),
    "a refusal must reach the campaign log (ext 13.a)",
  );
  pass("UC-01 ext 13.a — five agent attempts refused and logged", Object.values(blocked).join(", "));
}

/* -------------------------------------------- publish + AHR-06 feedback ---- */

{
  const s = await startAndClear({ channels: ["instagram", "web", "email"], budget: 12000 });
  await approveAndAdvance(s, "Go.");

  // The bench must stop at Scheduled: an agent may not publish.
  assert.equal(s.campaign.status, "scheduled", "the run must stop at Scheduled");
  await s.run({ type: "ATTEMPT_BLOCKED", actor: "PUBLISH_CONTENT" });
  assert.equal(s.campaign.policyDecisions.at(-1)?.verdict, "block");

  const published = await s.run({ type: "PUBLISH", actor: "founder" });
  assert.equal(s.campaign.status, "published", `publish failed: ${published.message}`);
  assert.equal(s.campaign.run?.step, "feedback.collect");
  assert.equal(published.campaign.performanceReport, null, "publish does not collect");

  const collected = await s.run({ type: "COLLECT_FEEDBACK", actor: "founder" });
  const report = collected.campaign.performanceReport;
  assert.ok(report, `collection failed: ${collected.message}`);
  assert.ok(report.results.length === s.campaign.channels.length, "each channel must be reported on");
  assert.ok(
    report.results.every((x) => x.figures || x.status !== "ok"),
    "a channel without figures must not be marked ok (UC-06 4.a/4.b)",
  );
  assert.ok(
    report.gaps.every((g) => typeof g === "string" && g.length > 0),
    "gaps must be spelled out in the summary",
  );
  assert.ok(report.summary.includes("channel"), "the summary must describe what ran");
  if (report.recommendationUnsupported) {
    assert.equal(report.recommendationText, null, "no advice may be invented from missing data");
  } else {
    assert.ok(report.recommendationPoints.length > 0);
  }

  const decided = await s.run({
    type: "DECIDE_RECOMMENDATION",
    actor: "founder",
    action: "edited",
    text: "Keep the angle, rebalance away from print.",
  });
  assert.equal(s.campaign.recommendationDecision?.action, "edited");
  assert.match(s.campaign.recommendationDecision?.text ?? "", /rebalance/);
  assert.equal(decided.canAdvance, false);
  pass(
    "AHR-05 → AHR-06 — published, collected, gaps marked, decision stored",
    `${report.results.filter((x) => x.figures).length}/${report.results.length} channels reported, ${report.gaps.length} gap(s)`,
  );
}

{
  let recommendationCalls = 0;
  const counting: LlmStub = {
    request: async (req) => {
      if (req.agent === "media" && /Recommend what to keep/.test(req.prompt)) recommendationCalls += 1;
      return scriptedLlm().request(req);
    },
  };
  const s = await startAndClear({ channels: ["instagram", "web"], budget: 8000 }, {}, { llm: counting });
  await approveAndAdvance(s, "Go.");
  recommendationCalls = 0;
  await s.run({ type: "PUBLISH", actor: "founder" });
  assert.equal(s.campaign.performanceReport, null, "publish does not collect");
  assert.equal(recommendationCalls, 0, "publish makes no Media Manager recommendation call");
  await s.run({ type: "COLLECT_FEEDBACK", actor: "founder" });
  assert.equal(recommendationCalls, 1, "collect runs exactly one Media Manager decision");
  assert.equal(s.campaign.runSteps.filter((step) => step.step === "feedback.collect").length, 1);
  await s.run({ type: "COLLECT_FEEDBACK", actor: "founder" });
  assert.equal(recommendationCalls, 2, "a second collection asks once more");
  assert.equal(
    s.campaign.runSteps.filter((step) => step.step === "feedback.collect").length,
    1,
    "collecting twice replaces the collect step",
  );
  pass("publish does not collect", "collect runs exactly one Media Manager decision");
}

{
  const s = await startAndClear({ channels: ["instagram", "web", "email"], budget: 12000 });
  await approveAndAdvance(s, "Go.");
  await s.run({ type: "PUBLISH", actor: "founder" });
  assert.equal(s.campaign.status, "published");
  const email = s.campaign.channelVersions.find((version) => version.channel === "email");
  assert.ok(email, "email must have a channel version");
  email.status = "failed";
  s.campaign.schedule = s.campaign.schedule.map((item) =>
    item.channel === "email" ? { ...item, status: "failed" } : item,
  );
  await s.run({ type: "COLLECT_FEEDBACK", actor: "founder" });
  const report = s.campaign.performanceReport;
  assert.ok(report);
  const withheld = report.results.find((row) => row.channel === "email");
  assert.equal(withheld?.figures, null);
  assert.match(withheld?.note ?? "", /not published: adaptation withheld/);
  assert.equal(report.ranChannels.includes("email"), false);
  assert.equal(report.summary.includes("Best CTR on email"), false);
  assert.ok(report.results.some((row) => row.channel !== "email" && row.figures));
  pass("a withheld channel never reports", "email excluded from totals and the best-CTR line");
}

{
  const s = await startAndClear({ channels: ["instagram", "web"], budget: 9000 });
  await approveAndAdvance(s, "Go.");
  s.campaign.collectorOverrides = { instagram: "no_data", web: "late" };
  await s.run({ type: "PUBLISH", actor: "founder" });
  await s.run({ type: "COLLECT_FEEDBACK", actor: "founder" });
  const report = s.campaign.performanceReport;
  assert.ok(report);
  assert.equal(report.totals, null);
  assert.equal(report.recommendationUnsupported, true);
  assert.equal(report.recommendationText, null);
  const accepted = await s.run({
    type: "DECIDE_RECOMMENDATION",
    actor: "founder",
    action: "accepted",
    text: report.summary,
  });
  assert.equal(s.campaign.recommendationDecision, null);
  assert.match(accepted.message, /cannot be accepted/);
  s.campaign.performanceReport = report;
  s.campaign.recommendationDecision = {
    action: "accepted",
    text: report.summary,
    note: "",
    at: new Date().toISOString(),
    author: "Human Founder",
    attachedToCampaignId: null,
  };
  const { attachableRecommendation } = (await import(
    pathToFileURL(path.join(root, "src/lib/runtime/defaults.ts")).href
  )) as typeof import("../src/lib/runtime/defaults");
  const { extractableInsights } = (await import(
    pathToFileURL(path.join(root, "src/lib/insights.ts")).href
  )) as typeof import("../src/lib/insights");
  assert.equal(attachableRecommendation([s.campaign]), null);
  assert.equal(extractableInsights(s.campaign).length, 0);
  pass("an unsupported recommendation is not attached", "accept refused; summary stays off the next brief");
}

/* ----------------------------------- UC-05 ext 6.a — publish retry/reconcile */

{
  // The declared publish path drives the three cases UC-05 ext 6.a names without
  // a random seed: a clean confirm, a retry inside the cap, and a late result
  // that must be reconciled to the same item id rather than resubmitted.
  const s = await startAndClear(
    { channels: ["web", "email", "print"], budget: 12000 },
    { publishOverrides: { web: "retry_then_ok", email: "late", print: "ok" } },
  );
  await approveAndAdvance(s, "Go.");
  assert.equal(s.campaign.status, "scheduled", "the run must reach Scheduled before publish");

  const published = await s.run({ type: "PUBLISH", actor: "founder" });
  assert.equal(s.campaign.status, "published", `publish failed: ${published.message}`);
  const dr = s.campaign.deliveryReport;
  assert.ok(dr, "the founder's publish must record a delivery report");
  assert.equal(dr!.failed, 0, "no channel fails in this scenario");
  assert.equal(dr!.published, s.campaign.channels.length, "every channel confirmed");
  assert.equal(dr!.outcome, "complete", "all channels live → outcome complete");

  const retried = dr!.attempts.find((a) => a.channel === "web");
  assert.ok((retried?.attempts ?? 0) > 1, "the retry channel records more than one submission");
  assert.equal(retried?.attempts, 2, "retry succeeds within the cap, not on the first try");
  assert.equal(retried?.retries, 1, "exactly one retry was used before it confirmed");

  const late = dr!.attempts.find((a) => a.channel === "email");
  assert.ok(late?.reconciled, "the late channel is reconciled, not left silent");
  assert.equal(late?.status, "published", "a reconciled late result ends published");

  assert.ok(
    dr!.attempts.every((a) => a.status !== "published" || a.confirmationRef),
    "no channel is published without a confirmation (no outcome without a real submission)",
  );
  const ids = dr!.attempts.map((a) => a.itemId);
  assert.equal(new Set(ids).size, ids.length, "one record per item id — reconciliation stays idempotent");
  assert.ok(
    s.campaign.schedule.every((x) => x.status === "published"),
    "the schedule reflects what actually went live",
  );

  const collected = await s.run({ type: "COLLECT_FEEDBACK", actor: "founder" });
  assert.ok(s.campaign.performanceReport, `collection failed: ${collected.message}`);
  pass(
    "UC-05 ext 6.a — bounded retry + late-result reconciliation, then collect",
    dr!.attempts.map((a) => `${a.channel}:${a.status}${a.reconciled ? "(reconciled)" : ""}@${a.attempts}`).join(" "),
  );
}

{
  // One channel never confirms. It must not quietly publish the campaign: the
  // retry cap is hit, the item is flagged for the founder, and results cannot be
  // collected until delivery completes.
  const s = await startAndClear(
    { channels: ["web", "email", "print"], budget: 12000 },
    { publishOverrides: { web: "fail" } },
  );
  await approveAndAdvance(s, "Go.");
  assert.equal(s.campaign.status, "scheduled", "the run must reach Scheduled before publish");

  await s.run({ type: "PUBLISH", actor: "founder" });
  assert.notEqual(s.campaign.status, "published", "an unconfirmed channel must not publish the campaign");
  assert.equal(s.campaign.run?.awaiting, "failure", "the run parks for the founder");

  const dr = s.campaign.deliveryReport!;
  assert.ok(dr.failed >= 1, "the failing channel is recorded as failed");
  assert.equal(dr.outcome, "partial", "some channels live, one failed → mixed run partially completed");
  const webItem = dr.attempts.find((a) => a.channel === "web");
  assert.equal(webItem?.status, "failed");
  assert.equal(webItem?.retries, 3, "retried exactly three times (the cap), not indefinitely");
  assert.equal(webItem?.attempts, 4, "one initial send + three retries");
  assert.equal(webItem?.confirmationRef, null, "a failed submission carries no confirmation");
  assert.ok(
    s.campaign.policyDecisions.some((d) => d.rule === "AHR-05-R.retry-cap" && d.verdict === "block"),
    "retry exhaustion leaves a guard record (no infinite retry, no silent skip)",
  );

  await s.run({ type: "COLLECT_FEEDBACK", actor: "founder" });
  assert.ok(!s.campaign.performanceReport, "results cannot be collected before delivery completes");
  pass(
    "UC-05 ext 6.a — unconfirmed channel capped, escalated, never skipped silently",
    dr.attempts.map((a) => `${a.channel}:${a.status}@${a.attempts}`).join(" "),
  );
}

/* ------------------------------ AHR-05 — AI per-channel captions (guard-safe) */

{
  // UC-05's AI step. The Media Manager's model writes a platform-native caption
  // per channel. A caption that keeps every cleared claim is used; one that drops
  // the cleared claims is rejected and the deterministic template stands — proving
  // the LLM can only improve copy within the frozen-claims boundary.
  const captionLlm: LlmStub = {
    request: async (req: CompleteRequest) => {
      let text: string | null = null;
      if (req.agent === "media" && /caption/i.test(req.prompt)) {
        const h = req.prompt.match(/Approved headline: "([^"]*)"/)?.[1] ?? "";
        const sub = req.prompt.match(/Approved subhead: "([^"]*)"/)?.[1] ?? "";
        const claims = req.prompt.match(/MUST NOT be reworded: (.+)/)?.[1]?.replace(/\.\s*$/, "") ?? "";
        text = JSON.stringify({
          captions: {
            // Keeps the approved wording and every cleared claim → accepted.
            web: `${h}. ${sub} ${claims}. Shop in store this week.`,
            // Drops the cleared claims entirely → must be rejected by the guard.
            email: "Limited time only. Shop today.",
          },
        });
      }
      return {
        provider: "Scripted",
        providerId: "openai" as const,
        modelId: "openai:gpt-6-luna",
        modelName: "Scripted",
        status: text ? ("ok" as const) : ("unconfigured" as const),
        usage: usageStub(),
        text,
        note: "suite: caption stub",
        at: new Date().toISOString(),
      };
    },
  };

  const s = await startAndClear(
    { channels: ["web", "email", "print"], budget: 12000 },
    {},
    { llm: captionLlm },
  );
  await approveAndAdvance(s, "Go.");
  const c = s.campaign;
  const web = c.channelVersions.find((v) => v.channel === "web");
  const email = c.channelVersions.find((v) => v.channel === "email");
  assert.equal(web?.captionSource, "model", "a claims-safe model caption is used (UC-05 uses the AI agent)");
  assert.equal(web?.claimsUnchanged, true, "the AI caption kept every cleared claim");
  assert.equal(email?.captionSource, "template", "a caption that drops a cleared claim is rejected → template stands");
  assert.ok(
    c.log.some((e) => e.kind === "insight" && /caption/i.test(e.title)),
    "the run records that the Media Manager's model wrote the captions",
  );
  // The pasteable website embed: media + the channel caption, ready for marketing.
  assert.ok(web?.embedHtml && /<div class="aisle-ad"/.test(web.embedHtml), "a pasteable HTML embed is produced per channel");
  assert.ok(
    /<img |Campaign media/.test(web?.embedHtml ?? ""),
    "the embed carries the campaign media (or a labelled placeholder when none was rendered)",
  );
  pass(
    "AHR-05 — AI per-channel captions, guard-safe (claims-frozen)",
    c.channelVersions.map((v) => `${v.channel}:${v.captionSource ?? "—"}`).join(" "),
  );
}

/* ----------------------------------- DI-02 — Media Manager agent & gateways */

{
  const { selectGateway, channelTypeOf, GATEWAYS } = (await import(
    pathToFileURL(path.join(root, "src/lib/runtime/gateways.ts")).href
  )) as typeof import("../src/lib/runtime/gateways");
  const { AIMediaManager, Agent } = (await import(
    pathToFileURL(path.join(root, "src/lib/runtime/agents.ts")).href
  )) as typeof import("../src/lib/runtime/agents");

  // Channels route to the correct gateway by type (digital vs physical).
  assert.equal(channelTypeOf("instagram"), "digital");
  assert.equal(channelTypeOf("email"), "digital");
  assert.equal(channelTypeOf("print"), "physical");
  assert.equal(channelTypeOf("digital_signage"), "physical");
  assert.equal(selectGateway("web").getChannelType("web"), "digital");
  assert.equal(selectGateway("print").getChannelType("print"), "physical");

  // The interface is implemented: getChannelType / supportsFormat / isAvailable / publish.
  assert.ok(selectGateway("web").isAvailable("web"));
  assert.ok(selectGateway("web").supportsFormat("web", "html"));
  assert.ok(selectGateway("print").supportsFormat("print", "print"));
  assert.ok(!selectGateway("print").supportsFormat("print", "html"), "a print gateway does not carry html");

  // Simulated publish through a gateway honours the delivery contract.
  const now = new Date().toISOString();
  const okAttempt = selectGateway("web").publish({ id: "si_ok", channel: "web" }, "ok", now);
  assert.equal(okAttempt.status, "published");
  assert.ok(okAttempt.confirmationRef, "a confirmed submission carries a reference");
  const failAttempt = selectGateway("print").publish({ id: "si_fail", channel: "print" }, "fail", now);
  assert.equal(failAttempt.status, "failed");
  assert.equal(failAttempt.retries, 3, "retried up to the cap, not indefinitely");
  assert.equal(failAttempt.confirmationRef, null);

  // Two gateways registered; no live platform client exists.
  assert.equal(Object.keys(GATEWAYS).sort().join(","), "digital,physical");

  // The AIMediaManager generalizes the shared Agent base; run ops are callable.
  const mgr = new AIMediaManager();
  assert.ok(mgr instanceof Agent, "AIMediaManager generalizes the shared Agent base");
  assert.equal(mgr.slot, "media");
  assert.equal(typeof mgr.adapt, "function");
  assert.equal(typeof mgr.schedule, "function");
  assert.equal(typeof mgr.publish, "function");

  pass(
    "DI-02 — Media Manager agent generalizes Agent; digital/physical gateways registered & selected",
    `${GATEWAYS.digital.name} · ${GATEWAYS.physical.name}`,
  );
}

/* ----------------------------- DI-03 — receive & verify distribution context */

{
  // Before any adaptation, the approved ad and distribution context are verified:
  // the compliance approval id is recorded and each channel's authorised access is
  // loaded from the gateways.
  const s = await startAndClear({ channels: ["web", "email", "print"], budget: 12000 });
  await s.run({ type: "APPROVE", actor: "founder", note: "Go." });
  let i = 0;
  let r = await s.run({ type: "ADVANCE", actor: "founder" });
  while ((r.canAdvance || s.campaign.run?.status === "running") && i++ < 8) {
    r = await s.run({ type: "ADVANCE", actor: "founder" });
  }
  const dc = s.campaign.distributionContext;
  assert.ok(dc, "a distribution context must be recorded before adaptation");
  assert.equal(dc!.ok, true, "an approved campaign with full context passes the check");
  assert.ok(dc!.complianceApprovalId, "the compliance approval id is recorded");
  assert.equal(dc!.channels.length, s.campaign.channels.length, "authorised access is loaded for every selected channel");
  assert.ok(dc!.channels.every((ch) => ch.available), "each selected channel reports authorised access");
  assert.ok(dc!.channels.some((ch) => ch.channel === "print" && ch.type === "physical"), "print routes to the physical gateway");
  assert.equal(dc!.missing.length, 0, "no required context field is missing");
  pass(
    "DI-03 — approved ad received, context verified (approval id + channel auth)",
    dc!.channels.map((ch) => `${ch.channel}:${ch.type}:${ch.available ? "auth" : "no"}`).join(" "),
  );
}

/* ----------------------------------- DI-11 — per-item publish latency recorded */

{
  // Publish-and-confirm latency is measured per item. A late-reconciled result
  // costs the most (it timed out before the late confirmation), so it is a stable,
  // seed-free ordering to assert on.
  const s = await startAndClear(
    { channels: ["web", "email", "print"], budget: 12000 },
    { publishOverrides: { web: "late", email: "ok", print: "retry_then_ok" } },
  );
  await s.run({ type: "APPROVE", actor: "founder", note: "Go." });
  let i = 0;
  let r = await s.run({ type: "ADVANCE", actor: "founder" });
  while ((r.canAdvance || s.campaign.run?.status === "running") && i++ < 8) {
    r = await s.run({ type: "ADVANCE", actor: "founder" });
  }
  await s.run({ type: "PUBLISH", actor: "founder" });
  const dr = s.campaign.deliveryReport!;
  assert.ok(dr.attempts.every((a) => typeof a.latencyMs === "number"), "latency is recorded for every item");
  assert.ok(
    dr.attempts.filter((a) => a.status === "published").every((a) => a.latencyMs > 0),
    "a confirmed publish carries a non-zero latency",
  );
  const web = dr.attempts.find((a) => a.channel === "web");
  const email = dr.attempts.find((a) => a.channel === "email");
  assert.equal(web?.reconciled, true, "web is the late-reconciled channel");
  assert.ok((web?.latencyMs ?? 0) > (email?.latencyMs ?? 0), "the late-reconciled channel took the longest to confirm");
  pass(
    "DI-11 — publish-and-confirm latency recorded per item (late costs most)",
    dr.attempts.map((a) => `${a.channel}:${a.latencyMs}ms`).join(" "),
  );
}

/* --------------------- DI-08 — respect pause / cancellation and late results */

{
  const { reconcileLateResult } = (await import(
    pathToFileURL(path.join(root, "src/lib/runtime/steps.ts")).href
  )) as typeof import("../src/lib/runtime/steps");

  // A paused campaign does not start a publish (the pause is owned by the pipeline).
  const paused = session({ channels: ["web"] }, { status: "paused" });
  await paused.run({ type: "PUBLISH", actor: "founder" });
  assert.notEqual(paused.campaign.status, "published", "a paused campaign must not publish");
  assert.ok(!paused.campaign.deliveryReport, "no delivery is recorded while paused");

  // One channel fails to confirm; a late result then arrives for it.
  const s = await startAndClear(
    { channels: ["web", "email", "print"], budget: 12000 },
    { publishOverrides: { web: "fail" } },
  );
  await s.run({ type: "APPROVE", actor: "founder", note: "Go." });
  let i = 0;
  let r = await s.run({ type: "ADVANCE", actor: "founder" });
  while ((r.canAdvance || s.campaign.run?.status === "running") && i++ < 8) {
    r = await s.run({ type: "ADVANCE", actor: "founder" });
  }
  await s.run({ type: "PUBLISH", actor: "founder" });
  const webId = s.campaign.deliveryReport!.attempts.find((a) => a.channel === "web")!.itemId;

  // The late result is reconciled to the same item id and recorded as fact.
  assert.equal(reconcileLateResult(s.campaign, webId, "web-late-ref", new Date().toISOString()), "reconciled");
  const web = s.campaign.deliveryReport!.attempts.find((a) => a.channel === "web")!;
  assert.equal(web.status, "published", "the late result is recorded as fact");
  assert.equal(web.reconciled, true, "it is reconciled, not resubmitted");
  assert.equal(s.campaign.deliveryReport!.outcome, "complete", "every channel is now accounted for");
  // Idempotent: a second late result does not double-publish.
  assert.equal(reconcileLateResult(s.campaign, webId, "dup", new Date().toISOString()), "already_published");
  // A result for an id we no longer hold (cancelled/unknown) is ignored, not invented.
  assert.equal(reconcileLateResult(s.campaign, "si_unknown", "x", new Date().toISOString()), "ignored_unknown");
  pass(
    "DI-08 — pause respected; late result reconciled by id; duplicate & unknown handled",
    "paused→no publish · late→reconciled · dup→already_published · unknown→ignored",
  );
}

/* ------------------------------------- UC-06 ext 4.a / 4.b — feedback gaps -- */

{
  // Two channels report nothing: one is not authorised, one has not reported yet.
  // The outcomes are declared rather than left to a modelled edge case, so this
  // scenario tests the requirement instead of a random campaign id.
  const s = await startAndClear(
    { channels: ["instagram", "web"], budget: 6000 },
    { collectorOverrides: { instagram: "not_authorised", web: "late" } },
  );
  await approveAndAdvance(s, "Go.");
  if (s.campaign.status === "scheduled") {
    await s.run({ type: "PUBLISH", actor: "founder" });
    await s.run({ type: "COLLECT_FEEDBACK", actor: "founder" });
    const report = s.campaign.performanceReport!;
    assert.ok(report, "a report must exist even when every channel is silent");
    const silent = report.results.filter((x) => !x.figures);
    assert.ok(silent.length > 0, "this scenario is meant to contain a silent channel");
    assert.ok(
      silent.every((x) => x.status === "not_authorised" || x.status === "late"),
      "a silent channel must be labelled, not guessed",
    );
    assert.ok(report.gaps.length >= silent.length, "every silent channel must appear in the gaps");
    assert.ok(
      report.summary.includes("Gaps:") || report.summary.includes("No selected channel"),
      "the summary must state the gap",
    );
    pass(
      "UC-06 ext 4.a/4.b — silent channels marked, never filled in",
      report.results.map((x) => `${x.channel}:${x.status}`).join(" "),
    );
  } else {
    throw new Error(`expected the campaign to reach Scheduled, got ${s.campaign.status}`);
  }
}

/* ---------------------------------------------- UC-06 step 12 — attachment -- */

{
  const { applySelectedFeedback, extractableInsights } = (await import(
    pathToFileURL(path.join(root, "src/lib/insights.ts")).href
  )) as typeof import("../src/lib/insights");
  const c = blankCampaign(baseInput, defaultBrand, null, settings);
  const withAccepted = {
    ...c,
    id: "cmp_commute",
    name: "Commuter parka",
    product: "Parka",
    status: "published" as const,
    performanceReport: {
      id: "pr1",
      at: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
      ranChannels: [],
      results: [],
      gaps: [],
      totals: null,
      summary: "",
      recommendationPoints: [
        { id: "rp1", verdict: "keep" as const, area: "creative_angle" as const, text: "Keep the commuting angle.", evidenceIds: [] },
      ],
      recommendationText: "Keep the commuting angle.",
      recommendationUnsupported: false,
    },
    recommendationDecision: {
      action: "accepted" as const,
      text: "Keep the commuting angle.",
      note: "",
      at: new Date().toISOString(),
      author: "Human Founder",
      attachedToCampaignId: null,
    },
  };
  const saved = extractableInsights(withAccepted);
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.text, "Keep the commuting angle.");
  assert.equal(extractableInsights({
    ...withAccepted,
    recommendationDecision: { ...withAccepted.recommendationDecision, action: "discarded" },
  }).length, 0, "a discarded recommendation is not offered again");

  const library = saved.map((insight) => ({ ...insight, id: "ins_commute", savedAt: new Date().toISOString() }));
  const next = blankCampaign(
    { ...baseInput, product: "Chicken breast fillet", name: "Chicken week" },
    defaultBrand,
    null,
    settings,
  );
  const untouched = applySelectedFeedback(next, library, [], [withAccepted]);
  assert.equal(untouched.sharedContext.previousPerformanceNote, null, "a new brief carries nothing until the founder ticks an insight");
  const chosen = applySelectedFeedback(next, library, ["ins_commute"], [withAccepted]);
  assert.match(chosen.sharedContext.previousPerformanceNote ?? "", /Keep the commuting angle\./);
  assert.match(chosen.sharedContext.previousPerformanceNote ?? "", /Parka/);
  assert.equal(chosen.sharedContext.previousPerformanceFrom, "cmp_commute");
  pass("UC-06 step 12 / ext 10.a — only a ticked, accepted insight travels forward", "discard respected; nothing is auto-attached");
}

/* ------------------------------------------------------------------ report -- */

console.log("\nAisle agent bench — scenario suite\n");
for (const r of results) console.log(`  ✓ ${r.name}\n      ${r.detail}`);
console.log(`\n${results.length} scenario groups passed.\n`);
