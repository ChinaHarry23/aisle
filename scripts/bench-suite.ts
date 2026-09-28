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
import { register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/* The app uses the `@/` alias, so a small resolver hook stands in for the bundler. */
const root = process.cwd();
const loader = `
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";
const root = ${JSON.stringify(root)};
function withTs(base) {
  for (const c of [base + ".ts", base + ".tsx", path.join(base, "index.ts")]) if (existsSync(c)) return c;
  return base;
}
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (error) {
    if (specifier.startsWith("@/")) return next(pathToFileURL(withTs(path.join(root, "src", specifier.slice(2)))).href, context);
    if (specifier.startsWith(".") && context.parentURL) {
      const dir = path.dirname(fileURLToPath(context.parentURL));
      return next(pathToFileURL(withTs(path.resolve(dir, specifier))).href, context);
    }
    throw error;
  }
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, pathToFileURL("./"));

const engineUrl = pathToFileURL(path.join(root, "src/lib/runtime/engine.ts")).href;
const seedUrl = pathToFileURL(path.join(root, "src/lib/seed.ts")).href;
const settingsUrl = pathToFileURL(path.join(root, "src/lib/settings.ts")).href;

const { runEngine } = (await import(engineUrl)) as typeof import("../src/lib/runtime/engine");
const { blankCampaign, defaultBrand } = (await import(seedUrl)) as typeof import("../src/lib/seed");
const { defaultSettings } = (await import(settingsUrl)) as typeof import("../src/lib/settings");

import type { Campaign, CampaignInput } from "../src/lib/types";
import type { Command } from "../src/lib/runtime/types";
import type { CompleteRequest, CompleteResult } from "../src/lib/llm/types";

const settings = defaultSettings();

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
    modelId: "openai:gpt-4.1-mini",
    modelName: "Offline",
    status: "unconfigured" as const,
    usage: usageStub(),
    text: null,
    note: "suite: deterministic path",
    at: new Date().toISOString(),
  }),
};

/**
 * A scripted "model" that answers each decision call with valid JSON.
 *
 * `onCreative` may return copy for a given revision, which is how the suite
 * drives the case the deterministic fallback cannot reach: a revision that is
 * still non-compliant, so all three AHR-04 attempts are spent and the case has
 * to escalate.
 */
function scriptedLlm(
  onCreative?: (revision: number) => { headline: string; subhead: string } | null,
): LlmStub {
  let revision = 0;
  return {
    request: async (req: CompleteRequest) => {
      let text: string | null = null;
      if (req.agent === "creative") {
        revision += 1;
        const over = onCreative?.(revision) ?? null;
        const variant = (n: "A" | "B") => ({
          variant: n,
          kicker: "Weekly",
          headline: n === "A" ? (over?.headline ?? "Olive oil, honestly described") : "Pantry staple",
          subhead: n === "A" ? (over?.subhead ?? "Cold-pressed, in store this week.") : "In store this week.",
          cta: "See the range",
          caption: "Lane & Co. grocery.",
          prompt: "studio poster",
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
        modelId: "openai:gpt-4.1-mini",
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
    ...blankCampaign({ ...baseInput, ...input }, defaultBrand, null, settings),
    ...campaignPatch,
  };
  const ctx = { campaigns: [campaign], now: new Date().toISOString() };

  async function run(command: Command) {
    const result = await runEngine(ctx, campaign, command, settings, defaultBrand, {
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
  const s = await startAndAdvance({ channels: ["instagram", "web", "email", "print"] });
  const c = s.campaign;
  assert.ok(c.evidence.length > 0, "the trend step must record evidence");
  assert.ok(
    c.trendFindings.some((f) => f.basis === "supported"),
    "at least one finding must cite a source",
  );
  assert.ok(c.trendGaps.length > 0, "limitations must be recorded");
  assert.ok(
    c.evidence.every((e) => e.sourceName && e.observedAt),
    "every evidence row needs a source and a date",
  );
  assert.ok(c.toolCalls.length > 0, "tool calls must be recorded");
  pass(
    "AHR-02 — sourced brief with labelled assumptions",
    `${c.evidence.length} evidence rows, ${c.trendFindings.filter((f) => f.basis === "supported").length} supported, ${c.trendGaps.length} limitations`,
  );
}

{
  const s = await startAndAdvance({ channels: ["web"] }, { internalDataAuthorised: false });
  const c = s.campaign;
  const exclusion = c.trendGaps.find((g) => g.kind === "unauthorised");
  assert.ok(exclusion, "unauthorised internal data must be recorded as a gap (UC-02 ext 4.b)");
  assert.ok(
    c.toolCalls.some((t) => t.tool === "retail.internal_signals" && t.status === "skipped"),
    "the internal tool must be skipped, not silently used",
  );
  pass("UC-02 ext 4.b — unauthorised internal data excluded", exclusion.detail);
}

/* --------------------------------------------- AHR-03/04 three-attempt loop */

{
  const s = await startAndAdvance({ channels: ["instagram", "web", "email", "print"], budget: 18000 });
  const c = s.campaign;
  const outcomes = c.complianceAttempts.map((a) => `${a.attempt}:v${a.creativeVersion}:${a.outcome}`);
  assert.equal(c.complianceAttempts.length, 2, `expected two attempts, got ${outcomes.join(" ")}`);
  assert.equal(c.complianceAttempts[0].outcome, "changes_required");
  assert.equal(c.complianceAttempts[1].outcome, "pass");
  assert.equal(c.creatives[0].version, 2, "the revision must be a new version, not a rerun of v1");
  assert.ok(
    c.complianceAttempts.every((a) => a.inputDigest.length > 0),
    "every submitted version needs a recorded input digest",
  );
  assert.ok(
    c.complianceAttempts[0].issues.some((i) => i.basis === "confirmed_breach"),
    "a banned claim must be recorded as a confirmed breach",
  );
  assert.ok(
    c.complianceAttempts[1].issues.some((i) => i.basis === "human_judgement"),
    "an item needing human judgement must be separated from a confirmed breach",
  );
  assert.equal(c.status, "awaiting_approval", "a pass must park at Awaiting Human Approval");
  assert.equal(c.creatives[0].status, "flagged");
  pass(
    "AHR-04 — revise then pass, versions and digests retained",
    outcomes.join(" → "),
  );
}

{
  // Every revision still carries a banned term, so the loop spends all three
  // attempts — the case AHR-04 says must escalate rather than retry forever.
  const s = await startAndAdvance(
    { channels: ["instagram"], budget: 18000, product: "Cold-pressed olive oil", category: "Pantry" },
    {},
    { llm: scriptedLlm(() => ({ headline: "Guaranteed best olive oil", subhead: "Risk-free pantry value." })) },
  );
  const c = s.campaign;
  const attempts = c.complianceAttempts;
  assert.equal(attempts.length, 3, `three attempts expected, got ${attempts.length}`);
  assert.equal(attempts.at(-1)?.outcome, "manual_review", "the third attempt must escalate");
  assert.equal(c.run?.awaiting, "approval");
  assert.match(c.run?.awaitingDetail ?? "", /three compliance attempts/i);
  assert.notEqual(c.status, "published", "an escalated campaign must never be published automatically");
  pass(
    "AHR-04 ext — three attempts then Manual Review Required",
    attempts.map((a) => `${a.attempt}:v${a.creativeVersion}:${a.outcome}`).join(" → "),
  );
}

/* ---------------------------------------------------- AHR-05 distribution -- */

{
  const s = await startAndAdvance({ channels: ["instagram", "web", "email", "print"], budget: 18000 });
  await s.run({ type: "APPROVE", actor: "founder", note: "Ship variant A." });
  let i = 0;
  let r = await s.run({ type: "ADVANCE", actor: "founder" });
  while ((r.canAdvance || s.campaign.run?.status === "running") && i++ < 8) {
    r = await s.run({ type: "ADVANCE", actor: "founder" });
  }
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
  assert.equal(s.campaign.spend.blockedAttempts, 5, "each refusal must be counted");
  assert.ok(
    s.campaign.log.some((e) => e.kind === "policy"),
    "a refusal must reach the campaign log (ext 13.a)",
  );
  pass("UC-01 ext 13.a — five agent attempts refused and logged", Object.values(blocked).join(", "));
}

/* -------------------------------------------- publish + AHR-06 feedback ---- */

{
  const s = await startAndAdvance({ channels: ["instagram", "web", "email"], budget: 12000 });
  await s.run({ type: "APPROVE", actor: "founder", note: "Go." });
  let i = 0;
  let r = await s.run({ type: "ADVANCE", actor: "founder" });
  while ((r.canAdvance || s.campaign.run?.status === "running") && i++ < 8) {
    r = await s.run({ type: "ADVANCE", actor: "founder" });
  }

  // The bench must stop at Scheduled: an agent may not publish.
  assert.equal(s.campaign.status, "scheduled", "the run must stop at Scheduled");
  const agentPublish = await s.run({ type: "ATTEMPT_BLOCKED", actor: "PUBLISH_CONTENT" });
  assert.equal(s.campaign.policyDecisions.at(-1)?.verdict, "block");
  void agentPublish;

  const published = await s.run({ type: "PUBLISH", actor: "founder" });
  assert.equal(s.campaign.status, "published", `publish failed: ${published.message}`);
  assert.equal(s.campaign.run?.step, "feedback.collect");

  const collected = await s.run({ type: "COLLECT_FEEDBACK", actor: "founder" });
  const report = s.campaign.performanceReport;
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

/* ------------------------------------- UC-06 ext 4.a / 4.b — feedback gaps -- */

{
  // Two channels report nothing: one is not authorised, one has not reported yet.
  // The outcomes are declared rather than left to a modelled edge case, so this
  // scenario tests the requirement instead of a random campaign id.
  const s = await startAndAdvance(
    { channels: ["print", "digital_signage"], budget: 6000 },
    { collectorOverrides: { print: "not_authorised", digital_signage: "late" } },
  );
  await s.run({ type: "APPROVE", actor: "founder", note: "Go." });
  let i = 0;
  let r = await s.run({ type: "ADVANCE", actor: "founder" });
  while ((r.canAdvance || s.campaign.run?.status === "running") && i++ < 8) {
    r = await s.run({ type: "ADVANCE", actor: "founder" });
  }
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
  const { attachableRecommendation } = (await import(
    pathToFileURL(path.join(root, "src/lib/runtime/defaults.ts")).href
  )) as typeof import("../src/lib/runtime/defaults");
  const c = blankCampaign(baseInput, defaultBrand, null, settings);
  const withAccepted = {
    ...c,
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
      recommendationPoints: [],
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
  const attached = attachableRecommendation([withAccepted]);
  assert.equal(attached?.note, "Keep the commuting angle.");

  const discarded = attachableRecommendation([
    { ...withAccepted, recommendationDecision: { ...withAccepted.recommendationDecision, action: "discarded" } },
  ]);
  assert.equal(discarded, null, "a discarded recommendation must never be attached (UC-06 ext 10.a)");
  pass("UC-06 step 12 / ext 10.a — only accepted or edited notes travel forward", "discard respected");
}

/* ------------------------------------------------------------------ report -- */

console.log("\nAisle agent bench — scenario suite\n");
for (const r of results) console.log(`  ✓ ${r.name}\n      ${r.detail}`);
console.log(`\n${results.length} scenario groups passed.\n`);
