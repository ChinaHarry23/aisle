/**
 * Conversational intake assistant (AHR-01 / UC-01 · CE-08 / SCRUM-122).
 *
 * Interviews the Human Founder in chatbot fashion and builds a validated
 * `CampaignInput` draft for review in `/campaigns/new`.
 *
 * Product guarantees enforced here regardless of what the LLM says:
 *  1. **No command authority.** The assistant has two read-only tools
 *     (`brand_profile` and `intake_validate`). It cannot create a campaign,
 *     issue `START`, approve, publish, or spend beyond its own metered turns.
 *  2. **Founder-only scope fields (`UC-01 step 6`).** Budget, campaign dates,
 *     country, and distribution channels are NEVER invented or auto-filled by
 *     the model — they only change when the founder explicitly states them.
 *  3. **Banned-terms filter (`UC-01 step 5`).** Every suggested text field and
 *     assistant reply is scrubbed against `brand.bannedTerms`.
 *  4. **Provenance & unconfirmed notes.** Fields drafted by the assistant carry
 *     `fieldSources[field] = "assistant"`. Any text the assistant writes into
 *     `notes` is prefixed with `ASSISTANT_NOTE_PREFIX` until the founder edits
 *     or confirms it, so a model-written sentence is never mistaken for a
 *     founder-confirmed fact downstream.
 *  5. **Turn ceiling (`MAX_INTAKE_TURNS = 12`).** Stops after 12 turns with a
 *     clear "finish in the form" message.
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { buildAgent, intakeTurnSchema } from "@/lib/agents/seats";
import { MeteredChatModel } from "@/lib/agents/metered-chat-model";
import type { BillingContext } from "@/lib/billing/meter";
import { uid } from "@/lib/ids";
import { getLlmOrDefault } from "@/lib/llm/catalog";
import { runComplete } from "@/lib/llm/metered-complete";
import type { CompleteRequest, CompleteResult } from "@/lib/llm/types";
import {
  CHANNELS,
  COUNTRIES,
  validateIntake,
} from "@/lib/runtime/intake";
import { makeLog } from "@/lib/seed";
import type { WorkspaceSettings } from "@/lib/settings";
import type { AgentEvent, BrandProfile, CampaignInput, Channel, Country } from "@/lib/types";
import {
  ASSISTANT_NOTE_PREFIX,
  MAX_INTAKE_TURNS,
  emptyIntakeDraft,
  optionsForMissingField,
  type IntakeChatMessage,
  type IntakeDraftState,
  type IntakeFieldSources,
  type IntakeTurnOutput,
} from "./shared";

export {
  ASSISTANT_NOTE_PREFIX,
  MAX_INTAKE_TURNS,
  emptyIntakeDraft,
  optionsForMissingField,
  type IntakeChatMessage,
  type IntakeDraftState,
  type IntakeTurnOutput,
};

export type IntakeTurnInput = {
  messages: IntakeChatMessage[];
  draft: Partial<IntakeDraftState>;
  brand: BrandProfile;
  settings: WorkspaceSettings;
  priorRecommendation?: { note: string; fromCampaignId: string; fromCampaignName: string } | null;
  billing?: BillingContext;
  /** Optional injected completion function for offline deterministic/fake-provider tests. */
  complete?: (req: CompleteRequest, billing: BillingContext | undefined) => Promise<CompleteResult>;
};

const VALID_CATEGORIES = ["Grocery", "Apparel", "Pantry", "Home", "Beauty"] as const;

