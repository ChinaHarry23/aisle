/**
 * Offline test suite for the Conversational Intake Assistant (AHR-01 / UC-01 · CE-08 / SCRUM-122).
 *
 * Verifies:
 *  1. `intake` seat in `src/lib/agents/seats.ts` runs through `MeteredChatModel` and calls
 *     `brand_profile` + `intake_validate` tools.
 *  2. Asks for missing budget/channels/dates rather than inventing them (`UC-01 step 6`).
 *  3. Refuses a founder prompt that asks the assistant to launch or publish (`UC-01 step 9 / 13`).
 *  4. Stops at the 12-turn conversation cap (`MAX_INTAKE_TURNS`) with a "finish in the form" message.
 *  5. Scrubs brand banned terms (`brand.bannedTerms`) from proposed campaign names, notes, and replies.
 *  6. Marks assistant-drafted notes with `ASSISTANT_NOTE_PREFIX` and keeps field provenance (`fieldSources`) on the intake draft.
 *
 *   npm run test:intake
 */

import assert from "node:assert/strict";
import {
  ASSISTANT_NOTE_PREFIX,
  MAX_INTAKE_TURNS,
  emptyIntakeDraft,
  runIntakeTurn,
  toCampaignInput,
} from "../src/lib/intake/assistant";
import { LOCAL_DEFAULT_LLM } from "../src/lib/pr2-shims";
import type { CompleteRequest, CompleteResult } from "../src/lib/llm/types";
import { blankCampaign, defaultBrand } from "../src/lib/seed";
import { defaultSettings } from "../src/lib/settings";

let checks = 0;
const pass = (label: string) => {
  checks++;
  console.log(`PASS ${label}`);
};

const settings = defaultSettings();

/** Helper that builds a scripted `complete` function for `MeteredChatModel`. */
function makeScriptedComplete(
  handler: (req: CompleteRequest, callIndex: number) => {
    text?: string | null;
    toolCalls?: CompleteResult["toolCalls"];
    status?: CompleteResult["status"];
  },
) {
  let callIndex = 0;
  return async (req: CompleteRequest): Promise<CompleteResult> => {
    callIndex += 1;
    const out = handler(req, callIndex);
    return {
      provider: "Local",
      providerId: "local",
      modelId: LOCAL_DEFAULT_LLM,
      modelName: "Qwen3.8 Flash-Next",
      status: out.status ?? "ok",
      usage: {
        inputTokens: 120,
        outputTokens: 60,
        totalTokens: 180,
        costUsd: 0.0018,
        billedAs: "scripted intake call",
        estimate: false,
        latencyMs: 5,
      },
      text: out.text ?? null,
      ...(out.toolCalls ? { toolCalls: out.toolCalls } : {}),
      note: "scripted intake turn",
      at: new Date().toISOString(),
    };
  };
}

/* --- 1. Asks for missing budget rather than inventing it, calling tools & filtering banned terms --- */
{
  const complete = makeScriptedComplete((req, call) => {
    if (call === 1) {
      return {
        text: "",
        toolCalls: [
          { id: "call_brand", name: "brand_profile", args: { country: "AU" } },
          { id: "call_val", name: "intake_validate", args: { check: "current" } },
        ],
      };
    }
    return {
      text: JSON.stringify({
        reply:
          "Great — let's build Australia's best citrus campaign! What is your campaign budget in AUD?",
        missingField: "budget",
        options: ["$5,000", "$10,000", "Guaranteed $15,000"],
        draftPatch: {
          name: "Australia's best Spring Citrus Week",
          product: "Navel oranges + cold-pressed juice",
          category: "Grocery",
          targetAudience: "Inner-west Sydney families, 28–45",
          objective: "Lift weekend basket attach and store visits",
          notes: "Highlight orchard provenance and guaranteed freshness.",
        },
        readyToReview: false,
      }),
    };
  });

  const turn = await runIntakeTurn({
    messages: [
      {
        role: "user",
        content:
          "We want to promote navel oranges + cold-pressed juice to inner-west Sydney families, 28–45, to lift weekend basket attach.",
      },
    ],
    draft: emptyIntakeDraft(),
    brand: defaultBrand,
    settings,
    complete,
  });

  assert.equal(turn.trace.path, "live_model", "intake seat ran on the scripted model");
  assert(turn.usedTools.includes("brand.profile"), "agent called brand.profile tool");
  assert(turn.usedTools.includes("intake.validate"), "agent called intake.validate tool");
  assert.equal(turn.draft.budget, 0, "budget was NEVER invented by the model");
  assert.equal(turn.draft.channels.length, 0, "channels were NEVER invented by the model");
  assert.equal(turn.draft.startDate, "", "startDate was NEVER invented by the model");
  assert.equal(turn.missingField, "budget", "assistant asks for the missing budget next");
  assert.equal(turn.readyToReview, false, "draft is not ready while budget/channels/dates are missing");

  // Banned-term filter check ("Australia's best" and "guaranteed" are in defaultBrand.bannedTerms)
  assert(
    !turn.draft.name.toLowerCase().includes("australia's best"),
    `banned term stripped from campaign name: "${turn.draft.name}"`,
  );
  assert(
    !turn.reply.toLowerCase().includes("australia's best"),
    `banned term stripped from assistant reply: "${turn.reply}"`,
  );
  assert(
    turn.options.every((opt) => !opt.toLowerCase().includes("guaranteed")),
    "banned term stripped from suggested options",
  );
  assert(
    turn.filteredBannedTerms.length >= 2,
    `caught banned terms recorded (${turn.filteredBannedTerms.join(", ")})`,
  );

  // Assistant-drafted notes carry the unconfirmed prefix so downstream seats never treat them as founder facts.
  assert(
    turn.draft.notes.startsWith(ASSISTANT_NOTE_PREFIX.trim()),
    `assistant notes prefixed: "${turn.draft.notes}"`,
  );
  assert.equal(turn.draft.fieldSources.name, "assistant");
  assert.equal(turn.draft.fieldSources.notes, "assistant");
  pass("intake seat calls brand.profile + intake.validate, never invents budget/channels/dates, filters banned terms, and prefixes assistant notes");
}

