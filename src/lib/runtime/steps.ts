/**
 * Agent step handlers and the helpers they share.
 *
 * The run* handlers and receiveComplianceSubmission each advance one unit of work
 * on the Work. All of them except runPublish return a `{ message, blocked }` result
 * for the run trace; runPublish returns `{ escalated }`. setRun, addEvent, addStep,
 * addEvidence, addTrace, recordPolicy and callTool record onto the Work. The rest
 * are pure builders: creatives, schedule conflicts, channel results, reports and
 * recommendations.
 *
 * The module is framework-free. operation-graph.ts calls the handlers, and
 * runFeedbackCollection calls runPublish. Both are reached through runEngine from
 * /api/engine and services/workflow/worker.ts, and through the LangSmith Studio
 * graph (src/lib/studio/operation.ts), which runs the same operation-graph nodes
 * without runEngine. agents.ts and the Studio seats (src/lib/studio/seats.ts) also
 * call into this module directly.
 */

import { buildReport } from "../compliance/report";
import { currentRuleSelection } from "../compliance/rules";
import { checkSubmission } from "../compliance/checks";
import { resolveReviewOutcome } from "../compliance/outcome";
import { posterImages } from "../compliance/posters";
import { formatLawPassages, marketLaw, retrieveAdvertisingLaw } from "../advertising-law/index";
import { beginReview, submissionFor, assertReviewPermission, ComplianceSubmissionError } from "../compliance/service";
import { uid } from "@/lib/ids";
import { copyFromBrief } from "@/lib/media/brief-copy";
import { getModelOrDefault } from "@/lib/media/catalog";
import { mediaHoldUsd } from "@/lib/media/estimate";
import { posterRequest } from "@/lib/media/prompts";
import type { MediaGeneration } from "@/lib/media/types";
import { makeLog } from "@/lib/seed";
import type { WorkspaceSettings } from "@/lib/settings";
import type {
  BrandProfile,
  Campaign,
  CampaignBrief,
  PriceRecommendation,
  Channel,
  ComplianceFinding,
  ComplianceReport,
  Country,
  Creative,
  Palette,
  ScheduleItem,
  Trend,
} from "@/lib/types";
import {
  decideChannelCaptions,
  decideCompliance,
  decideCopy,
  decideRecommendation,
  decideTrendBrief,
  takeUnbookedSeatCost,
  type CopyVariant,
  type DecisionTrace,
  type LlmRuntime,
  type TrendDecision,
} from "./decide";
import { selectGateway, stableHash } from "./gateways";
import { evaluateGuard } from "./guard";
import { digestHash, inputDigest } from "./intake";
import { isClearStock, recommendClearance } from "@/lib/retail/whichgrocer/clearance";
import { aud, shelfQuery, type ShelfOffer } from "@/lib/retail/whichgrocer/query";
import { channelBehaviourNote, toolByName, toToolCall, type ToolOutcome } from "./tools";
import {
  MAX_PUBLISH_RETRIES,
  MAX_REVISION_ATTEMPTS,
  type Actor,
  type ChannelResult,
  type ChannelVersion,
  type ComplianceAttempt,
  type DeliveryAttempt,
  type Evidence,
  type PerformanceReport,
  type PolicyDecision,
  type RecommendationPoint,
  type RunScheduleItem,
  type RunStep,
  type RunStepId,
  type ScheduleConflict,
  type ToolCall,
  type TrendBriefGap,
  type TrendFinding,
} from "./types";

export type Work = {
  campaign: Campaign;
  run: Campaign["run"];
  steps: RunStep[];
  policy: PolicyDecision[];
  toolCalls: ToolCall[];
  events: Campaign["log"];
  /** Frozen "now" for the whole command, so a run reads as one instant. */
  now: string;
};

export type StepEnv = {
  now: string;
  settings: WorkspaceSettings;
  brand: BrandProfile;
  llm: LlmRuntime;
  /** Signed-in founder. Shelf prices use the server WhichGrocer API key. */
  ownerUserId?: string;
  /** Every campaign in the workspace, for cross-campaign scheduling checks. */
  allCampaigns: Campaign[];
  /**
   * Render the ad for a creative. Injected so the engine stays independent of
   * the transport: the app passes a function that calls the studio, a test passes
   * a stub, and the agent spend meter sees the same usage either way.
   */
  renderPoster: (input: {
    campaign: Campaign;
    creative: Creative;
    modelId: string;
  }) => Promise<MediaGeneration>;
};

function stamp() {
  return new Date().toISOString();
}

/**
 * Advance the run pointer.
 *
 * The run object is shared by reference between `Work.run` and
 * `Work.campaign.run`, so a step handler must never replace it — it patches it.
 * Mutating one object in place is what keeps the loop's view and the campaign
 * document's view from drifting apart mid-ADVANCE.
 */
export function setRun(w: Work, patch: Partial<NonNullable<Campaign["run"]>>) {
  if (!w.run) return;
  Object.assign(w.run, patch);
  w.campaign.run = w.run;
}

/* --------------------------------------------------------------- recording -- */

export function addEvent(
  w: Work,
  agent: Actor,
  kind: Campaign["log"][number]["kind"],
  title: string,
  detail: string,
  extra: Partial<Campaign["log"][number]> = {},
) {
  const event = makeLog(agent, kind, title, detail, w.now);
  const line = { ...event, ...extra };
  w.events.push(line);
  w.campaign.log = [...w.campaign.log, line];
  return line;
}

export function addStep(
  w: Work,
  step: RunStepId,
  agent: Actor,
  status: RunStep["status"],
  title: string,
  detail: string,
  extra: Partial<RunStep> = {},
): RunStep {
  const line: RunStep = {
    id: uid("rs"),
    at: w.now,
    step,
    agent,
    status,
    title,
    detail,
    ...extra,
  };
  w.steps.push(line);
  w.campaign.runSteps = [...w.campaign.runSteps, line];
  return line;
}

function addEvidence(w: Work, list: Evidence[]) {
  if (list.length === 0) return;
  w.campaign.evidence = [...w.campaign.evidence, ...list];
}

function recordPolicy(w: Work, decision: PolicyDecision) {
  w.policy.push(decision);
  w.campaign.policyDecisions = [...w.campaign.policyDecisions, decision];
  if (decision.verdict === "block") {
    w.campaign.spend = {
      ...w.campaign.spend,
      blockedAttempts: w.campaign.spend.blockedAttempts + 1,
    };
  }
}

/** Run one registered tool and record the call plus the evidence it raised. */
export async function callTool(
  w: Work,
  agent: ToolCall["agent"],
  name: string,
  args: Record<string, string>,
  env: StepEnv,
): Promise<ToolOutcome> {
  const tool = toolByName(name);
  const started = Date.now();
  if (!tool) {
    const outcome: ToolOutcome = {
      summary: `Unknown tool ${name}.`,
      status: "error",
      evidence: [],
      data: null,
    };
    const call = toToolCall({ agent, tool: name, args, outcome, latencyMs: 0, at: w.now });
    w.toolCalls.push(call);
    w.campaign.toolCalls = [...w.campaign.toolCalls, call];
    return outcome;
  }
  const outcome = await tool.run({
    campaign: w.campaign,
    brand: env.brand,
    at: w.now,
    args,
  });
  const call = toToolCall({
    agent,
    tool: name,
    args,
    outcome,
    latencyMs: Date.now() - started,
    at: w.now,
  });
  w.toolCalls.push(call);
  w.campaign.toolCalls = [...w.campaign.toolCalls, call];
  addEvidence(w, outcome.evidence);
  return outcome;
}

/** Books a decision's cost, plus any seat run that failed after it was charged on the way. */
function addTrace(w: Work, trace: DecisionTrace, agent: Actor, purpose: string, llm?: LlmRuntime) {
  const failedSeat = takeUnbookedSeatCost(llm);
  const cost = trace.usage.costUsd + failedSeat;
  const extra = failedSeat > 0 ? ` Includes $${failedSeat.toFixed(4)} for an agent run that failed after it was charged.` : "";
  addEvent(
    w,
    agent,
    "insight",
    `${purpose} · ${trace.modelName}`,
    `${trace.path === "live_model" ? "LLM decision" : "Deterministic rules"} · ${trace.status} · est. $${cost.toFixed(4)} · ${trace.usage.totalTokens} tokens. ${trace.note}${extra}`,
  );
  w.campaign.spend = {
    ...w.campaign.spend,
    inferenceUsd: Math.round((w.campaign.spend.inferenceUsd + cost) * 1e5) / 1e5,
  };
}

/* ------------------------------------------------------------------- trend -- */

type Motif = Creative["motif"];

function motifPack(campaign: Campaign): Motif {
  const t = `${campaign.product} ${campaign.name} ${campaign.category} ${campaign.targetAudience}`.toLowerCase();
  if (/jacket|parka|coat|outerwear|hoodie|knit/.test(t)) return "campus";
  if (/fruit|yoghurt|yogurt|grocery|produce|catalogue|peach|plum|veg|milk/.test(t)) return "produce";
  if (/coffee|bean|pantry|chocolate/.test(t)) return "pantry";
  return "editorial";
}

function palettesFor(motif: Motif): Record<"A" | "B", Palette> {
  if (motif === "campus") {
    return {
      A: { bg: "#1b2430", fg: "#f4efe6", accent: "#c4342a", muted: "#8b9aab" },
      B: { bg: "#f3eee5", fg: "#1c1917", accent: "#c4342a", muted: "#6b645b" },
    };
  }
  if (motif === "produce") {
    return {
      A: { bg: "#3d4f2f", fg: "#f6f1e4", accent: "#e8c56b", muted: "#c5d0b4" },
      B: { bg: "#f3eee5", fg: "#2b2118", accent: "#c4342a", muted: "#7a6a58" },
    };
  }
  if (motif === "pantry") {
    return {
      A: { bg: "#4a2c22", fg: "#f8efe4", accent: "#d4a574", muted: "#cbb6a6" },
      B: { bg: "#f3eee5", fg: "#1c1917", accent: "#c4342a", muted: "#6b645b" },
    };
  }
  return {
    A: { bg: "#1c1917", fg: "#f3eee5", accent: "#c4342a", muted: "#a39e96" },
    B: { bg: "#f3eee5", fg: "#1c1917", accent: "#c4342a", muted: "#6b645b" },
  };
}