export function normaliseDraft(partial?: Partial<IntakeDraftState>): IntakeDraftState {
  const base = emptyIntakeDraft();
  if (!partial) return base;
  return {
    name: typeof partial.name === "string" ? partial.name.slice(0, 140) : base.name,
    product: typeof partial.product === "string" ? partial.product.slice(0, 180) : base.product,
    category:
      typeof partial.category === "string" && partial.category.trim()
        ? partial.category.trim().slice(0, 60)
        : base.category,
    targetAudience:
      typeof partial.targetAudience === "string"
        ? partial.targetAudience.slice(0, 200)
        : base.targetAudience,
    objective:
      typeof partial.objective === "string" ? partial.objective.slice(0, 240) : base.objective,
    budget:
      typeof partial.budget === "number" && Number.isFinite(partial.budget) && partial.budget >= 0
        ? partial.budget
        : base.budget,
    channels: Array.isArray(partial.channels)
      ? partial.channels.filter((c): c is Channel => (CHANNELS as string[]).includes(c))
      : base.channels,
    startDate: typeof partial.startDate === "string" ? partial.startDate.slice(0, 10) : base.startDate,
    endDate: typeof partial.endDate === "string" ? partial.endDate.slice(0, 10) : base.endDate,
    country:
      typeof partial.country === "string" && (COUNTRIES as string[]).includes(partial.country)
        ? (partial.country as Country)
        : base.country,
    notes: typeof partial.notes === "string" ? partial.notes.slice(0, 2000) : base.notes,
    fieldSources: { ...(partial.fieldSources ?? {}) },
  };
}

/** Detect if the founder is asking the intake assistant to execute a command it is forbidden from running. */
export function detectForbiddenCommandRequest(message: string): boolean {
  const lower = message.toLowerCase();
  return /\b(launch\s+(?:the\s+)?(?:campaign|agents|pipeline|now|it)|start\s+(?:the\s+)?pipeline|publish\s+(?:the\s+)?(?:campaign|it|now)|approve\s+(?:the\s+)?(?:campaign|ad|creative))\b/i.test(
    lower,
  );
}

/**
 * Extract founder-supplied scope fields (`budget`, `channels`, `startDate`,
 * `endDate`, `country`) and clear free-text answers directly from the founder's
 * message. Only values present in the founder's own text are marked `"founder"`.
 */