/* --- 2. Refuses a prompt that asks it to launch or publish --- */
{
  const complete = makeScriptedComplete(() => ({
    text: JSON.stringify({
      reply: "Sure, I will prepare the draft.",
      missingField: "budget",
      options: ["$5,000", "$8,000"],
      readyToReview: false,
    }),
  }));

  const turn = await runIntakeTurn({
    messages: [
      {
        role: "user",
        content: "Promote our Trail Parka and launch the campaign right now!",
      },
    ],
    draft: emptyIntakeDraft(),
    brand: defaultBrand,
    settings,
    complete,
  });

  assert.equal(turn.refusedCommand, true, "detected forbidden launch request");
  assert.match(
    turn.reply,
    /cannot launch|only the Human Founder|Launch agents/i,
    "reply explicitly refuses to launch and directs founder to the form button",
  );
  pass("refuses a prompt that asks the intake assistant to launch or publish");
}

/* --- 3. Multi-turn completion with founder-supplied budget, channels, and dates → valid CampaignInput --- */
{
  const complete = makeScriptedComplete(() => ({
    text: JSON.stringify({
      reply: "All required fields are valid. Ready to review in the form!",
      missingField: "none",
      options: [],
      readyToReview: true,
    }),
  }));

  const turn = await runIntakeTurn({
    messages: [
      {
        role: "user",
        content:
          "Budget is $12,000 on Instagram, Website and Email from 2026-10-19 to 2026-11-01 in AU.",
      },
    ],
    draft: {
      ...emptyIntakeDraft(),
      name: "Lane & Co. — Navel oranges",
      product: "Navel oranges + cold-pressed juice",
      category: "Grocery",
      targetAudience: "Inner-west Sydney households, 28–45",
      objective: "Lift weekend catalogue engagement and basket attach",
      fieldSources: {
        name: "assistant",
        product: "founder",
        category: "founder",
        targetAudience: "founder",
        objective: "founder",
      },
    },
    brand: defaultBrand,
    settings,
    complete,
  });

  assert.equal(turn.draft.budget, 12000, "extracted founder budget $12,000");
  assert.deepEqual(
    turn.draft.channels.sort(),
    ["email", "instagram", "web"],
    "extracted founder channels",
  );
  assert.equal(turn.draft.startDate, "2026-10-19");
  assert.equal(turn.draft.endDate, "2026-11-01");
  assert.equal(turn.draft.country, "AU");
  assert.equal(turn.draft.fieldSources.budget, "founder");
  assert.equal(turn.draft.fieldSources.channels, "founder");
  assert.equal(turn.draft.fieldSources.startDate, "founder");
  assert.equal(turn.problems.length, 0, "validateIntake returns 0 problems");
  assert.equal(turn.readyToReview, true);

  const input = toCampaignInput(turn.draft);
  const campaign = blankCampaign(input, defaultBrand, null, settings);
  assert.equal(campaign.product, turn.draft.product);
  assert.equal(campaign.budget, turn.draft.budget);
  assert.equal(turn.draft.fieldSources?.name, "assistant");
  assert.equal(turn.draft.fieldSources?.budget, "founder");
  pass("completes draft when founder supplies budget, channels, and dates; provenance stays on the intake draft (Cindy's CampaignInput has no fieldSources)");
}

/* --- 4. Stops at the 12-turn conversation cap --- */
{
  const twelveUserMessages = Array.from({ length: MAX_INTAKE_TURNS }, (_, i) => ({
    role: "user" as const,
    content: `Turn ${i + 1}: still thinking about navel oranges`,
  }));

  let modelCalled = false;
  const complete = makeScriptedComplete(() => {
    modelCalled = true;
    return { text: "{}" };
  });

  const turn = await runIntakeTurn({
    messages: twelveUserMessages,
    draft: emptyIntakeDraft(),
    brand: defaultBrand,
    settings,
    complete,
  });

  assert.equal(turn.turnCapReached, true, "turnCapReached is true at 12 user turns");
  assert.equal(modelCalled, false, "no model call is made once the turn cap is reached");
  assert.match(turn.reply, /12-turn|form/i, "tells the founder to finish in the form");
  pass(`stops at the ${MAX_INTAKE_TURNS}-turn conversation cap without making further model calls`);
}

/* --- 5. Deterministic fallback when no model is available --- */
{
  const unavailableComplete = async (): Promise<CompleteResult> => ({
    provider: "Local",
    providerId: "local",
    modelId: LOCAL_DEFAULT_LLM,
    modelName: "Qwen3.8 Flash-Next",
    status: "unconfigured",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      billedAs: "not called",
      estimate: true,
      latencyMs: 0,
    },
    text: null,
    note: "No local model is answering.",
    at: new Date().toISOString(),
  });

  const turn = await runIntakeTurn({
    messages: [{ role: "user", content: "Promote single-origin coffee beans" }],
    draft: emptyIntakeDraft(),
    brand: defaultBrand,
    settings,
    complete: unavailableComplete,
  });

  assert.equal(turn.trace.path, "deterministic_fallback");
  assert.equal(turn.draft.product, "single-origin coffee beans");
  assert.equal(turn.missingField, "targetAudience");
  assert(turn.options.length > 0 && turn.options.length <= 3);
  pass("degrades cleanly to deterministic interview questions when no model is available");
}

console.log(`\n${checks} intake checks passed.\n`);