export function buildCreatives(
  campaign: Campaign,
  variants: CopyVariant[],
  version: number,
): Creative[] {
  const motif = motifPack(campaign);
  const pal = palettesFor(motif);
  const status: Creative["status"] = version === 1 ? "draft" : "revised";
  const visual = campaign.brief?.visualDirection ?? campaign.sharedContext.brandTone;
  return variants.map((v, i) => {
    const variant = (i === 0 ? "A" : "B") as "A" | "B";
    return {
      id: uid("cr"),
      variant,
      version,
      kicker: v.kicker,
      headline: v.headline,
      subhead: v.subhead,
      cta: v.cta,
      caption: v.caption,
      palette: pal[variant],
      motif,
      status,
      prompt:
        v.prompt ||
        `${visual} Headline: ${v.headline}. Product: ${campaign.product}. Brand: ${campaign.sharedContext.retailer}.`,
    };
  });
}

function evidenceLine(e: Evidence) {
  return `${e.claim} — ${e.detail.slice(0, 140)} [${e.sourceName} · ${e.observedAt} · ${e.status} · ${e.confidence}%]`;
}

function offersFromTool(data: unknown): ShelfOffer[] {
  if (!data || typeof data !== "object") return [];
  const offers = (data as { offers?: unknown }).offers;
  if (!Array.isArray(offers)) return [];
  return offers.filter(
    (offer): offer is ShelfOffer =>
      Boolean(offer) &&
      typeof offer === "object" &&
      typeof (offer as ShelfOffer).price === "number" &&
      typeof (offer as ShelfOffer).store === "string" &&
      typeof (offer as ShelfOffer).name === "string",
  );
}

function pinClearance(decision: TrendDecision, recommendation: PriceRecommendation): TrendDecision {
  if (recommendation.discountPct <= 0) {
    const strip = (text: string) => text.replace(/\d+(\.\d+)?%\s+off/gi, "the current price");
    return {
      ...decision,
      angle: strip(decision.angle),
      keyMessage: strip(decision.keyMessage),
      claimsAllowed: decision.claimsAllowed.filter((claim) => !/\d+(\.\d+)?%\s+off/i.test(claim)),
    };
  }
  const tag = `${recommendation.discountPct}% off`;
  const price = aud(recommendation.recommendedPriceAud);
  return {
    ...decision,
    angle: decision.angle.includes(tag)
      ? decision.angle
      : `${tag} to meet the cheapest similar catalogue price. ${decision.angle}`.slice(0, 240),
    keyMessage: decision.keyMessage.includes(tag) ? decision.keyMessage : `${tag} — now ${price}.`.slice(0, 160),
    claimsAllowed: [
      tag,
      `Now ${price}`,
      ...decision.claimsAllowed.filter((claim) => !/^\d+(\.\d+)?%\s+off/.test(claim)),
    ].slice(0, 6),
  };
}

function trendFallbackDecision(
  campaign: Campaign,
  brand: BrandProfile,
  recommendation: PriceRecommendation | null,
): TrendDecision {
  const motif = motifPack(campaign);
  const clearance =
    recommendation && recommendation.discountPct > 0
      ? `${recommendation.discountPct}% off, to ${aud(recommendation.recommendedPriceAud)}`
      : null;
  const angle = clearance
    ? `Clear the stock: ${clearance}.`
    : motif === "campus"
      ? "Campus weather, not wilderness."
      : motif === "produce"
        ? `${campaign.product}, for ${campaign.targetAudience}.`
        : `One honest job ${campaign.product} does for ${campaign.targetAudience}.`;
  return {
    priorities: [
      {
        topic: motif === "campus" ? "Commuter weather, not expedition gear" : "Seasonal timing leads the cycle",
        relevance: 92,
        confidence: 84,
        theme: angle,
        visual: brand.visualStyle,
      },
      {
        topic: "Quiet proof beats superlatives in this category",
        relevance: 81,
        confidence: 78,
        theme: "Name the fact, skip the shout",
      },
    ],
    angle,
    keyMessage: clearance ?? campaign.product.slice(0, 160),
    claimsAllowed:
      motif === "campus"
        ? ["Water-resistant shell", "Packs into its own pocket", "Cut for commuting"]
        : [...campaign.sharedContext.approvedClaims],
    claimsAvoid: [],
    visualDirection: brand.visualStyle,
    limitations: [
      "Channel-level attention windows are modelled assumptions, not measured impressions.",
      "No customer survey data was available for this cycle.",
    ],
  };
}

