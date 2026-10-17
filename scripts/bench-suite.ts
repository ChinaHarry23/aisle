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
    modelId: "openai:gpt-6-luna",
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

/* ----------------------------------- UC-05 ext 6.a — publish retry/reconcile */

{
  // The declared publish path drives the three cases UC-05 ext 6.a names without
  // a random seed: a clean confirm, a retry inside the cap, and a late result
  // that must be reconciled to the same item id rather than resubmitted.
  const s = await startAndAdvance(
    { channels: ["web", "email", "print"], budget: 12000 },
    { publishOverrides: { web: "retry_then_ok", email: "late", print: "ok" } },
  );
  await s.run({ type: "APPROVE", actor: "founder", note: "Go." });
  let i = 0;
  let r = await s.run({ type: "ADVANCE", actor: "founder" });
  while ((r.canAdvance || s.campaign.run?.status === "running") && i++ < 8) {
    r = await s.run({ type: "ADVANCE", actor: "founder" });
  }
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
  const s = await startAndAdvance(
    { channels: ["web", "email", "print"], budget: 12000 },
    { publishOverrides: { web: "fail" } },
  );
  await s.run({ type: "APPROVE", actor: "founder", note: "Go." });
  let i = 0;
  let r = await s.run({ type: "ADVANCE", actor: "founder" });
  while ((r.canAdvance || s.campaign.run?.status === "running") && i++ < 8) {
    r = await s.run({ type: "ADVANCE", actor: "founder" });
  }
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

  const collected = await s.run({ type: "COLLECT_FEEDBACK", actor: "founder" });
  assert.ok(!s.campaign.performanceReport, "results cannot be collected before delivery completes");
  void collected;
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

  const s = await startAndAdvance(
    { channels: ["web", "email", "print"], budget: 12000 },
    {},
    { llm: captionLlm },
  );
  await s.run({ type: "APPROVE", actor: "founder", note: "Go." });
  let i = 0;
  let r = await s.run({ type: "ADVANCE", actor: "founder" });
  while ((r.canAdvance || s.campaign.run?.status === "running") && i++ < 8) {
    r = await s.run({ type: "ADVANCE", actor: "founder" });
  }
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