export function extractFounderEntries(
  message: string,
  current: IntakeDraftState,
  lastAskedField?: string,
): { draft: IntakeDraftState; updatedFields: (keyof IntakeFieldSources)[] } {
  const next: IntakeDraftState = {
    ...current,
    channels: [...current.channels],
    fieldSources: { ...current.fieldSources },
  };
  const updated: (keyof IntakeFieldSources)[] = [];
  const text = message.trim();
  if (!text) return { draft: next, updatedFields: updated };

  // 1. Budget (e.g., "$12,000", "12k", "budget 8000", "AUD 15000", or bare number when asked for budget)
  const kMatch = text.match(
    /(?:\$|aud\s*|usd\s*|budget(?:\s+is)?[:\s]+)\s*\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/i,
  );
  const suffixK = text.match(/\b(\d[\d,]*(?:\.\d+)?)\s*k\b/i);
  const bareNum =
    lastAskedField === "budget" ? text.match(/^\s*\$?\s*(\d[\d,]*(?:\.\d+)?)\s*$/) : null;
  if (kMatch) {
    const base = Number(kMatch[1].replace(/,/g, ""));
    const amount = kMatch[2] ? Math.round(base * 1000) : Math.round(base);
    if (Number.isFinite(amount) && amount > 0) {
      next.budget = amount;
      next.fieldSources.budget = "founder";
      updated.push("budget");
    }
  } else if (suffixK) {
    const amount = Math.round(Number(suffixK[1].replace(/,/g, "")) * 1000);
    if (Number.isFinite(amount) && amount > 0) {
      next.budget = amount;
      next.fieldSources.budget = "founder";
      updated.push("budget");
    }
  } else if (bareNum) {
    const amount = Math.round(Number(bareNum[1].replace(/,/g, "")));
    if (Number.isFinite(amount) && amount > 0) {
      next.budget = amount;
      next.fieldSources.budget = "founder";
      updated.push("budget");
    }
  }

  // 2. Channels (only when explicitly mentioned by the founder)
  const channelPatterns: [Channel, RegExp][] = [
    ["instagram", /\b(instagram|insta|ig)\b/i],
    ["web", /\b(website|web\b|homepage|online store)\b/i],
    ["email", /\b(email|newsletter|edm|inbox)\b/i],
    ["print", /\b(print|catalogue|catalog|flyer|circular)\b/i],
    ["digital_signage", /\b(digital[_\s-]?signage|in-store signage|signage|screens)\b/i],
  ];
  const mentionedChannels: Channel[] = [];
  for (const [ch, regex] of channelPatterns) {
    if (regex.test(text)) mentionedChannels.push(ch);
  }
  if (/\ball\s+channels\b/i.test(text)) {
    next.channels = [...CHANNELS];
    next.fieldSources.channels = "founder";
    updated.push("channels");
  } else if (mentionedChannels.length > 0) {
    const merged = Array.from(new Set([...next.channels, ...mentionedChannels]));
    next.channels = merged;
    next.fieldSources.channels = "founder";
    updated.push("channels");
  }

  // 3. Dates (YYYY-MM-DD)
  const isoDates = [...text.matchAll(/\b(202\d-\d{2}-\d{2})\b/g)].map((m) => m[1]);
  if (isoDates.length >= 2) {
    next.startDate = isoDates[0];
    next.endDate = isoDates[1];
    next.fieldSources.startDate = "founder";
    next.fieldSources.endDate = "founder";
    updated.push("startDate", "endDate");
  } else if (isoDates.length === 1) {
    if (!next.startDate) {
      next.startDate = isoDates[0];
      next.fieldSources.startDate = "founder";
      updated.push("startDate");
    } else if (!next.endDate) {
      next.endDate = isoDates[0];
      next.fieldSources.endDate = "founder";
      updated.push("endDate");
    }
  }

  // 4. Country (AU, NZ, UK, US)
  const countryPatterns: [Country, RegExp][] = [
    ["AU", /\b(AU|Australia|Australian)\b/i],
    ["NZ", /\b(NZ|New Zealand)\b/i],
    ["UK", /\b(UK|United Kingdom|Britain|British)\b/i],
    ["US", /\b(US|USA|United States)\b/i],
  ];
  for (const [code, regex] of countryPatterns) {
    if (regex.test(text)) {
      next.country = code;
      next.fieldSources.country = "founder";
      updated.push("country");
      break;
    }
  }

  // 5. Category
  for (const cat of VALID_CATEGORIES) {
    if (new RegExp(`\\b${cat}\\b`, "i").test(text)) {
      next.category = cat;
      next.fieldSources.category = "founder";
      updated.push("category");
      break;
    }
  }

  // 6. Direct field responses or structured one-line briefs
  const cleanPhrase = (s: string) => s.replace(/^[\s:,-]+|[\s.,;]+$/g, "").trim();

  if (lastAskedField === "product" && !next.product && text.length >= 3 && !/^\d+$/.test(text)) {
    const stripped = cleanPhrase(
      text.replace(
        /^(?:we\s+want\s+to\s+|i\s+want\s+to\s+)?(?:promote|promoting|campaign\s+for|selling|feature|featuring|product\s+is)\s+/i,
        "",
      ),
    );
    next.product = (stripped.length >= 3 ? stripped : cleanPhrase(text)).slice(0, 140);
    next.fieldSources.product = "founder";
    updated.push("product");
  } else if (
    lastAskedField === "targetAudience" &&
    !next.targetAudience &&
    text.length >= 3 &&
    !/^\d+$/.test(text)
  ) {
    next.targetAudience = cleanPhrase(text).slice(0, 180);
    next.fieldSources.targetAudience = "founder";
    updated.push("targetAudience");
  } else if (
    lastAskedField === "objective" &&
    !next.objective &&
    text.length >= 3 &&
    !/^\d+$/.test(text)
  ) {
    next.objective = cleanPhrase(text).slice(0, 200);
    next.fieldSources.objective = "founder";
    updated.push("objective");
  } else if (lastAskedField === "name" && !next.name && text.length >= 3) {
    next.name = cleanPhrase(text).slice(0, 120);
    next.fieldSources.name = "founder";
    updated.push("name");
  }

  // Heuristic extraction from rich multi-clause founder messages (e.g. "Promote navel oranges to inner-west families to lift weekend basket attach")
  if (!next.product) {
    const prodMatch =
      text.match(
        /(?:promote|promoting|campaign\s+for|selling|feature|featuring|product\s+is|for\s+our)\s+([^.,;]+?)(?=\s+(?:to|for|aimed\s+at|targeting|with\s+a\s+budget|on\s+instagram|in\s+AU|$)|[.,;]|$)/i,
      ) ??
      (!lastAskedField && text.length >= 4 && text.length <= 90 && !/\b(hi|hello|help)\b/i.test(text)
        ? [text, text]
        : null);
    if (prodMatch?.[1] && prodMatch[1].trim().length >= 3) {
      next.product = cleanPhrase(prodMatch[1]).slice(0, 140);
      next.fieldSources.product = "founder";
      updated.push("product");
    }
  }

  if (!next.targetAudience) {
    const audMatch = text.match(
      /(?:target(?:ing)?\s+audience(?:\s+is)?|aimed\s+at|targeting|for\s+shoppers|to\s+reach|for)\s+([^.,;]+?(?:shoppers|families|students|households|commuters|buyers|customers|parents|runners|readers|2\d[-–]\d\d|18[-–]\d\d)[^.,;]*)/i,
    );
    if (audMatch?.[1] && audMatch[1].trim().length >= 3) {
      next.targetAudience = cleanPhrase(audMatch[1]).slice(0, 180);
      next.fieldSources.targetAudience = "founder";
      updated.push("targetAudience");
    }
  }

  if (!next.objective) {
    const objMatch = text.match(
      /(?:objective\s+is\s+to|goal\s+is\s+to|to\s+(?:lift|drive|increase|boost|grow|build|move)\s+[^.,;]+)/i,
    );
    if (objMatch?.[0]) {
      const cleaned = cleanPhrase(
        objMatch[0].replace(/^(?:objective\s+is\s+to|goal\s+is\s+to|to)\s+/i, ""),
      );
      if (cleaned.length >= 3) {
        next.objective = (cleaned[0].toUpperCase() + cleaned.slice(1)).slice(0, 200);
        next.fieldSources.objective = "founder";
        updated.push("objective");
      }
    }
  }

  return { draft: next, updatedFields: updated };
}