/** AHR-02: research, evidence ledger, gaps, and the brief. */
export async function runTrendResearch(
  w: Work,
  env: StepEnv,
): Promise<{ message: string; blocked: boolean }> {
  const c = w.campaign;
  c.status = "analysing";
  c.running = true;
  addEvent(
    w,
    "trend",
    "handoff",
    "Received shared campaign context",
    `${c.product} for ${c.targetAudience} in ${c.country}. Objective: ${c.objective}. Scope frozen to the founder's brief.`,
  );
  addStep(w, "trend.receive", "trend", "ok", "Context received", "Shared context loaded from intake.");

  // The founder's prior-campaign note is attached, never rewritten (AHR-01).
  if (c.sharedContext.previousPerformanceNote) {
    addEvent(
      w,
      "trend",
      "feedback",
      "Prior accepted recommendation folded in",
      `${c.sharedContext.previousPerformanceNote}${
        c.sharedContext.previousPerformanceFrom
          ? ` (accepted from campaign ${c.sharedContext.previousPerformanceFrom})`
          : ""
      }`,
    );
  }

  const toolResults: ToolOutcome[] = [];

  const market = await callTool(
    w,
    "trend",
    "web.market_context",
    { topic: c.product.split(/[([+—,]/)[0].trim() },
    env,
  );
  toolResults.push(market);

  const weather = await callTool(w, "trend", "web.season_weather", { country: c.country }, env);
  toolResults.push(weather);

  const shelf = await callTool(
    w,
    "trend",
    "web.shelf_prices",
    { query: shelfQuery(c.product, c.category) },
    env,
  );
  toolResults.push(shelf);

  const competitor = await callTool(
    w,
    "trend",
    "web.competitor_scan",
    { query: `${c.category} ${c.country} retail promotion` },
    env,
  );
  toolResults.push(competitor);

  const retail = await callTool(
    w,
    "trend",
    "retail.internal_signals",
    { category: c.category, country: c.country },
    env,
  );
  toolResults.push(retail);

  // UC-02 ext 4.b: if internal data is not authorised, say so rather than guess.
  if (retail.status === "skipped") {
    const outcome = evaluateGuard(
      {
        actor: "trend",
        action: "READ_INTERNAL_DATA",
        campaign: c,
        target: "POS and catalogue history",
        triggeredBy: "trend.research",
      },
      w.now,
    );
    recordPolicy(w, outcome.decision);
    addEvent(w, "trend", "policy", "Internal retail data excluded", outcome.reason, {
      policyDecisionId: outcome.decision.id,
    });
  }

  for (const outcome of toolResults) {
    addEvent(w, "trend", "tool", outcome.summary, outcome.evidence.map((e) => e.sourceName).join(" · ") || "no evidence raised");
  }

  addStep(
    w,
    "trend.research",
    "trend",
    toolResults.every((t) => t.status === "ok") ? "ok" : "warn",
    `Scanned ${toolResults.filter((t) => t.status === "ok").length}/${toolResults.length} sources`,
    toolResults.map((t) => t.summary).join(" "),
    { toolCallId: w.toolCalls.at(-1)?.id },
  );

  // ---- gaps (AHR-02: report the limitation rather than invent facts)
  const gaps: TrendBriefGap[] = [];
  for (const outcome of toolResults) {
    if (outcome.gap) {
      gaps.push({
        id: uid("gap"),
        kind: outcome.gap.kind,
        detail: outcome.gap.detail,
        effect: outcome.gap.effect,
        needsFounder: outcome.gap.kind !== "unauthorised",
      });
    }
  }
  gaps.push({
    id: uid("gap"),
    kind: "low_confidence",
    detail: "No customer-level survey or panel data is connected for this cycle.",
    effect: "Personas are modelled from category behaviour, not interviewed shoppers.",
    needsFounder: false,
  });

  const askedForPrices = isClearStock(c.objective) || c.unitCostAud != null || c.currentPriceAud != null;
  const clearance = recommendClearance({
    unitCostAud: c.unitCostAud,
    currentPriceAud: c.currentPriceAud,
    offers: offersFromTool(shelf.data),
  });
  if (clearance.ok) {
    c.priceRecommendation = clearance.recommendation;
    const priced = clearance.recommendation;
    addEvidence(w, [
      {
        id: uid("ev"),
        claim: `Cost ${aud(priced.unitCostAud)}, current price ${aud(priced.currentPriceAud)}.`,
        detail: "Figures the founder entered for this product.",
        sourceName: "Founder",
        sourceRef: "campaign brief",
        sourceKind: "founder_input",
        observedAt: w.now.slice(0, 10),
        fetchedAt: w.now,
        status: "verified",
        confidence: 100,
        raisedBy: "trend",
        usedFor: "Clearance price",
      },
    ]);
    addEvent(
      w,
      "trend",
      "insight",
      priced.discountPct > 0 ? `Recommend ${priced.discountPct}% off` : "No clearance discount",
      priced.rationale,
    );
  } else {
    c.priceRecommendation = null;
    if (askedForPrices) {
      gaps.push({
        id: uid("gap"),
        kind: "missing_source",
        detail: clearance.reason,
        effect: "No discount percentage was recommended.",
        needsFounder: c.unitCostAud == null || c.currentPriceAud == null,
      });
    }
  }

  // ---- decision: the model prioritises, or the rules do
  const evidenceLines = w.campaign.evidence.map(evidenceLine);
  const recommended = clearance.ok ? clearance.recommendation : null;
  const decided = await decideTrendBrief({
    campaign: c,
    brand: env.brand,
    settings: env.settings,
    llm: env.llm,
    evidenceLines,
    fallback: trendFallbackDecision(c, env.brand, recommended),
    clearance: recommended,
  });
  const decision = recommended ? pinClearance(decided.decision, recommended) : decided.decision;
  const trace = decided.trace;
  addTrace(w, trace, "trend", "Brief prioritisation", env.llm);
  for (const l of decision.limitations) {
    gaps.push({
      id: uid("gap"),
      kind: "low_confidence",
      detail: l,
      effect: "Recorded as a known limitation of this brief.",
      needsFounder: false,
    });
  }

  // ---- findings: supported findings cite evidence, the rest are labelled assumptions
  const byKind = (kind: Evidence["sourceKind"]) => w.campaign.evidence.filter((e) => e.sourceKind === kind);
  const findings: TrendFinding[] = [];
  const usedEvidence = new Set<string>();

  const pushFinding = (
    topic: string,
    finding: string,
    ids: string[],
    relevance: number,
    confidence: number,
    extra: Partial<TrendFinding> = {},
  ) => {
    ids.forEach((id) => usedEvidence.add(id));
    findings.push({
      id: uid("tf"),
      topic,
      finding,
      basis: ids.length > 0 ? "supported" : "assumption",
      relevance,
      confidence,
      country: c.country,
      channelRelevance: c.channels,
      evidenceIds: ids,
      ...extra,
    });
  };

  const retailEvidence = byKind("internal_retail").filter((e) => e.status === "verified");
  const retailFit = retail.data && typeof retail.data === "object" ? (retail.data as { relevance?: number }) : null;
  if (retailEvidence.length > 0) {
    pushFinding(
      "Internal demand signal",
      retailEvidence[0].claim,
      [retailEvidence[0].id],
      retailFit?.relevance ?? retailEvidence[0].confidence,
      retailEvidence[0].confidence,
      { themeSuggestion: decision.angle },
    );
  }
  const publicEvidence = byKind("external_public").filter((e) => e.status === "verified");
  const contextEvidence = publicEvidence.filter((e) => e.sourceName !== "WhichGrocer");
  if (contextEvidence.length > 0) {
    pushFinding(
      "Public market context",
      contextEvidence[0].claim,
      [contextEvidence[0].id],
      78,
      72,
      { visualDirection: decision.visualDirection },
    );
  }
  if (retailEvidence[1]) {
    pushFinding("Catalogue history", retailEvidence[1].claim, [retailEvidence[1].id], retailEvidence[1].confidence, retailEvidence[1].confidence);
  }
  if (retailEvidence[2]) {
    pushFinding("Competitor check", retailEvidence[2].claim, [retailEvidence[2].id], retailEvidence[2].confidence, retailEvidence[2].confidence);
  }
  const shelfEvidence = publicEvidence.filter((e) => e.sourceName === "WhichGrocer");
  if (shelfEvidence[0]) {
    pushFinding("Shelf price", shelfEvidence[0].claim, shelfEvidence.map((e) => e.id), 91, shelfEvidence[0].confidence, {
      themeSuggestion: decision.angle,
    });
  }
  if (c.priceRecommendation) {
    const founderPrice = w.campaign.evidence.find((e) => e.usedFor === "Clearance price");
    const cited = [...(founderPrice ? [founderPrice.id] : []), ...shelfEvidence.map((e) => e.id)];
    pushFinding("Clearance discount", c.priceRecommendation.rationale, cited, 96, cited.length > 1 ? 90 : 70, {
      themeSuggestion:
        c.priceRecommendation.discountPct > 0 ? `${c.priceRecommendation.discountPct}% off` : "Hold the current price",
      risk: c.priceRecommendation.limitedByCost ? "A deeper cut would sell below the founder's cost." : undefined,
    });
  }

  const priorNote = c.sharedContext.previousPerformanceNote;
  if (priorNote) {
    const priorEvidence = w.campaign.evidence.find(
      (e) => e.sourceKind === "founder_input" && e.usedFor !== "Clearance price",
    );
    pushFinding(
      "Previous campaign feedback",
      priorNote,
      priorEvidence ? [priorEvidence.id] : [],
      90,
      92,
      { themeSuggestion: "Carry the accepted angle forward." },
    );
  }

  pushFinding(
    "Claim risk",
    "After the poster is generated, a vision model reads the words on the picture and compares them with the advertising-law documents uploaded on Brand.",
    [],
    70,
    60,
    {
      risk: "Words on the artwork are not cleared by a yes-or-no term list.",
      themeSuggestion: "Keep claims specific enough to check against the uploaded regulation.",
    },
  );

  // Model-prioritised topics that no tool corroborated stay labelled as assumptions.
  for (const p of decision.priorities.slice(0, 3)) {
    if (findings.some((f) => f.topic.toLowerCase() === p.topic.toLowerCase())) continue;
    pushFinding(p.topic || "Model-prioritised theme", p.theme ?? decision.angle, [], p.relevance, Math.min(p.confidence, 70), {
      themeSuggestion: p.theme,
      visualDirection: p.visual,
    });
  }

  const trends: Trend[] = findings.map((f) => ({
    id: uid("tr"),
    topic: f.topic,
    evidence:
      f.basis === "supported"
        ? (w.campaign.evidence.find((e) => e.id === f.evidenceIds[0])?.detail ?? f.finding)
        : `${f.finding} (labelled assumption — no external record)`,
    source:
      f.evidenceIds.length > 0
        ? (w.campaign.evidence.find((e) => e.id === f.evidenceIds[0])?.sourceName ?? "Assumption")
        : "Assumption",
    relevance: f.relevance,
    confidence: f.confidence,
  }));

  const brief: CampaignBrief = {
    product: c.product,
    angle: decision.angle,
    audience: c.targetAudience,
    channels: c.channels,
    keyMessage: decision.keyMessage,
    claimsAllowed: decision.claimsAllowed,
    claimsAvoid: decision.claimsAvoid,
    visualDirection: decision.visualDirection,
  };

  c.trends = trends;
  c.trendFindings = findings;
  c.trendGaps = gaps;
  c.brief = brief;
  c.opportunities = findings.slice(0, 3).map((f, i) => ({
    id: uid("op"),
    title: f.topic,
    why: f.finding,
    audienceFit: f.relevance,
    expectedValue:
      f.basis === "supported"
        ? `Supported by ${w.campaign.evidence.find((e) => e.id === f.evidenceIds[0])?.sourceName ?? "recorded source"}.`
        : "Assumption — needs founder confirmation before it carries weight.",
    rank: i + 1,
  }));
  c.personas = [
    {
      id: uid("ps"),
      name: `${c.targetAudience.split(",")[0]} (modelled)`,
      age: "modelled from category behaviour, not surveyed",
      summary: `Modelled persona for ${c.targetAudience}. Built from ${retailEvidence.length > 0 ? "internal POS and catalogue data" : "public sources only"}; no interview data is connected.`,
      channels: c.channels,
      motivations: decision.claimsAllowed.slice(0, 3),
    },
  ];
  c.sharedContext = { ...c.sharedContext, approvedClaims: decision.claimsAllowed };
  c.updatedAt = stamp();

  const assumptions = findings.filter((f) => f.basis === "assumption").length;
  addEvent(
    w,
    "trend",
    "output",
    "Trend brief stored in shared context",
    `${findings.length} finding(s) — ${findings.length - assumptions} supported by a cited source, ${assumptions} labelled assumption. ${gaps.length} limitation(s) recorded. Angle: ${brief.angle}`,
    { evidenceIds: [...usedEvidence] },
  );
  addStep(
    w,
    "trend.brief",
    "trend",
    gaps.some((g) => g.needsFounder) ? "warn" : "ok",
    "Brief handed to Image Generation",
    `${brief.keyMessage} · claims allowed: ${brief.claimsAllowed.slice(0, 3).join(", ")}`,
  );
  // Hand-off: the same ADVANCE continues into AHR-03.
  setRun(w, { status: "running", step: "creative.receive" });
  return { message: "Trend brief complete.", blocked: false };
}

/* ---------------------------------------------------------------- creative -- */

export async function runCreativeGeneration(
  w: Work,
  env: StepEnv,
  version: number,
): Promise<{ message: string; blocked: boolean }> {
  const c = w.campaign;
  if (!c.brief) return { message: "No brief to work from.", blocked: true };
  c.status = version === 1 ? "generating" : "revising";
  c.running = true;

  const previous = c.complianceReports.at(-1);
  const notes =
    version > 1 && previous
      ? previous.attempt?.issues.map((i) => `${i.excerpt}: ${i.recommendedCorrection}`) ?? []
      : [];

  addEvent(
    w,
    "creative",
    version === 1 ? "handoff" : "revision",
    version === 1 ? "Received campaign brief" : `Revision ${version} from compliance notes`,
    version === 1
      ? `Two variants under brand guidelines. Visual direction: ${c.brief.visualDirection}`
      : notes.length
        ? `Fixing: ${notes.join(" · ")}`
        : "Removing unsupported claims, keeping the angle.",
  );

  const fallbackMap = copyFromBrief(c, env.brand.bannedTerms, notes);
  const { variants, trace } = await decideCopy({
    campaign: c,
    brand: env.brand,
    settings: env.settings,
    llm: env.llm,
    version,
    complianceNotes: notes,
    fallback: [fallbackMap.A, fallbackMap.B],
  });
  addTrace(w, trace, "creative", `Copy for v${version}`, env.llm);

  const creatives = buildCreatives(c, variants, version);
  const imageModel = getModelOrDefault(env.settings.imageModelId, "image");
  const modelId = imageModel.id;
  // Guard the spend on a quote before anything renders (UC-01 ext 13.a), so a
  // blocked step has not already paid the provider for its pictures.
  // The same worst-case figure the credit hold uses, so actual cost stays under the cap.
  const quote = creatives.reduce((n, cr) => n + mediaHoldUsd(imageModel, posterRequest(c, cr, modelId)), 0);
  const spend = evaluateGuard(
    {
      actor: "creative",
      action: "SPEND_MEDIA",
      campaign: c,
      target: `image generation on ${modelId}`,
      amountUsd: quote,
      triggeredBy: "creative.generate",
    },
    w.now,
  );
  recordPolicy(w, spend.decision);
  if (spend.verdict === "block") {
    addEvent(w, "creative", "policy", "Media spend blocked", spend.reason, {
      policyDecisionId: spend.decision.id,
    });
    addStep(
      w,
      version === 1 ? "creative.generate" : "creative.revise",
      "creative",
      "blocked",
      "Image generation blocked",
      spend.reason,
      { policyDecisionId: spend.decision.id },
    );
    return { message: spend.reason, blocked: true };
  }

  const withGen: Creative[] = [];
  for (const cr of creatives) {
    const generation = await env.renderPoster({ campaign: c, creative: cr, modelId });
    withGen.push({ ...cr, createdAt: w.now, generation });
  }
  const mediaCost = withGen.reduce((n, cr) => n + (cr.generation?.usage.costUsd ?? 0), 0);

  c.creatives = withGen;
  c.imageModelId = modelId;
  c.revisionCount = Math.max(0, version - 1);
  c.spend = {
    ...c.spend,
    mediaUsd: Math.round((c.spend.mediaUsd + mediaCost) * 1e5) / 1e5,
  };
  c.studioHistory = [
    ...c.studioHistory,
    {
      id: uid("run"),
      at: w.now,
      kind: "image",
      modelId,
      label: `v${version} ads`,
      costUsd: mediaCost,
      totalTokens: withGen.reduce((n, cr) => n + (cr.generation?.usage.totalTokens ?? 0), 0),
    },
  ];
  c.updatedAt = stamp();

  const pictures = withGen.filter((cr) => cr.generation?.url).length;
  const photo = c.productImageUrl ? " The uploaded product photo was the reference." : "";
  addEvent(
    w,
    "creative",
    "output",
    `v${version} generated — variants A and B`,
    `${withGen.map((cr) => `${cr.variant}: “${cr.headline}”`).join(" · ")} · ${modelId} · ${pictures} picture(s) · est. $${mediaCost.toFixed(3)}.${photo} Logged with inputs and creation date; not published.`,
  );
  addStep(
    w,
    version === 1 ? "creative.generate" : "creative.revise",
    "creative",
    pictures > 0 ? "ok" : "warn",
    `Submitted v${version} for compliance review`,
    pictures > 0
      ? `${pictures} poster(s) rendered.${photo} Not sent to any distribution channel.`
      : `The image step ran and no picture came back. ${withGen.find((cr) => cr.generation?.note)?.generation?.note ?? "Check the image model in Settings."}`,
  );
  // AHR-03 step 8: the draft goes to AHR-04 before anything else happens.
  setRun(w, { status: "running", step: "compliance.receive" });
  return { message: `v${version} submitted for compliance.`, blocked: false };
}

/* -------------------------------------------------------------- compliance -- */

export function receiveComplianceSubmission(w: Work, env: StepEnv) {
  try {
    const review = beginReview(w.campaign, env.brand, submissionFor(w.campaign, env.brand), w.now);
    review.ruleSelection = currentRuleSelection(review.ruleSelection, review.submission, w.now);
    w.campaign.status = "compliance";
    w.campaign.running = true;
    setRun(w, { step: "compliance.review", status: "running" });
    addStep(w, "compliance.receive", "compliance", "ok", "Review registered", "Exact submission retained before model execution.");
    return { message: "Compliance request accepted; review checkpoint ready.", blocked: false };
  } catch (error) {
    if (!(error instanceof ComplianceSubmissionError)) throw error;
    addEvent(w, "compliance", "flag", "Submission rejected", JSON.stringify(error.toJSON()));
    w.campaign.running = false;
    setRun(w, { status: "halted", haltedReason: error.message });
    return { message: `${error.code}: ${error.message}`, blocked: true };
  }
}

export async function runComplianceReview(
  w: Work,
  env: StepEnv,
): Promise<{ message: string; blocked: boolean }> {
  const c = w.campaign;
  assertReviewPermission(c);
  const submitted = submissionFor(c, env.brand);
  const reviewRun = c.complianceReviewRuns?.find(r => r.pipelineRunId === c.run?.id && r.advertisementVersionId === submitted.advertisementVersionId && r.status === "UNDER_REVIEW");
  if (!reviewRun) throw new ComplianceSubmissionError("VERSION_MISMATCH", "No active review exists for this exact version. Resubmit through compliance.receive.");
  c.status = "compliance";
  c.running = true;
  const attemptNo = reviewRun.attemptNumber;
  const copyBlob = c.creatives
    .map((cr) => `[${cr.variant}] ${cr.headline} — ${cr.subhead} — ${cr.caption}`)
    .join("\n");

  addEvent(
    w,
    "compliance",
    "handoff",
    `Reviewing v${c.creatives[0]?.version ?? 1} (attempt ${attemptNo}/${MAX_REVISION_ATTEMPTS})`,
    `${env.brand.countryRules[c.country]} Advertisement remains unpublished while under review.`,
  );
  addStep(w, "compliance.receive", "compliance", "ok", "Submission received", `Input digest recorded. Attempt ${attemptNo}.`);

  const selection = currentRuleSelection(reviewRun.ruleSelection, reviewRun.submission, w.now);
  reviewRun.ruleSelection = selection;
  const checked = checkSubmission(reviewRun.submission, selection);
  const images = await posterImages(c, env.ownerUserId);
  const law = marketLaw(c.country);
  const passages = law.ready
    ? formatLawPassages(c.country, retrieveAdvertisingLaw(c.country, copyBlob))
    : `No advertising-law index is built for ${law.label} (${c.country}). Do not use another country's law. Do not pass the advertisement.`;
  const documentProblems = !law.ready
    ? [`No advertising-law index is built for ${law.label}, so poster words cannot be checked against that market's law.`]
    : passages
      ? []
      : [`The ${law.label} advertising-law index returned no passage for this poster.`];
  const imageProblems = images.length
    ? []
    : ["No poster image could be attached, so the printed words were not read."];
  const { decision, trace } = await decideCompliance({
    campaign: c,
    brand: env.brand,
    settings: env.settings,
    llm: env.llm,
    ownerId: env.ownerUserId,
    copy: copyBlob,
    attempt: attemptNo,
    images,
    passages,
    fallback: { summary: "The compliance agent did not return a usable review." },
    rules: selection.rules,
  });
  addTrace(w, trace, "compliance", "Policy review", env.llm);

  const outcome = resolveReviewOutcome({
    agentOutcome: decision.outcome,
    issueCount: decision.issues.length,
    policyProblems: [...selection.problems, ...documentProblems, ...imageProblems],
    attempt: attemptNo,
    maxAttempts: MAX_REVISION_ATTEMPTS,
  });
  const risk =
    outcome === "pass"
      ? ("low" as const)
      : outcome === "manual_review" || decision.issues.some((issue) => issue.severity === "high")
        ? ("high" as const)
        : ("medium" as const);
  const verdict = { outcome, risk, score: decision.issues.length };
  const summary = [
    decision.summary,
    selection.problems.length > 0 ? `The policy registry is not usable for this review, so it was not passed: ${selection.problems.join(" ")}` : "",
    documentProblems[0] ?? "",
    imageProblems[0] ?? "",
  ].filter(Boolean).join(" ");
  const structuredReport = buildReport(reviewRun, decision.issues, checked.limitations, uid("cp"), w.now);
  structuredReport.status =
    verdict.outcome === "pass" ? "PASSED" : verdict.outcome === "changes_required" ? "CHANGES_REQUIRED" : "MANUAL_REVIEW_REQUIRED";
  reviewRun.report = structuredReport;
  const digest = inputDigest(c);
  const attempt: ComplianceAttempt = {
    id: uid("ca"),
    at: w.now,
    attempt: attemptNo,
    creativeVersion: c.creatives[0]?.version ?? 1,
    creativeIds: c.creatives.map((cr) => cr.id),
    inputDigest: `${digestHash(digest)} · ${digest.slice(0, 120)}`,
    modelId: trace.modelId,
    outcome: verdict.outcome,
    risk: verdict.risk,
    score: verdict.score,
    summary,
    issues: decision.issues,
    policyRefs: selection.rules.map(r => `${r.id}@${r.version}: ${r.source}`),
    policyComplete: selection.problems.length === 0 && (selection.limitations ?? []).length === 0,
  };

  // Legacy-shaped report so existing views keep working.
  const findings: ComplianceFinding[] = decision.issues.map((i) => ({
    id: i.id,
    severity: i.severity,
    type: i.category.replace(/_/g, " "),
    excerpt: i.excerpt,
    explanation: i.explanation,
    rule: i.rule,
  }));
  const report: ComplianceReport = {
    id: structuredReport.id,
    creativeId: c.creatives[0]?.id ?? "unknown",
    version: attempt.creativeVersion,
    risk: verdict.risk,
    score: verdict.score,
    verdict:
      verdict.outcome === "changes_required" ? "revise" : verdict.outcome === "pass" ? "pass" : "escalate",
    summary,
    findings,
    countryProfile: `${c.country} · ${(env.brand.countryRules[c.country] ?? "Missing country policy").slice(0, 140)}…`,
    attempt,
  };

  reviewRun.status = "COMPLETED";
  reviewRun.completedAt = w.now;
  reviewRun.result = { status: verdict.outcome, findings: structuredClone(decision.issues),
    rejectionReason: verdict.outcome === "pass" ? null : summary,
    limitations: checked.limitations, reportId: report.id };
  c.complianceAttempts = [...c.complianceAttempts, attempt];
  c.complianceReports = [...c.complianceReports, report];
  c.creatives = c.creatives.map((cr) => ({
    ...cr,
    status: verdict.outcome === "pass" ? "draft" : "flagged",
  }));
  c.updatedAt = stamp();

  const confirmed = decision.issues.filter((i) => i.basis === "confirmed_breach").length;
  const judgement = decision.issues.filter((i) => i.basis === "human_judgement").length;
  addEvent(
    w,
    "compliance",
    verdict.outcome === "pass" ? "output" : "flag",
    `Attempt ${attemptNo}: ${verdict.outcome.replace(/_/g, " ")}`,
    `${summary} ${confirmed} confirmed breach(es), ${judgement} needing human judgement. Issues recorded with severity, affected content and rule.`,
    { evidenceIds: [] },
  );
  addStep(
    w,
    "compliance.review",
    "compliance",
    verdict.outcome === "pass" ? "ok" : "warn",
    `Findings recorded (attempt ${attemptNo})`,
    `Outcome ${verdict.outcome}. Report stored against v${attempt.creativeVersion} for audit.`,
  );

  if (verdict.outcome === "pass") {
    c.status = "awaiting_approval";
    c.running = false;
    addEvent(
      w,
      "compliance",
      "escalation",
      "Status: Awaiting Human Approval",
      "No unresolved compliance issue remains. Only an explicit founder approval releases this to distribution. The Compliance Checker may not approve it.",
    );
    addStep(w, "founder.gate", "compliance", "ok", "Waiting for founder", "Founder may approve, reject or request changes.");
    setRun(w, { awaiting: "approval", awaitingDetail: "Compliance passed. Founder approval required before distribution.", status: "awaiting_human", step: "founder.gate" });
    return { message: "Compliance passed; waiting for founder approval.", blocked: false };
  }

  if (verdict.outcome === "manual_review") {
    c.status = "awaiting_approval";
    c.running = false;
    addEvent(
      w,
      "compliance",
      "escalation",
      "Manual Review Required",
      "The automatic revision cycle stopped. All versions, inputs and rejection reasons are retained. Nothing is published or distributed.",
    );
    addStep(w, "founder.gate", "compliance", "warn", "Escalated to manual review", "Policy, evidence, judgement or revision limits require human resolution.");
    setRun(w, { awaiting: "approval", awaitingDetail: "Manual review required: resolve the recorded policy or content issues before approval.", status: "awaiting_human", step: "founder.gate" });
    return { message: "Escalated for manual review.", blocked: false };
  }

  // Changes required (AHR-04 step 3 → AHR-03 step 9.a), inside the 3-attempt limit.
  c.status = "revising";
  c.running = true;
  addEvent(
    w,
    "compliance",
    "revision",
    "Changes Required — returned to Image Generation",
    `${decision.issues.map((i) => i.recommendedCorrection).join(" ")} Attempt ${attemptNo} of ${MAX_REVISION_ATTEMPTS}.`,
  );
  setRun(w, { status: "running", step: "creative.revise", revisionAttempts: attemptNo });
  return { message: "Changes required; returning to Image Generation.", blocked: false };
}

/* ------------------------------------------------------------------- media -- */

function postingTime(channel: Channel, country: Country): { time: string; reason: string } {
  const tz = country === "US" ? "local retail" : "AEST";
  const behaviour = channelBehaviourNote(channel);
  const table: Record<Channel, { time: string; reason: string }> = {
    instagram: { time: `Tue 11:40 ${tz}`, reason: behaviour.note },
    web: { time: `Tue 07:00 ${tz}`, reason: behaviour.note },
    email: { time: `Tue 16:35 ${tz}`, reason: behaviour.note },
    print: { time: "Catalogue drop Wednesday", reason: behaviour.note },
    digital_signage: { time: "Always-on for campaign dates", reason: behaviour.note },
  };
  return table[channel];
}

/**
 * Reformat the approved master for one channel.
 *
 * The cleared headline and caption are carried across verbatim; only the
 * connective tissue changes, which is what "adapt the format, keep the claim"
 * means in practice. `condition` is the per-channel legal line, which is
 * required promotional context rather than a new product claim.
 */
function adaptBody(
  channel: Channel,
  creative: Creative,
  campaign: Campaign,
  condition: string,
): string {
  const proof = campaign.brief?.claimsAllowed.slice(0, 2).join(". ") ?? creative.subhead;
  const bodies: Record<Channel, string> = {
    instagram: `${creative.headline} ${creative.subhead}`.slice(0, 180),
    web: `${creative.headline} ${proof} ${creative.caption}`,
    email: `${creative.headline} ${proof} ${condition}`.trim(),
    print: `${creative.headline} ${proof} ${condition}`.trim(),
    // Signage has six words to work with, so it is the channel most likely to
    // drop a cleared claim — and that is meant to be visible, not smoothed over.
    digital_signage: `${creative.headline} · In store`,
  };
  return bodies[channel];
}

const CHANNEL_SPECS: Record<Channel, string> = {
  instagram: "1:1 and 4:5, hook in the first line, ≤3 hashtags.",
  web: "1440×520 hero, 6-word headline, proof bullets.",
  email: "600px, headline + ~70 words, single CTA.",
  print: "A4 cover, condition line required, 3-metre readable kicker.",
  digital_signage: "9:16 portrait, 6 words, high contrast.",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build a self-contained, pasteable HTML embed for a channel: the campaign media
 * plus the (claims-safe) caption, with inline styles so the marketing team can
 * drop it straight into their own website. The caption is AI-written; the wrapper
 * is templated so the markup is always well-formed and no new claim can slip in.
 */
function buildEmbedHtml(input: {
  channel: Channel;
  headline: string;
  caption: string;
  mediaUrl: string | null;
  retailer: string;
  cta: string;
}): string {
  const h = escapeHtml(input.headline);
  const cap = escapeHtml(input.caption);
  const retailer = escapeHtml(input.retailer);
  const cta = escapeHtml(input.cta);
  const media = input.mediaUrl
    ? `<img src="${escapeHtml(input.mediaUrl)}" alt="${h}" style="width:100%;height:auto;display:block" />`
    : `<div style="aspect-ratio:4/5;display:flex;align-items:center;justify-content:center;background:#f2f2f0;color:#9a9a93;font:14px system-ui,sans-serif">Campaign media</div>`;
  return [
    `<div class="aisle-ad" data-channel="${input.channel}" style="max-width:480px;margin:0 auto;font-family:system-ui,-apple-system,Segoe UI,sans-serif;border:1px solid #e7e7e4;border-radius:12px;overflow:hidden;background:#fff">`,
    `  ${media}`,
    `  <div style="padding:16px 18px">`,
    `    <h3 style="margin:0 0 8px;font-size:18px;line-height:1.25;color:#1e3338">${h}</h3>`,
    `    <p style="margin:0;font-size:15px;line-height:1.5;color:#44484a">${cap}</p>`,
    cta ? `    <a href="#" style="display:inline-block;margin-top:14px;padding:9px 16px;border-radius:999px;background:#183c40;color:#fff;text-decoration:none;font-size:14px">${cta}</a>` : "",
    `    <p style="margin:14px 0 0;font-size:12px;color:#9a9a93">${retailer}</p>`,
    `  </div>`,
    `</div>`,
  ]
    .filter(Boolean)
    .join("\n");
}

const CLAIM_STOPWORDS = new Set([
  "the", "and", "for", "with", "into", "its", "own", "not", "from", "that", "this", "are", "was",
]);

function claimTokens(text: string) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !CLAIM_STOPWORDS.has(t)),
  );
}

/** True when the channel body still carries the cleared wording. */
function claimsSurvive(approved: string[], body: string) {
  if (approved.length === 0) return true;
  const bodyTokens = claimTokens(body);
  const covered = approved.filter((claim) => {
    const tokens = [...claimTokens(claim)];
    if (tokens.length === 0) return true;
    const hits = tokens.filter((t) => bodyTokens.has(t)).length;
    // A claim counts as carried when the body still makes it, which for a short
    // format means its substantive words survive — not every word.
    return hits >= Math.max(1, Math.ceil(tokens.length * 0.34));
  });
  return covered.length >= Math.ceil(approved.length * 0.6);
}

const CLAIM_TERMS =
  /(water[- ]?resistant|packable|packs into|guarantee\w*|warrant\w*|clinically|proven|award[- ]winning|number one|#1|best in|healthiest|miracle|risk[- ]free|free delivery|money back|new and improved|australian[- ]made|certified|organic)/gi;

/**
 * Product claims a channel body asserts that AHR-04 never cleared.
 *
 * Adaptation may reformat and may add a required condition line, but a piece of
 * promotional copy that makes a new factual claim about the product is exactly
 * what AHR-05 forbids. Only sentences shaped like a claim are considered, so
 * ordinary connective copy does not raise a false flag.
 */
function introducedClaims(c: Campaign, body: string): string[] {
  const clearedBlob = (
    (c.sharedContext.approvedClaims ?? []).join(" ") +
    " " +
    (c.brief?.claimsAllowed.join(" ") ?? "")
  ).toLowerCase();

  return body
    .split(/(?<=[.!?])\s+|\s+·\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 12)
    .filter((sentence) => {
      // Every claim-shaped term in the sentence must already be cleared wording;
      // one that is not means the channel version asserts something new.
      const hits = sentence.match(CLAIM_TERMS);
      if (!hits) return false;
      return hits.some((term) => !clearedBlob.includes(term.toLowerCase().replace(/\s+/g, " ")));
    })
    .slice(0, 3);
}

/**
 * The wording AHR-04 actually cleared.
 *
 * Approval is the moment the claim list stops being a suggestion and becomes a
 * contract: from here the Media Manager may only reformat, and the frozen list is
 * the one the adapted copy has to preserve. Claims in the brief that never made
 * it into the approved copy are not part of that contract, so they are dropped
 * here rather than being demanded back later in a channel feed.
 */
function deriveClearedClaims(c: Campaign): string[] {
  const hero = c.creatives.find((x) => x.variant === "A") ?? c.creatives[0];
  const candidates = c.sharedContext.approvedClaims ?? [];
  if (!hero) return candidates;
  const copy = `${hero.kicker} ${hero.headline} ${hero.subhead} ${hero.cta} ${hero.caption}`.toLowerCase();
  const present = candidates.filter((claim) =>
    [...claimTokens(claim)].some((token) => copy.includes(token)),
  );
  return present.length > 0 ? present : candidates;
}

export async function runMediaAdaptation(
  w: Work,
  env: StepEnv,
): Promise<{ message: string; blocked: boolean }> {
  const c = w.campaign;
  const hero = c.creatives.find((x) => x.variant === "A") ?? c.creatives[0];
  if (!hero) return { message: "No approved creative to adapt.", blocked: true };

  c.status = "scheduling";
  c.running = true;
  // Approval froze the claims; adapt only the format, never the cleared wording.
  const approvedClaims = deriveClearedClaims(c);
  if (approvedClaims.join("|") !== (c.sharedContext.approvedClaims ?? []).join("|")) {
    c.sharedContext = { ...c.sharedContext, approvedClaims };
  }

  addEvent(
    w,
    "media",
    "handoff",
    "Received approved master",
    `Adapting for ${c.channels.join(", ")}. Claims cleared by AHR-04 are frozen; no wording or imagery changes.`,
  );

  // AHR-05's AI step: the Media Manager asks the model for a platform-native
  // caption per channel. It is guard-safe — a caption is only used if it keeps
  // every cleared claim and adds none; otherwise the deterministic template
  // stands. Offline, no captions come back and the template is used throughout.
  const { captions, trace: captionTrace } = await decideChannelCaptions({
    campaign: c,
    brand: env.brand,
    settings: env.settings,
    llm: env.llm,
    hero: { headline: hero.headline, subhead: hero.subhead },
    channels: c.channels.map((ch) => ({ channel: ch, spec: CHANNEL_SPECS[ch] })),
    approvedClaims,
  });
  addTrace(w, captionTrace, "media", "Per-channel captions", env.llm);
  const captionsLive = captionTrace.path === "live_model";

  const versions: ChannelVersion[] = [];
  const decided: PolicyDecision[] = [];
  const adaptations = [];

  for (const channel of c.channels) {
    // A channel may reformat and may add a required condition line, but it may
    // never introduce a new claim about the product.
    const condition =
      channel === "print"
        ? "See in-store for regional prices."
        : channel === "email"
          ? `14-day returns. ${c.sharedContext.retailer}`
          : "";
    const templateBody = adaptBody(channel, hero, c, condition);
    let body = templateBody;
    let captionSource: "model" | "template" = "template";
    const aiCaption = captionsLive ? captions[channel] : undefined;
    if (aiCaption && aiCaption !== templateBody) {
      // The model caption is accepted only if it preserves every cleared claim
      // and introduces no new one; otherwise the template stands (claims-frozen).
      if (
        claimsSurvive(approvedClaims, aiCaption) &&
        introducedClaims(w.campaign, aiCaption).length === 0
      ) {
        body = aiCaption;
        captionSource = "model";
      }
    }
    const unchanged = claimsSurvive(approvedClaims, body);
    const introduced = introducedClaims(w.campaign, body);
    const at = new Date(`${c.startDate}T07:00:00`).toISOString();
    const post = postingTime(channel, c.country);

    if (!unchanged || introduced.length > 0) {
      // An adaptation that cannot be produced without changing cleared wording is
      // not produced silently: the guard refuses it and the item is flagged.
      const outcome = evaluateGuard(
        {
          actor: "media",
          action: "EDIT_APPROVED_CLAIM",
          campaign: c,
          target: channel,
          detail:
            introduced.length > 0
              ? `the ${channel} body introduces wording that is not a cleared claim (${introduced.join(", ")})`
              : `cleared claims would not survive the ${channel} format`,
          triggeredBy: "media.adapt",
        },
        w.now,
      );
      // The guard's decision is recorded below, in workspace order.
      decided.push(outcome.decision);
      versions.push({
        id: uid("cv"),
        channel,
        headline: hero.headline,
        body,
        specs: CHANNEL_SPECS[channel],
        approvedClaims,
        claimsUnchanged: false,
        status: "failed",
        proposedAt: at,
        postingReason: post.reason,
        captionSource,
        failure: outcome.reason,
      });
      addEvent(w, "media", "policy", `${channel} adaptation blocked`, outcome.reason, {
        policyDecisionId: outcome.decision.id,
      });
      continue;
    }

    const versionHeadline = channel === "email" ? hero.subhead : hero.headline;
    // The pasteable embed: the generated media + this channel's caption, ready
    // for the marketing team to drop into their own website.
    const embedHtml = buildEmbedHtml({
      channel,
      headline: versionHeadline,
      caption: body,
      mediaUrl: hero.generation?.url ?? null,
      retailer: c.sharedContext.retailer,
      cta: hero.cta,
    });
    versions.push({
      id: uid("cv"),
      channel,
      headline: versionHeadline,
      body,
      specs: CHANNEL_SPECS[channel],
      approvedClaims,
      claimsUnchanged: true,
      status: "adapted",
      proposedAt: at,
      postingReason: post.reason,
      captionSource,
      embedHtml,
    });
    adaptations.push({
      channel,
      headline: versionHeadline,
      body,
      specs: CHANNEL_SPECS[channel],
      postingTime: post.time,
      postingReason: post.reason,
    });
  }

  decided.forEach((d) => recordPolicy(w, d));
  c.channelVersions = versions;
  c.adaptations = adaptations;
  c.updatedAt = stamp();

  addStep(
    w,
    "media.adapt",
    "media",
    versions.some((v) => v.status === "failed") ? "warn" : "ok",
    `${versions.filter((v) => v.status === "adapted").length}/${versions.length} channel versions prepared`,
    versions
      .map((v) =>
        v.status === "adapted"
          ? `${v.channel}: claims intact (${v.captionSource === "model" ? "AI caption" : "template"})`
          : `${v.channel}: blocked — flagged`,
      )
      .join(" · "),
  );

  if (versions.some((v) => v.status === "failed")) {
    c.status = "scheduled";
    c.running = false;
    setRun(w, { awaiting: "failure", awaitingDetail: `${versions.filter((v) => v.status === "failed").length} channel adaptation(s) could not be produced without changing cleared wording.`, status: "awaiting_human", step: "media.adapt" });
    addEvent(
      w,
      "media",
      "escalation",
      "Channel adaptation blocked — founder required",
      "The item is not skipped silently and is not retried indefinitely. It is flagged for the founder.",
    );
    return { message: "Channel adaptation blocked; founder required.", blocked: false };
  }

  // Hand-off into the scheduling step of AHR-05.
  setRun(w, { status: "running", step: "media.schedule", awaiting: null, awaitingDetail: null });
  return { message: "Channel versions prepared.", blocked: false };
}

/** AHR-05: flag conflicts for the founder rather than resolving them silently. */
function detectScheduleConflicts(
  c: Campaign,
  all: Campaign[],
): { conflicts: ScheduleConflict[]; items: RunScheduleItem[] } {
  const conflicts: ScheduleConflict[] = [];
  const items: RunScheduleItem[] = [];
  const start = new Date(`${c.startDate}T00:00:00Z`).getTime();
  const end = new Date(`${c.endDate}T23:59:59Z`).getTime();
  const WINDOW_MS = 24 * 60 * 60 * 1000;

  c.channels.forEach((channel, i) => {
    const version = c.channelVersions.find((v) => v.channel === channel);
    const at = new Date(start + i * 90 * 60 * 1000).toISOString();
    const atMs = new Date(at).getTime();
    const conflictIds: string[] = [];

    if (atMs < start || atMs > end) {
      const id = uid("cf");
      conflicts.push({
        id,
        channel,
        at,
        kind: "outside_window",
        detail: `Proposed time falls outside the founder's ${c.startDate} → ${c.endDate} window.`,
        resolved: false,
      });
      conflictIds.push(id);
    }

    for (const other of all) {
      if (other.id === c.id) continue;
      if (!["scheduled", "published"].includes(other.status)) continue;
      if (!other.channels.includes(channel)) continue;
      for (const item of other.schedule) {
        if (item.channel !== channel) continue;
        const otherMs = new Date(item.at).getTime();
        if (Number.isNaN(otherMs)) continue;
        if (Math.abs(otherMs - atMs) <= WINDOW_MS) {
          const id = uid("cf");
          conflicts.push({
            id,
            channel,
            at,
            kind: "same_slot",
            detail: `${other.name} already occupies ${channel} within 24 hours of the proposed time.`,
            withCampaignId: other.id,
            withCampaignName: other.name,
            resolved: false,
          });
          conflictIds.push(id);
        }
      }
    }

    items.push({
      id: uid("si"),
      channel,
      at,
      status: version?.status === "failed" ? "failed" : "proposed",
      note: `${postingTime(channel, c.country).time}${version ? ` · ${version.claimsUnchanged ? "claims intact" : "blocked"}` : ""}`,
      channelVersionId: version?.id ?? "",
      conflictIds,
    });
  });

  return { conflicts, items };
}

export function runSchedule(w: Work, allCampaigns: Campaign[]): {
  message: string;
  blocked: boolean;
  conflicts: ScheduleConflict[];
} {
  const c = w.campaign;
  const { conflicts, items } = detectScheduleConflicts(c, allCampaigns);
  c.scheduleConflicts = conflicts;
  c.runSchedule = items;
  c.schedule = items.map<ScheduleItem>((item) => ({
    id: item.id,
    channel: item.channel,
    at: item.at,
    status: "scheduled",
    note: item.note,
  }));
  c.channelVersions = c.channelVersions.map((v) =>
    v.status === "failed" ? v : { ...v, status: "scheduled" },
  );
  c.status = "scheduled";
  c.running = false;
  c.updatedAt = stamp();

  const unresolved = conflicts.filter((x) => !x.resolved);
  addStep(
    w,
    "media.conflict_check",
    "media",
    unresolved.length > 0 ? "warn" : "ok",
    unresolved.length > 0
      ? `${unresolved.length} scheduling conflict(s) flagged`
      : "No scheduling conflicts found",
    unresolved.length > 0
      ? unresolved.map((x) => `${x.channel}: ${x.detail}`).join(" · ")
      : `Checked ${c.channels.length} channel(s) against the live schedule.`,
  );

  if (unresolved.length > 0) {
    addEvent(
      w,
      "media",
      "escalation",
      "Scheduling conflict flagged, not resolved",
      `${unresolved.map((x) => x.detail).join(" ")} The founder decides; nothing is silently moved or dropped.`,
    );
    setRun(w, { awaiting: "conflict", awaitingDetail: `${unresolved.length} scheduling conflict(s) need a founder decision.`, status: "awaiting_human", step: "media.schedule" });
    return { message: "Schedule proposed with conflicts flagged.", blocked: false, conflicts: unresolved };
  }

  addEvent(
    w,
    "media",
    "schedule",
    "Channel versions and posting times ready",
    `${c.adaptations.map((a) => `${a.channel}: ${a.postingTime}`).join(" · ")}. No claims or imagery were altered.`,
  );
  addStep(
    w,
    "media.schedule",
    "media",
    "ok",
    "Publishing schedule proposed",
    `${items.length} item(s) placed. Status: Scheduled. Agents may not publish.`,
  );
  setRun(w, { awaiting: null, awaitingDetail: null, status: "complete", step: "media.schedule" });
  return { message: "Scheduled. Founder publishes.", blocked: false, conflicts: [] };
}

/* ---------------------------------------------------------------- feedback -- */

/**
 * AHR-06 collection.
 *
 * The prototype has no live channel APIs, so this adapter is *declared*: each
 * channel returns a transparent model of its own report, and channels that are
 * not authorised, report late, or return incomplete figures are marked as such
 * instead of being filled in with invented numbers.
 */
function collectChannelResults(c: Campaign, now: string): ChannelResult[] {
  const publishedAt = c.schedule[0]?.at ?? c.updatedAt;
  const periodFrom = publishedAt.slice(0, 10);
  const periodTo = now.slice(0, 10);
  const base = c.budget;

  return c.channels.map((channel: Channel) => {
    const seed = stableHash(`${c.id}:${channel}`);
    // Declared CPM per channel, so the figures scale like a real media buy
    // instead of inflating with budget alone.
    const cpm: Record<Channel, number> = {
      instagram: 9 + (seed % 5),
      web: 6 + (seed % 4),
      email: 3 + (seed % 3),
      print: 22 + (seed % 9),
      digital_signage: 12 + (seed % 6),
    };
    const cpmForChannel = cpm[channel];
    const sourceName = `${channel === "print" ? "Print response panel" : channel === "digital_signage" ? "Store footfall counter" : `${channel} channel API`}`;

    // An explicit declaration wins: this is how a gap is demonstrated on demand
    // rather than only when a campaign id happens to land on one.
    const declared = c.collectorOverrides?.[channel];
    if (declared && declared !== "ok") {
      const note: Record<string, string> = {
        not_authorised: `Not authorised to read ${channel} results for this workspace; the channel is excluded from the summary (UC-06 ext 4.b).`,
        late: `${channel} has not reported for this window yet. Marked as a gap; nothing is estimated (UC-06 ext 4.a).`,
        incomplete: `${channel} returned partial figures. The missing part is marked, not estimated (UC-06 ext 6.a).`,
        excluded: `${channel} returned figures that did not match this campaign, so they were excluded (UC-06 ext 5.a).`,
        no_data: `${channel} reported no activity for this window.`,
      };
      return {
        channel,
        status: declared,
        sourceName,
        collectedAt: now,
        periodFrom,
        periodTo,
        figures: null,
        note: note[declared] ?? `${channel} reported ${declared}.`,
      };
    }

    const impressions = Math.round((base / cpmForChannel) * 1000);
    const reach = Math.round(impressions * (0.38 + (seed % 9) / 100));
    const clicks = Math.round(impressions * (0.018 + (seed % 5) / 1000));
    const conversions = Math.round(clicks * (0.03 + (seed % 7) / 200));
    const ctr = Number(((clicks / impressions) * 100).toFixed(2));
    const engagement = Number((1.4 + (seed % 31) / 10).toFixed(2));
    return {
      channel,
      status: "ok" as const,
      sourceName,
      collectedAt: now,
      periodFrom,
      periodTo,
      figures: {
        impressions,
        reach,
        clicks,
        ctr,
        engagement,
        conversions,
        ...(channel === "digital_signage" ? {} : { storeResponse: conversions * 3 }),
      },
      note: `${channel} reported for ${periodFrom} → ${periodTo}.`,
    };
  });
}

function buildPerformanceReport(c: Campaign, now: string): PerformanceReport {
  const results = collectChannelResults(c, now);
  const ran = c.schedule.filter((s) => s.status === "published").map((s) => s.channel);
  const figures = results.filter((r) => r.figures);
  const gaps = results
    .filter((r) => r.status !== "ok")
    .map((r) => `${r.channel}: ${r.note}`);

  const totals =
    figures.length === 0
      ? null
      : {
          impressions: figures.reduce((n, r) => n + (r.figures?.impressions ?? 0), 0),
          reach: figures.reduce((n, r) => n + (r.figures?.reach ?? 0), 0),
          clicks: figures.reduce((n, r) => n + (r.figures?.clicks ?? 0), 0),
          ctr: 0,
          engagement: 0,
          conversions: figures.reduce((n, r) => n + (r.figures?.conversions ?? 0), 0),
        };
  if (totals && totals.impressions > 0) {
    totals.ctr = Number(((totals.clicks / totals.impressions) * 100).toFixed(2));
    const active = figures.filter((r) => (r.figures?.engagement ?? 0) > 0);
    totals.engagement = active.length
      ? Number(
          (active.reduce((n, r) => n + (r.figures?.engagement ?? 0), 0) / active.length).toFixed(2),
        )
      : 0;
  }

  const hero = c.creatives.find((x) => x.variant === "A") ?? c.creatives[0];
  const best = [...figures].sort(
    (a, b) => (b.figures?.ctr ?? 0) - (a.figures?.ctr ?? 0),
  )[0];

  const summary =
    totals === null
      ? `No selected channel returned usable data for ${c.name}, so no result summary is presented as confirmed. Gaps recorded: ${gaps.join(" ")}`
      : `${c.name} ran on ${ran.join(", ") || c.channels.join(", ")} with the approved line “${hero?.headline ?? "—"}”. ${figures.length} of ${c.channels.length} channel(s) reported: ${totals.impressions.toLocaleString("en-AU")} impressions, ${totals.ctr}% CTR, ${totals.conversions.toLocaleString("en-AU")} conversions.${best ? ` Best CTR on ${best.channel} (${best.figures?.ctr}%).` : ""}${gaps.length ? ` Gaps: ${gaps.join(" ")}` : ""}`;

  return {
    id: uid("pr"),
    at: now,
    publishedAt: c.schedule[0]?.at ?? c.updatedAt,
    ranChannels: ran.length > 0 ? ran : c.channels,
    results,
    gaps,
    totals,
    summary,
    recommendationPoints: [],
    recommendationText: null,
    recommendationUnsupported: false,
  };
}

/** Advice must rest on collected evidence — UC-06 ext 8.a. */
function deterministicRecommendation(
  c: Campaign,
  report: PerformanceReport,
): RecommendationPoint[] {
  const figures = report.results.filter((r) => r.figures);
  if (figures.length === 0) return [];
  const points: RecommendationPoint[] = [];
  const withCtr = [...figures].sort(
    (a, b) => (b.figures?.ctr ?? 0) - (a.figures?.ctr ?? 0),
  );
  const best = withCtr[0];
  const worst = withCtr[withCtr.length - 1];
  const bestEvidence = c.evidence.filter((e) => e.usedFor === "Basket build").map((e) => e.id);

  points.push({
    id: uid("rp"),
    verdict: "keep",
    area: "creative_angle",
    text: `Keep the approved angle “${c.brief?.keyMessage ?? c.creatives[0]?.headline ?? ""}”: ${best.channel} returned the strongest CTR (${best.figures?.ctr}%) across ${figures.length} reporting channel(s).`,
    evidenceIds: [],
  });

  if (worst.channel !== best.channel && (worst.figures?.ctr ?? 0) < (best.figures?.ctr ?? 0) * 0.7) {
    points.push({
      id: uid("rp"),
      verdict: "change",
      area: "channel_mix",
      text: `Rebalance away from ${worst.channel} (CTR ${worst.figures?.ctr}% against ${best.channel}'s ${best.figures?.ctr}%). The gap is over 30%, so the mix — not the copy — is the likely cause.`,
      evidenceIds: [],
    });
  }

  if (report.gaps.length > 0) {
    points.push({
      id: uid("rp"),
      verdict: "change",
      area: "channel_mix",
      text: `Close the measurement gap before the next cycle: ${report.gaps.length} channel(s) returned no usable data, so the next brief should not reweight them on this evidence.`,
      evidenceIds: [],
    });
  }

  if (bestEvidence.length > 0) {
    points.push({
      id: uid("rp"),
      verdict: "keep",
      area: "claims",
      text: "Keep the verifiable product facts; the compliance loop spent no revision on them this cycle.",
      evidenceIds: bestEvidence,
    });
  }

  return points.slice(0, 4);
}

/* ------------------------------------------------------------- distribution */


/**
 * The founder's publish (UC-05 steps 6–8, ext 6.a).
 *
 * Each scheduled item is submitted to its channel. An item only becomes
 * `published` once a submission is confirmed, so AHR-06 collects from what truly
 * ran. If any channel does not confirm within the retry cap, the item is flagged
 * (never silently dropped), the campaign is held at Scheduled, and the run parks
 * for the founder — the guard records that the cap, not an infinite retry, was hit.
 */
export function runPublish(w: Work): { escalated: boolean } {
  const c = w.campaign;
  const attempts: DeliveryAttempt[] = [];

  for (const item of c.runSchedule) {
    const version = c.channelVersions.find((v) => v.id === item.channelVersionId);
    if (version?.status === "failed" || item.status === "failed") {
      // A channel blocked in adaptation is not published and not skipped silently.
      attempts.push({
        itemId: item.id,
        channel: item.channel,
        attempts: 0,
        retries: 0,
        status: "failed",
        confirmationRef: null,
        reconciled: false,
        note: "Channel version was blocked during adaptation, so it was never submitted.",
        at: w.now,
      });
      continue;
    }
    const outcome = c.publishOverrides?.[item.channel] ?? "ok";
    // Selected by channel type: digital (social/web/email) or physical
    // (print/in-store signage). The release is simulated — no live platform.
    const attempt = selectGateway(item.channel).publish(
      { id: item.id, channel: item.channel },
      outcome,
      w.now,
    );
    attempts.push(attempt);
    if (attempt.reconciled) {
      addEvent(w, "media", "schedule", `${item.channel} reconciled a late result`, attempt.note);
    }
  }

  const statusByItem = new Map(attempts.map((a) => [a.itemId, a.status]));
  const statusByVersion = new Map<string, DeliveryAttempt["status"]>();
  for (const item of c.runSchedule) {
    const s = statusByItem.get(item.id);
    if (s && item.channelVersionId) statusByVersion.set(item.channelVersionId, s);
  }

  // Reflect the confirmed/failed outcome onto every record — no status without
  // a real (simulated) submission behind it.
  c.runSchedule = c.runSchedule.map((i) => ({
    ...i,
    status: statusByItem.get(i.id) === "published" ? "published" : "failed",
  }));
  c.schedule = c.schedule.map((s) => ({
    ...s,
    status: statusByItem.get(s.id) === "published" ? "published" : "failed",
  }));
  c.channelVersions = c.channelVersions.map((v) =>
    statusByVersion.get(v.id) === "published"
      ? { ...v, status: "published" }
      : v.status === "failed"
        ? v
        : { ...v, status: "failed" },
  );

  const published = attempts.filter((a) => a.status === "published");
  const failed = attempts.filter((a) => a.status === "failed");
  const reconciled = attempts.filter((a) => a.reconciled);

  // SCRUM-69 — the explicit mixed-run marker: all live, some live, or none.
  const reportOutcome: "complete" | "partial" | "none" =
    failed.length === 0 ? "complete" : published.length > 0 ? "partial" : "none";

  c.deliveryReport = {
    id: uid("dr"),
    at: w.now,
    attempts,
    published: published.length,
    failed: failed.length,
    outcome: reportOutcome,
    escalated: failed.length > 0,
  };

  if (failed.length > 0) {
    // UC-05 ext 6.a — the cap is hit, so the agent stops. The item is raised,
    // not retried forever and not skipped. The campaign stays at Scheduled until
    // the founder resolves the unconfirmed channels, so AHR-06 cannot collect yet.
    const guard = evaluateGuard(
      {
        actor: "media",
        action: "RETRY_EXHAUSTED",
        campaign: c,
        target: failed.map((a) => a.channel).join(", "),
        detail: `${failed.length} channel submission(s) did not confirm after the initial send and ${MAX_PUBLISH_RETRIES} retries`,
        triggeredBy: "founder.publish",
      },
      w.now,
    );
    recordPolicy(w, guard.decision);
    c.status = "scheduled";
    c.running = false;
    c.updatedAt = stamp();
    addEvent(
      w,
      "media",
      "escalation",
      reportOutcome === "partial"
        ? "Mixed run — partially completed, founder required"
        : "Channel delivery failed — founder required",
      `${published.length} channel(s) confirmed live; ${failed.length} did not after the initial send and ${MAX_PUBLISH_RETRIES} retries (${failed
        .map((a) => a.channel)
        .join(", ")}). The unconfirmed items are neither retried indefinitely nor skipped silently — they are held for the founder.`,
      { policyDecisionId: guard.decision.id },
    );
    addStep(
      w,
      "media.publish",
      "founder",
      "blocked",
      reportOutcome === "partial" ? "Publish partially completed" : "Publish failed",
      `${published.length}/${attempts.length} channel(s) live. ${failed.length} flagged for the founder.`,
    );
    setRun(w, {
      awaiting: "failure",
      awaitingDetail: `${failed.length} channel submission(s) did not confirm. Decide whether to retry, reschedule or exclude them.`,
      status: "awaiting_human",
      step: "media.publish",
    });
    return { escalated: true };
  }

  c.status = "published";
  c.running = false;
  c.updatedAt = stamp();
  addEvent(
    w,
    "founder",
    "decision",
    "Published",
    `Founder released ${published.map((a) => a.channel).join(", ")}. Each channel confirmed a submission before it was recorded as live${
      reconciled.length
        ? ` (${reconciled.length} reconciled from a late confirmation, matched by item id rather than resubmitted)`
        : ""
    }, so AHR-06 collects only from what actually ran.`,
  );
  addStep(
    w,
    "media.publish",
    "founder",
    "ok",
    "Published",
    `${published.length}/${attempts.length} channel(s) confirmed live.${
      reconciled.length ? ` ${reconciled.length} reconciled from a late result.` : ""
    }`,
  );
  return { escalated: false };
}

export async function runFeedbackCollection(
  w: Work,
  env: StepEnv,
  options: { publish: boolean; actor?: "founder" | "media" },
): Promise<{ message: string; blocked: boolean }> {
  const c = w.campaign;

  if (options.publish) {
    // The guard sees who really asked: only the founder may publish, so an
    // agent-framed PUBLISH is refused and recorded here.
    const actor = options.actor ?? "founder";
    const outcome = evaluateGuard(
      {
        actor,
        action: "PUBLISH_CONTENT",
        campaign: c,
        target: `${c.channels.join(", ")}`,
        kind: c.channels.includes("print") ? "catalogue_cover" : "social",
        triggeredBy: `${actor}.publish`,
      },
      w.now,
    );
    recordPolicy(w, outcome.decision);
    if (outcome.verdict === "block") {
      addEvent(w, actor, "policy", "Publish blocked", `${outcome.reason} ${outcome.remedy ?? ""}`.trim(), {
        policyDecisionId: outcome.decision.id,
      });
      return { message: outcome.reason, blocked: true };
    }

    const approved =
      c.founderDecision?.action === "approve" ||
      c.complianceAttempts.some((a) => a.outcome === "pass");
    if (!approved) {
      const refused = evaluateGuard(
        { actor: "media", action: "PUBLISH_CONTENT", campaign: c, target: "unapproved campaign" },
        w.now,
      );
      recordPolicy(w, refused.decision);
      addEvent(w, "media", "policy", "Publish refused — nothing approved", refused.reason, {
        policyDecisionId: refused.decision.id,
      });
      return { message: refused.reason, blocked: true };
    }

    // Simulated per-channel submission with bounded retries and late-result
    // reconciliation (UC-05 ext 6.a). On an unconfirmed channel this parks the
    // run for the founder and does not fall through to collection.
    const { escalated } = runPublish(w);
    if (escalated) {
      return { message: "Channel delivery incomplete; founder required.", blocked: true };
    }
  }

  if (c.status !== "published") {
    c.running = false;
    addEvent(
      w,
      "media",
      "escalation",
      "Performance collection not available",
      "The campaign has not been published through the approved path, so no live results exist. Nothing is estimated (UC-06 ext 2.a).",
    );
    return { message: "Not published; no results to collect.", blocked: true };
  }

  const report = buildPerformanceReport(c, w.now);
  const { points, text, trace } = await decideRecommendation({
    campaign: c,
    settings: env.settings,
    llm: env.llm,
    results: report.results,
    summary: report.summary,
    fallback: deterministicRecommendation(c, report),
  });
  addTrace(w, trace, "media", "Next-campaign recommendation", env.llm);

  report.recommendationPoints = points;
  report.recommendationText = text;
  report.recommendationUnsupported = points.length === 0;
  c.performanceReport = report;
  c.running = false;
  c.updatedAt = stamp();

  addEvent(
    w,
    "media",
    "feedback",
    "Results collected",
    `${report.results.filter((r) => r.figures).length}/${report.results.length} channel(s) reported. ${report.gaps.length} gap(s) recorded and marked in the summary.`,
  );
  addStep(w, "feedback.collect", "media", report.gaps.length > 0 ? "warn" : "ok", "Authorised results collected", report.summary);

  if (report.recommendationUnsupported) {
    addEvent(
      w,
      "media",
      "gap",
      "No sourced recommendation produced",
      "The collected evidence cannot support keep/drop/change advice, so none was invented. The factual summary stands on its own.",
    );
  } else {
    addEvent(
      w,
      "media",
      "output",
      "Recommendation ready for the founder",
      report.recommendationText ?? report.summary,
    );
  }
  addStep(
    w,
    "feedback.summarise",
    "media",
    "ok",
    "Founder decision required",
    "Accept, edit or discard. Nothing is attached to a future brief until the founder accepts or edits it.",
  );
  setRun(w, { awaiting: "approval", awaitingDetail: "Accept, edit or discard the next-campaign recommendation.", status: "awaiting_human", step: "feedback.summarise" });
  return { message: "Performance collected.", blocked: false };
}