/** Scrub any banned terms from assistant-proposed text and return the list of terms caught. */
export function filterBannedTerms(
  text: string,
  brand: BrandProfile,
): { cleaned: string; caught: string[] } {
  let cleaned = text;
  const caught: string[] = [];
  for (const term of brand.bannedTerms ?? []) {
    const trimmed = term.trim();
    if (!trimmed) continue;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "gi");
    if (regex.test(cleaned)) {
      caught.push(trimmed);
      cleaned = cleaned.replace(regex, "").replace(/\s{2,}/g, " ").trim();
    }
  }
  return { cleaned, caught };
}

/** Determine which required field is still missing, in logical interview order. */
export function nextMissingField(
  draft: IntakeDraftState,
  brand: BrandProfile,
): IntakeTurnOutput["missingField"] {
  if (!draft.product || draft.product.trim().length < 3) return "product";
  if (!draft.targetAudience || draft.targetAudience.trim().length < 3) return "targetAudience";
  if (!draft.objective || draft.objective.trim().length < 3) return "objective";
  if (!Number.isFinite(draft.budget) || draft.budget <= 0 || draft.budget > 5_000_000) return "budget";
  if (!Array.isArray(draft.channels) || draft.channels.length === 0) return "channels";
  const problems = validateIntake(draft, brand);
  if (problems.some((p) => p.field === "startDate" || p.field === "endDate")) return "dates";
  if (problems.some((p) => p.field === "country")) return "country";
  if (problems.length > 0) return "product";
  return "none";
}

/** Deterministic question generator when no live model is available or as a safety net. */
export function deterministicIntakeTurn(
  draft: IntakeDraftState,
  brand: BrandProfile,
  refusedCommand: boolean,
): {
  reply: string;
  missingField: IntakeTurnOutput["missingField"];
  options: string[];
  readyToReview: boolean;
} {
  const missing = nextMissingField(draft, brand);
  const prefix = refusedCommand
    ? "I can only assemble and validate the campaign brief — I cannot launch the pipeline, approve ads, or publish. Once the brief is ready, click “Launch agents” in the form. "
    : "";

  if (missing === "none") {
    return {
      reply: `${prefix}Your campaign brief for “${draft.name}” (${draft.product}) passes all UC-01 intake checks ($${draft.budget.toLocaleString("en-AU")}, ${draft.channels.join(", ")}, ${draft.startDate} → ${draft.endDate}, ${draft.country}). Review the populated form below and click “Launch agents” when you are ready.`,
      missingField: "none",
      options: [],
      readyToReview: true,
    };
  }

  const questions: Record<Exclude<IntakeTurnOutput["missingField"], "none">, string> = {
    product: `What product or seasonal line are we promoting for ${brand.retailerName} this cycle?`,
    category: `Which category does ${draft.product || "this product"} sit under (Grocery, Apparel, Pantry, Home, or Beauty)?`,
    targetAudience: `Got it (${draft.product}). Who is the target audience for this campaign?`,
    objective: `What is the primary campaign objective for ${draft.product} with ${draft.targetAudience}?`,
    budget: `What is your campaign budget (in AUD)? As a guardrail (UC-01 step 6), I never guess or auto-fill budget.`,
    channels: `Which distribution channels should carry this campaign (Instagram, Website, Email, Print catalogue, In-store signage)?`,
    dates: `What are the campaign start and end dates (YYYY-MM-DD to YYYY-MM-DD, up to 365 days)?`,
    country: `Which market's advertising law applies to this campaign (AU, NZ, UK, or US)?`,
  };

  return {
    reply: `${prefix}${questions[missing]}`,
    missingField: missing,
    options: optionsForMissingField(missing, draft).slice(0, 3),
    readyToReview: false,
  };
}

/**
 * Run one turn of the conversational intake assistant (`intake` LangChain seat).
 */
export async function runIntakeTurn(input: IntakeTurnInput): Promise<IntakeTurnOutput> {
  const now = new Date().toISOString();
  const userTurns = input.messages.filter((m) => m.role === "user");
  const turnCount = userTurns.length;
  const lastUserMessage = userTurns.at(-1)?.content ?? "";
  const refusedCommand = detectForbiddenCommandRequest(lastUserMessage);

  // Determine what the assistant asked about in its previous message so short answers ("8000", "Household shoppers") map cleanly.
  const prevMissing = nextMissingField(normaliseDraft(input.draft), input.brand);
  const { draft: extractedDraft } = extractFounderEntries(
    lastUserMessage,
    normaliseDraft(input.draft),
    prevMissing === "none" ? undefined : prevMissing,
  );
  const draft = extractedDraft;
  const caughtBanned: string[] = [];

  // Auto-propose a clean campaign name if product is known and name is still blank.
  if (draft.product && (!draft.name || draft.name.trim().length < 3)) {
    const rawName = `${input.brand.retailerName} — ${draft.product.slice(0, 48)}`;
    const filtered = filterBannedTerms(rawName, input.brand);
    caughtBanned.push(...filtered.caught);
    draft.name = filtered.cleaned.length >= 3 ? filtered.cleaned : `Campaign — ${draft.product.slice(0, 48)}`;
    draft.fieldSources.name = "assistant";
  }

  // Enforce the 12-turn conversation cap (CE-08).
  if (turnCount >= MAX_INTAKE_TURNS) {
    const problems = validateIntake(draft, input.brand);
    const reply =
      "We have reached the 12-turn intake conversation limit. Please review and finish any remaining fields directly in the campaign form below, then click “Launch agents”.";
    return {
      reply,
      draft,
      problems,
      missingField: nextMissingField(draft, input.brand),
      options: [],
      readyToReview: problems.length === 0,
      turnCount,
      turnCapReached: true,
      refusedCommand,
      filteredBannedTerms: caughtBanned,
      usedTools: [],
      logEvents: [
        makeLog(
          "intake",
          "intake",
          "Intake assistant turn limit reached",
          `Stopped at ${turnCount}/${MAX_INTAKE_TURNS} turns; handed draft to the form.`,
          now,
        ),
      ],
      trace: {
        modelId: input.settings.agents.trend.modelId,
        modelName: getLlmOrDefault(input.settings.agents.trend.modelId).name,
        path: "deterministic_fallback",
        status: "stubbed",
        costUsd: 0,
        totalTokens: 0,
        calls: 0,
        note: `Stopped at the ${MAX_INTAKE_TURNS}-turn conversation cap.`,
      },
    };
  }

  // Build the two read-only tools for the `intake` LangChain seat: `brand_profile` and `intake_validate`.
  const usedTools: string[] = [];
  const brandProfileTool = new DynamicStructuredTool({
    name: "brand_profile",
    description:
      "Read-only access to the retailer's brand tone, approved terms, banned terms, and country advertising rules.",
    schema: z.object({
      country: z.string().optional().describe("Optional two-letter country code (AU, NZ, UK, US)."),
    }),
    func: async (args: { country?: string }) => {
      usedTools.push("brand.profile");
      const c =
        args.country && (COUNTRIES as string[]).includes(args.country)
          ? (args.country as Country)
          : draft.country;
      return JSON.stringify({
        retailerName: input.brand.retailerName,
        tone: input.brand.tone,
        approvedTerms: input.brand.approvedTerms,
        bannedTerms: input.brand.bannedTerms,
        countryRule: input.brand.countryRules[c] ?? "",
        priorRecommendation: input.priorRecommendation?.note ?? null,
      });
    },
  });

  const intakeValidateTool = new DynamicStructuredTool({
    name: "intake_validate",
    description:
      "Validate the current CampaignInput draft using validateIntake() and return any missing or invalid fields with their UC-01 clauses.",
    schema: z.object({
      check: z.string().optional().describe("Pass 'current' to validate the current draft state."),
    }),
    func: async () => {
      usedTools.push("intake.validate");
      const problems = validateIntake(draft, input.brand);
      return JSON.stringify({
        valid: problems.length === 0,
        problems,
        missingField: nextMissingField(draft, input.brand),
      });
    },
  });

  const assignment = input.settings.agents.trend;
  const chatModel = new MeteredChatModel({
    agent: "intake",
    modelId: assignment.modelId,
    billing: input.billing,
    localBaseUrl: input.settings.localBaseUrl,
    localModel: input.settings.localModel,
    complete: input.complete ?? runComplete,
  });

  const seatAgent = buildAgent({
    seat: "intake",
    chat: chatModel,
    tools: [brandProfileTool, intakeValidateTool],
    schema: intakeTurnSchema,
  });

  const transcript = input.messages
    .slice(-8)
    .map((m) => `${m.role === "user" ? "Founder" : "Assistant"}: ${m.content}`)
    .join("\n");

  const currentProblems = validateIntake(draft, input.brand);
  const currentMissing = nextMissingField(draft, input.brand);

  const taskPrompt = [
    `Retailer: ${input.brand.retailerName} (${draft.country}).`,
    `Banned terms (never use): ${input.brand.bannedTerms.join(", ")}.`,
    input.priorRecommendation
      ? `Accepted recommendation from prior campaign (${input.priorRecommendation.fromCampaignName}): ${input.priorRecommendation.note}`
      : "No prior campaign recommendation attached.",
    "",
    "Current draft state (budget, channels, dates, and country come ONLY from the founder):",
    JSON.stringify({
      name: draft.name,
      product: draft.product,
      category: draft.category,
      targetAudience: draft.targetAudience,
      objective: draft.objective,
      budget: draft.budget,
      channels: draft.channels,
      startDate: draft.startDate,
      endDate: draft.endDate,
      country: draft.country,
      notes: draft.notes,
    }),
    `Current validation problems (${currentProblems.length}): ${currentProblems.map((p) => `${p.field}: ${p.message}`).join(" | ") || "none"}`,
    `Next missing field to ask about: ${currentMissing}`,
    refusedCommand
      ? "IMPORTANT: The founder asked you to launch/publish/approve. Refuse that action politely and explain that only the founder can click Launch in the form."
      : "",
    "",
    "Recent conversation:",
    transcript || "(Founder just opened the intake assistant.)",
    "",
    "Respond with JSON matching the intake schema. Extract any free-text fields (name, product, category, targetAudience, objective, notes) the founder provided, ask for the single next missing field, and offer up to 3 concise options.",
  ]
    .filter(Boolean)
    .join("\n");

  let reply = "";
  let missingField: IntakeTurnOutput["missingField"] = currentMissing;
  let options: string[] = [];
  let path: "live_model" | "deterministic_fallback" = "deterministic_fallback";
  let status: CompleteResult["status"] = "stubbed";
  let traceNote = "";

  try {
    const modelAnswer = await seatAgent.invoke({ task: taskPrompt });
    path = "live_model";
    status = "ok";

    // Apply only permitted free-text fields from `draftPatch`, scrubbing banned terms.
    const patch = modelAnswer.draftPatch;
    if (patch) {
      const applyTextField = (
        field: "name" | "product" | "category" | "targetAudience" | "objective",
        rawVal: string | undefined,
      ) => {
        if (!rawVal || typeof rawVal !== "string" || rawVal.trim().length < 3) return;
        // Do not overwrite a value the founder already explicitly provided unless it was empty.
        if (draft.fieldSources[field] === "founder" && draft[field].trim().length >= 3) return;
        const { cleaned, caught } = filterBannedTerms(rawVal.trim(), input.brand);
        caughtBanned.push(...caught);
        if (cleaned.length >= 3) {
          draft[field] = cleaned.slice(0, 200);
          if (!draft.fieldSources[field]) {
            draft.fieldSources[field] = "assistant";
          }
        }
      };

      applyTextField("product", patch.product);
      applyTextField("name", patch.name);
      applyTextField("category", patch.category);
      applyTextField("targetAudience", patch.targetAudience);
      applyTextField("objective", patch.objective);

      if (patch.notes && typeof patch.notes === "string" && patch.notes.trim().length > 0) {
        const { cleaned, caught } = filterBannedTerms(patch.notes.trim(), input.brand);
        caughtBanned.push(...caught);
        if (cleaned && !draft.notes) {
          draft.notes = cleaned.startsWith(ASSISTANT_NOTE_PREFIX.trim())
            ? cleaned
            : `${ASSISTANT_NOTE_PREFIX}${cleaned}`;
          draft.fieldSources.notes = "assistant";
        }
      }
    }

    // Re-generate campaign name if product was newly extracted by the model and name is still blank.
    if (draft.product && (!draft.name || draft.name.trim().length < 3)) {
      const { cleaned, caught } = filterBannedTerms(
        `${input.brand.retailerName} — ${draft.product.slice(0, 48)}`,
        input.brand,
      );
      caughtBanned.push(...caught);
      draft.name = cleaned.length >= 3 ? cleaned : `Campaign — ${draft.product.slice(0, 48)}`;
      draft.fieldSources.name = "assistant";
    }

    const postProblems = validateIntake(draft, input.brand);
    missingField = postProblems.length === 0 ? "none" : nextMissingField(draft, input.brand);

    const { cleaned: cleanedReply, caught: replyCaught } = filterBannedTerms(
      modelAnswer.reply,
      input.brand,
    );
    caughtBanned.push(...replyCaught);

    if (refusedCommand && !/cannot launch|only prepare|click.*launch|form/i.test(cleanedReply)) {
      reply = `I cannot launch, approve, or publish campaigns — only the Human Founder can click “Launch agents” in the form. ${cleanedReply}`;
    } else {
      reply = cleanedReply || deterministicIntakeTurn(draft, input.brand, refusedCommand).reply;
    }

    const rawOptions = (modelAnswer.options ?? [])
      .map((opt) => {
        const f = filterBannedTerms(opt, input.brand);
        caughtBanned.push(...f.caught);
        return f.cleaned;
      })
      .filter((opt) => opt.length > 0)
      .slice(0, 3);

    options =
      rawOptions.length > 0
        ? rawOptions
        : optionsForMissingField(missingField, draft).slice(0, 3);

    const spoken = chatModel.usage.models[0] ?? getLlmOrDefault(assignment.modelId).name;
    traceNote = `${spoken} ran intake seat (${chatModel.usage.calls} call(s))${
      usedTools.length ? `; tools: ${usedTools.join(", ")}` : ""
    }.`;
  } catch (err) {
    // Graceful deterministic fallback when no model is configured, out of credits, or offline.
    const fallback = deterministicIntakeTurn(draft, input.brand, refusedCommand);
    reply = fallback.reply;
    missingField = fallback.missingField;
    options = fallback.options;
    traceNote =
      err instanceof Error
        ? `Deterministic intake fallback — ${err.message}`
        : "Deterministic intake fallback.";
  }

  const finalProblems = validateIntake(draft, input.brand);
  const readyToReview = finalProblems.length === 0;
  if (readyToReview) {
    missingField = "none";
  }

  const assignedModel = getLlmOrDefault(assignment.modelId);
  const spokenName = chatModel.usage.models[0] ?? assignedModel.name;
  const costUsd = Math.round(chatModel.usage.costUsd * 1e5) / 1e5;

  const logEvents: AgentEvent[] = [];
  if (lastUserMessage.trim()) {
    logEvents.push(
      makeLog(
        "founder",
        "intake",
        "Founder intake message",
        lastUserMessage.trim().slice(0, 400),
        now,
      ),
    );
  }
  logEvents.push({
    ...makeLog(
      "intake",
      "intake",
      readyToReview
        ? "Intake assistant completed draft for founder review"
        : `Intake assistant asked for ${missingField}`,
      `${reply.slice(0, 360)} (${path === "live_model" ? spokenName : "deterministic fallback"} · $${costUsd.toFixed(4)})`,
      now,
    ),
    id: uid("log"),
  });

  return {
    reply,
    draft,
    problems: finalProblems,
    missingField,
    options,
    readyToReview,
    turnCount,
    turnCapReached: false,
    refusedCommand,
    filteredBannedTerms: Array.from(new Set(caughtBanned)),
    usedTools,
    logEvents,
    trace: {
      modelId: assignedModel.id,
      modelName: spokenName,
      path,
      status,
      costUsd,
      totalTokens: chatModel.usage.totalTokens,
      calls: chatModel.usage.calls,
      note: traceNote,
    },
  };
}

/** Convert an `IntakeDraftState` and accumulated `AgentEvent[]` transcript into a `CampaignInput`. */
export function toCampaignInput(
  draft: IntakeDraftState,
  intakeLog: AgentEvent[],
): CampaignInput {
  void intakeLog;
  return {
    name: draft.name.trim(),
    product: draft.product.trim(),
    category: draft.category.trim() || "Grocery",
    targetAudience: draft.targetAudience.trim(),
    objective: draft.objective.trim(),
    budget: draft.budget,
    channels: draft.channels,
    startDate: draft.startDate,
    endDate: draft.endDate,
    country: draft.country,
    notes: draft.notes,
  };
}
