/**
 * Agent step handlers.
 *
 * Each export advances exactly one unit of work and returns a message for the run
 * trace. They are deliberately framework-free: the Next.js route handler, the
 * client store and any future worker all call the same `runEngine`.
 */

import { uid } from "@/lib/ids";
import type { MediaGeneration } from "@/lib/media/types";
import { makeLog } from "@/lib/seed";
import type { WorkspaceSettings } from "@/lib/settings";
import type {
  BrandProfile,
  Campaign,
  CampaignBrief,
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
  decideCompliance,
  decideCopy,
  decideRecommendation,
  decideTrendBrief,
  type CopyVariant,
  type DecisionTrace,
  type LlmRuntime,
  type TrendDecision,
} from "./decide";
import { evaluateGuard } from "./guard";
import { digestHash, inputDigest } from "./intake";
import { channelBehaviourNote, toolByName, toToolCall, type ToolOutcome } from "./tools";
import {
  MAX_REVISION_ATTEMPTS,
  type Actor,
  type ChannelResult,
  type ChannelVersion,
  type ComplianceAttempt,
  type ComplianceIssue,
  type ComplianceOutcome,
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
  /** Every campaign in the workspace, for cross-campaign scheduling checks. */
  allCampaigns: Campaign[];
  /**
   * Render the poster for a creative. Injected so the engine stays independent of
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
  const event = makeLog(agent as Parameters<typeof makeLog>[0], kind, title, detail, w.now);
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

export function addEvidence(w: Work, list: Evidence[]) {
  if (list.length === 0) return;
  w.campaign.evidence = [...w.campaign.evidence, ...list];
}

export function recordPolicy(w: Work, decision: PolicyDecision) {
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

export function addTrace(w: Work, trace: DecisionTrace, agent: Actor, purpose: string) {
  addEvent(
    w,
    agent,
    "insight",
    `${purpose} · ${trace.modelName}`,
    `${trace.path === "live_model" ? "LLM decision" : "Deterministic rules"} · ${trace.status} · est. $${trace.usage.costUsd.toFixed(4)} · ${trace.usage.totalTokens} tokens. ${trace.note}`,
  );
  w.campaign.spend = {
    ...w.campaign.spend,
    inferenceUsd: Math.round((w.campaign.spend.inferenceUsd + trace.usage.costUsd) * 1e5) / 1e5,
  };
}

/* ------------------------------------------------------------------- trend -- */

type Motif = Creative["motif"];

export function motifPack(campaign: Campaign): Motif {
  const t = `${campaign.product} ${campaign.name} ${campaign.category} ${campaign.targetAudience}`.toLowerCase();
  if (/jacket|parka|coat|outerwear|hoodie|apparel|knit/.test(t)) return "campus";
  if (/fruit|yoghurt|yogurt|grocery|produce|catalogue|peach|plum|veg|milk/.test(t)) return "produce";
  if (/coffee|bean|pantry|chocolate/.test(t)) return "pantry";
  return "editorial";
}

export function palettesFor(motif: Motif): Record<"A" | "B", Palette> {
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

/** Version 1 deliberately carries the claims the banned list forbids. */
export function v1Copy(campaign: Campaign, motif: Motif): Record<"A" | "B", CopyVariant> {
  if (motif === "campus") {
    return {
      A: {
        variant: "A",
        kicker: "Northline · Winter 26",
        headline: "The warmest jacket in Australia",
        subhead: `Guaranteed dry through ${campaign.targetAudience.split(",")[0].toLowerCase()} weather.`,
        cta: "Shop the parka",
        caption: `New ${campaign.product}. The warmest jacket in Australia — guaranteed.`,
        prompt: "",
      },
      B: {
        variant: "B",
        kicker: "Drop",
        headline: "Winter, but make it campus.",
        subhead: "Australia's number one uni jacket. Risk-free warmth.",
        cta: "See the drop",
        caption: `${campaign.product} — number one on campus.`,
        prompt: "",
      },
    };
  }
  if (motif === "produce") {
    return {
      A: {
        variant: "A",
        kicker: "Week 34 · Catalogue",
        headline: "Australia's healthiest breakfast",
        subhead: "Clinically proven goodness. Stone fruit + yoghurt, guaranteed ripe.",
        cta: "Open the catalogue",
        caption: "Australia's healthiest breakfast, only at Lane & Co.",
        prompt: "",
      },
      B: {
        variant: "B",
        kicker: "Catalogue",
        headline: "Miracle mornings",
        subhead: "The healthiest shop in the neighbourhood.",
        cta: "See specials",
        caption: "Miracle produce, week 34.",
        prompt: "",
      },
    };
  }
  return {
    A: {
      variant: "A",
      kicker: campaign.category,
      headline: `Australia's best ${campaign.product}`,
      subhead: "Guaranteed results. Number one in its class.",
      cta: "Shop now",
      caption: `${campaign.product} — Australia's best. Guaranteed.`,
      prompt: "",
    },
    B: {
      variant: "B",
      kicker: campaign.category,
      headline: `${campaign.product}, miracle edition`,
      subhead: "Risk-free. Clinically proven. The healthiest choice.",
      cta: "Get it",
      caption: `Don't miss ${campaign.product}.`,
      prompt: "",
    },
  };
}

export function v2Copy(
  campaign: Campaign,
  motif: Motif,
  brief: CampaignBrief,
): Record<"A" | "B", CopyVariant> {
  if (motif === "campus") {
    return {
      A: {
        variant: "A",
        kicker: "Northline · Winter 26",
        headline: "Weatherproof. Not wilderness.",
        subhead: `The ${campaign.product}. Cut for 8am lectures and 6pm southerlies.`,
        cta: "Shop the parka",
        caption: `${campaign.product}. Water-resistant shell, packs into its pocket. Made for campus weather — Lane & Co.`,
        prompt: "",
      },
      B: {
        variant: "B",
        kicker: "Campus drop",
        headline: "Winter, but make it campus.",
        subhead: "Warmth that fits in a bag. No summit required.",
        cta: "See the drop",
        caption: `${campaign.product} — packable, water-resistant, priced like a neighbourhood shop.`,
        prompt: "",
      },
    };
  }
  if (motif === "produce") {
    const hero = campaign.product.split(/[+—]/)[0].trim();
    return {
      A: {
        variant: "A",
        kicker: "This week's catalogue",
        headline: `${hero} is in.`,
        subhead: `In season this week. ${campaign.product}.`,
        cta: "Open this week's catalogue",
        caption: `${campaign.product}. In season this week at Lane & Co.`,
        prompt: "",
      },
      B: {
        variant: "B",
        kicker: "Weekly",
        headline: `Make a week of ${hero.toLowerCase()}.`,
        subhead: "In season this week — trays at the front.",
        cta: "See specials",
        caption: `${campaign.product}. Catalogue this week.`,
        prompt: "",
      },
    };
  }
  return {
    A: {
      variant: "A",
      kicker: campaign.category,
      headline: brief.keyMessage,
      subhead: `${campaign.product} for ${campaign.targetAudience}. ${brief.angle}`,
      cta: "See the offer",
      caption: `${campaign.product} — ${brief.angle} Lane & Co.`,
      prompt: "",
    },
    B: {
      variant: "B",
      kicker: campaign.category,
      headline: campaign.product,
      subhead: brief.angle,
      cta: "Shop",
      caption: `${campaign.product}. ${brief.claimsAllowed[0] ?? ""}`.trim(),
      prompt: "",
    },
  };
}

/**
 * Deterministic fallback copy.
 *
 * Version 1 carries the claims the brand list forbids, which is what makes the
 * AHR-04 revision loop visible in a demo. From version 2 the copy is clean for
 * the motifs where a fix is obvious; the generic editorial motif keeps one
 * unsupported superlative, which is how the *ineffective* revision — the case
 * that spends all three attempts and escalates — stays reachable without a live
 * model. Both paths are exercised by `scripts/bench-suite.ts`.
 */
export function deterministicCopy(campaign: Campaign, version: number): Record<"A" | "B", CopyVariant> {
  const motif = motifPack(campaign);
  const brief = campaign.brief;
  if (version === 1 || !brief) return v1Copy(campaign, motif);
  const fixed = v2Copy(campaign, motif, brief);
  if (motif === "campus" || motif === "produce") return fixed;
  return {
    A: {
      ...fixed.A,
      subhead: `${fixed.A.subhead} Guaranteed to lift basket size.`,
      caption: `${fixed.A.caption} Guaranteed results.`,
    },
    B: fixed.B,
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

function trendFallbackDecision(campaign: Campaign, brand: BrandProfile): TrendDecision {
  const motif = motifPack(campaign);
  const angle =
    motif === "campus"
      ? "Campus weather, not wilderness."
      : motif === "produce"
        ? `This week's fruit, this week's breakfast.`
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
    keyMessage: motif === "campus" ? "Weatherproof. Not wilderness." : `${campaign.product}, without the theatre.`,
    claimsAllowed:
      motif === "campus"
        ? ["Water-resistant shell", "Packs into its own pocket", "Cut for commuting"]
        : [...(campaign.sharedContext.approvedClaims.length
            ? campaign.sharedContext.approvedClaims
            : brand.approvedTerms.slice(0, 3))],
    claimsAvoid: brand.bannedTerms.slice(0, 4),
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

  const target = `${c.product} (${c.category})`;
  void target;
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

  // ---- decision: the model prioritises, or the rules do
  const evidenceLines = w.campaign.evidence.map(evidenceLine);
  const { decision, trace } = await decideTrendBrief({
    campaign: c,
    brand: env.brand,
    settings: env.settings,
    llm: env.llm,
    evidenceLines,
    fallback: trendFallbackDecision(c, env.brand),
  });
  addTrace(w, trace, "trend", "Brief prioritisation");
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
  if (retailEvidence.length > 0) {
    pushFinding(
      "Internal demand signal",
      retailEvidence[0].claim,
      [retailEvidence[0].id],
      94,
      88,
      { themeSuggestion: decision.angle },
    );
  }
  const publicEvidence = byKind("external_public").filter((e) => e.status === "verified");
  if (publicEvidence.length > 0) {
    pushFinding(
      "Public market context",
      publicEvidence[0].claim,
      [publicEvidence[0].id],
      78,
      72,
      { visualDirection: decision.visualDirection },
    );
  }
  if (retailEvidence[1]) {
    pushFinding("Basket behaviour", retailEvidence[1].claim, [retailEvidence[1].id], 86, 81);
  }

  const priorNote = c.sharedContext.previousPerformanceNote;
  if (priorNote) {
    const priorEvidence = w.campaign.evidence.find((e) => e.sourceKind === "founder_input");
    pushFinding(
      "Previous campaign feedback",
      priorNote,
      priorEvidence ? [priorEvidence.id] : [],
      90,
      92,
      { themeSuggestion: "Carry the accepted angle forward." },
    );
  }

  const banned = env.brand.bannedTerms.slice(0, 3);
  pushFinding(
    "Claim risk",
    `Category advertising still leans on absolute claims (${banned.join(", ")}). Brand rules forbid following them, so the copy must lead with verifiable product facts.`,
    [],
    82,
    85,
    {
      risk: `Unsubstantiated superlatives would fail ${c.country} advertising standards.`,
      themeSuggestion: "Quiet proof over swagger.",
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
    claimsAvoid: decision.claimsAvoid.length ? decision.claimsAvoid : env.brand.bannedTerms,
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

  const fallbackMap = deterministicCopy(c, version);
  const { variants, trace } = await decideCopy({
    campaign: c,
    brand: env.brand,
    settings: env.settings,
    llm: env.llm,
    version,
    complianceNotes: notes,
    fallback: [fallbackMap.A, fallbackMap.B],
  });
  addTrace(w, trace, "creative", `Copy for v${version}`);

  const creatives = buildCreatives(c, variants, version);
  const modelId = env.settings.imageModelId;
  const withGen: Creative[] = [];
  for (const cr of creatives) {
    const generation = await env.renderPoster({ campaign: c, creative: cr, modelId });
    withGen.push({ ...cr, generation });
  }
  const mediaCost = withGen.reduce((n, cr) => n + (cr.generation?.usage.costUsd ?? 0), 0);

  // Guard the spend before it is booked (UC-01 ext 13.a).
  const spend = evaluateGuard(
    {
      actor: "creative",
      action: "SPEND_MEDIA",
      campaign: c,
      target: `image generation on ${modelId}`,
      amountUsd: mediaCost,
      triggeredBy: "creative.generate",
    },
    w.now,
  );
  recordPolicy(w, spend.decision);
  if (spend.verdict === "block") {
    addEvent(w, "creative", "policy", "Media spend blocked", spend.reason, {
      policyDecisionId: spend.decision.id,
    });
    return { message: spend.reason, blocked: true };
  }

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
      label: `v${version} posters`,
      costUsd: mediaCost,
      totalTokens: withGen.reduce((n, cr) => n + (cr.generation?.usage.totalTokens ?? 0), 0),
    },
  ];
  c.updatedAt = stamp();

  addEvent(
    w,
    "creative",
    "output",
    `v${version} generated — variants A and B`,
    `${withGen.map((cr) => `${cr.variant}: “${cr.headline}”`).join(" · ")} · ${modelId} · est. $${mediaCost.toFixed(3)}. Logged with inputs and creation date; not published.`,
  );
  addStep(
    w,
    version === 1 ? "creative.generate" : "creative.revise",
    "creative",
    "ok",
    `Submitted v${version} for compliance review`,
    "Status Unpublished. Not sent to any distribution channel.",
  );
  // AHR-03 step 8: the draft goes to AHR-04 before anything else happens.
  setRun(w, { status: "running", step: "compliance.receive" });
  return { message: `v${version} submitted for compliance.`, blocked: false };
}

/* -------------------------------------------------------------- compliance -- */

function complianceFor(
  c: Campaign,
  issues: ComplianceIssue[],
): { outcome: ComplianceOutcome; risk: "low" | "medium" | "high"; score: number } {
  const high = issues.some((i) => i.severity === "high" && i.basis === "confirmed_breach");
  const judgement = issues.some((i) => i.basis === "human_judgement");
  const medium = issues.some((i) => i.severity === "medium");
  const attempt = c.complianceAttempts.length + 1;

  if (high) {
    return {
      outcome: attempt >= MAX_REVISION_ATTEMPTS ? "manual_review" : "changes_required",
      risk: "high",
      score: Math.min(48, 20 + attempt * 6),
    };
  }
  if (medium || judgement) return { outcome: "pass", risk: "medium", score: 68 };
  return { outcome: "pass", risk: "low", score: 92 };
}

/** Deterministic review — the floor the model's review is merged onto. */
export function deterministicReview(
  c: Campaign,
  brand: BrandProfile,
): { issues: ComplianceIssue[]; summary: string } {
  const issues: ComplianceIssue[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const countryRules = brand.countryRules[c.country];
  const policyProfile = `${c.country} advertising and consumer law`;

  for (const cr of c.creatives) {
    const blob = `${cr.headline} ${cr.subhead} ${cr.caption}`.toLowerCase();
    for (const term of brand.bannedTerms) {
      if (!blob.includes(term.toLowerCase())) continue;
      issues.push({
        id: uid("ci"),
        category: /health|proven|miracle/.test(term) ? "unsupported_claim" : "misleading_claim",
        basis: "confirmed_breach",
        severity: "high",
        excerpt: term,
        explanation: `“${term}” is on the retailer's banned list and cannot be substantiated for this campaign.`,
        rule: countryRules.slice(0, 90) + "…",
        policySource: `${policyProfile} + brand banned terms`,
        policyDate: today,
        recommendedCorrection: `Replace “${term}” with a verifiable product fact from the approved claims list.`,
      });
    }
  }

  if (c.channels.includes("print") && c.creatives[0]?.version >= 2 && issues.length === 0) {
    issues.push({
      id: uid("ci"),
      category: "missing_condition",
      basis: "human_judgement",
      severity: "medium",
      excerpt: "Catalogue cover without a regional price condition line",
      explanation:
        "Week-specific specials can vary by region. The cover should not imply a national price without the condition line.",
      rule: `${c.country} catalogue policy`,
      policySource: "Retailer catalogue policy",
      policyDate: today,
      recommendedCorrection: "Add “see in-store for regional prices” to the cover, or confirm the condition line.",
    });
  }

  if (c.budget >= 10_000 && issues.length === 0 && c.creatives[0]?.version >= 2) {
    issues.push({
      id: uid("ci"),
      category: "audience_targeting",
      basis: "human_judgement",
      severity: "medium",
      excerpt: `Budget ${c.budget.toLocaleString("en-AU")} above the auto-clear threshold`,
      explanation:
        "High-spend or youth-reach campaigns remain founder decisions even when the copy is clean.",
      rule: `${c.country} · founder threshold`,
      policySource: "Workspace policy",
      policyDate: today,
      recommendedCorrection: "Founder confirms reach and spend before distribution.",
    });
  }

  if (c.channels.includes("instagram")) {
    const caption = c.creatives[0]?.caption ?? "";
    if (caption.length > 125 && c.creatives[0]?.version >= 2) {
      issues.push({
        id: uid("ci"),
        category: "platform_policy",
        basis: "human_judgement",
        severity: "low",
        excerpt: "Instagram caption exceeds the visible hook length",
        explanation:
          "Instagram truncates captions around 125 characters; the hook should land above the fold.",
        rule: "Instagram platform guidance",
        policySource: "Instagram platform policy",
        policyDate: today,
        recommendedCorrection: "Shorten the caption hook, or move detail to the second line.",
      });
    }
  }

  const high = issues.filter((i) => i.severity === "high").length;
  const summary =
    high > 0
      ? `${high} claim(s) cannot be supported. Structured corrections returned to Image Generation.`
      : issues.length > 0
        ? `Copy is legally clean. ${issues.length} item(s) need founder judgement before distribution.`
        : `Version uses allowed product facts only. Brand tone holds. Cleared for the founder's sign-off.`;
  return { issues, summary };
}

export async function runComplianceReview(
  w: Work,
  env: StepEnv,
): Promise<{ message: string; blocked: boolean }> {
  const c = w.campaign;
  c.status = "compliance";
  c.running = true;
  const attemptNo = c.complianceAttempts.length + 1;
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

  const fallback = deterministicReview(c, env.brand);
  const { decision, trace } = await decideCompliance({
    campaign: c,
    brand: env.brand,
    settings: env.settings,
    llm: env.llm,
    copy: copyBlob,
    attempt: attemptNo,
    fallback,
  });
  addTrace(w, trace, "compliance", "Policy review");

  const verdict = complianceFor(c, decision.issues);
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
    summary: decision.summary,
    issues: decision.issues,
    policyRefs: [
      `${c.country} advertising and consumer law`,
      "Brand banned and approved terms",
      ...(c.channels.includes("print") ? ["Retailer catalogue policy"] : []),
      ...(c.channels.includes("instagram") ? ["Instagram platform policy"] : []),
    ],
    policyComplete: Boolean(env.brand.countryRules[c.country]) && env.brand.bannedTerms.length > 0,
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
    id: uid("cp"),
    creativeId: c.creatives[0]?.id ?? "unknown",
    version: attempt.creativeVersion,
    risk: verdict.risk,
    score: verdict.score,
    verdict:
      verdict.outcome === "changes_required"
        ? "revise"
        : verdict.risk === "medium"
          ? "escalate"
          : "pass",
    summary: decision.summary,
    findings,
    countryProfile: `${c.country} · ${env.brand.countryRules[c.country].slice(0, 140)}…`,
    attempt,
  };

  c.complianceAttempts = [...c.complianceAttempts, attempt];
  c.complianceReports = [...c.complianceReports, report];
  c.creatives = c.creatives.map((cr) => ({
    ...cr,
    status: verdict.outcome === "pass" ? (verdict.risk === "low" ? "draft" : "flagged") : "flagged",
  }));
  c.updatedAt = stamp();

  const confirmed = decision.issues.filter((i) => i.basis === "confirmed_breach").length;
  const judgement = decision.issues.filter((i) => i.basis === "human_judgement").length;
  addEvent(
    w,
    "compliance",
    verdict.outcome === "pass" ? "output" : "flag",
    `Attempt ${attemptNo}: ${verdict.outcome.replace(/_/g, " ")}`,
    `${decision.summary} ${confirmed} confirmed breach(es), ${judgement} needing human judgement. Issues recorded with severity, affected content and rule.`,
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
      `Revision limit reached (${MAX_REVISION_ATTEMPTS} attempts) — Manual Review Required`,
      "The automatic revision cycle stopped. All versions, inputs and rejection reasons are retained. Nothing is published or distributed.",
    );
    addStep(w, "founder.gate", "compliance", "warn", "Escalated to manual review", "Three attempts spent; the founder takes over.");
    setRun(w, { awaiting: "approval", awaitingDetail: "Manual review required: three compliance attempts did not clear the copy.", status: "awaiting_human", step: "founder.gate" });
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

/**
 * Product claims a channel body asserts that AHR-04 never cleared.
 *
 * Adaptation may reformat and may add a required condition line, but a piece of
 * promotional copy that makes a new factual claim about the product is exactly
 * what AHR-05 forbids. Only sentences shaped like a claim are considered, so
 * ordinary connective copy does not raise a false flag.
 */
const CLAIM_SHAPED =
  /(water[- ]?resistant|packable|packs into|guarantee|warrant|clinically|proven|award[- ]winning|number one|#1|best in|healthiest|miracle|risk[- ]free|free delivery|money back|new and improved|australian[- ]made|certified|organic)/i;

function introducedClaims(c: Campaign, body: string): string[] {
  const clearedBlob = (
    (c.sharedContext.approvedClaims ?? []).join(" ") +
    " " +
    (c.brief?.claimsAllowed.join(" ") ?? "")
  ).toLowerCase();

  return body
    .split(/(?<=[.!?])\s+|\s+·\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 12 && CLAIM_SHAPED.test(sentence))
    .filter((sentence) => {
      // Every claim-shaped term in the sentence must already be cleared wording;
      // one that is not means the channel version asserts something new.
      const hits = sentence.match(
        /(water[- ]?resistant|packable|packs into|guarantee\w*|warrant\w*|clinically|proven|award[- ]winning|number one|#1|best in|healthiest|miracle|risk[- ]free|free delivery|money back|new and improved|australian[- ]made|certified|organic)/gi,
      );
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
export function deriveClearedClaims(c: Campaign): string[] {
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
    const body = adaptBody(channel, hero, c, condition);
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
        failure: outcome.reason,
      });
      addEvent(w, "media", "policy", `${channel} adaptation blocked`, outcome.reason, {
        policyDecisionId: outcome.decision.id,
      });
      continue;
    }

    versions.push({
      id: uid("cv"),
      channel,
      headline: channel === "email" ? hero.subhead : hero.headline,
      body,
      specs: CHANNEL_SPECS[channel],
      approvedClaims,
      claimsUnchanged: true,
      status: "adapted",
      proposedAt: at,
      postingReason: post.reason,
    });
    adaptations.push({
      channel,
      headline: channel === "email" ? hero.subhead : hero.headline,
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
      .map((v) => `${v.channel}: ${v.status === "adapted" ? "claims intact" : "blocked — flagged"}`)
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
export function detectScheduleConflicts(
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

    for (const id of conflictIds) {
      const conflict = conflicts.find((x) => x.id === id);
      if (conflict) conflict.resolved = false;
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

function hashOf(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) % 100_000;
  return h;
}

/**
 * AHR-06 collection.
 *
 * The prototype has no live channel APIs, so this adapter is *declared*: each
 * channel returns a transparent model of its own report, and channels that are
 * not authorised, report late, or return incomplete figures are marked as such
 * instead of being filled in with invented numbers.
 */
export function collectChannelResults(c: Campaign, now: string): ChannelResult[] {
  const publishedAt = c.schedule[0]?.at ?? c.updatedAt;
  const periodFrom = publishedAt.slice(0, 10);
  const periodTo = now.slice(0, 10);
  const base = c.budget;

  return c.channels.map((channel: Channel) => {
    const seed = hashOf(`${c.id}:${channel}`);
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
        ok: "",
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

export function buildPerformanceReport(c: Campaign, now: string): PerformanceReport {
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
export function deterministicRecommendation(
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

export async function runFeedbackCollection(
  w: Work,
  env: StepEnv,
  options: { publish: boolean },
): Promise<{ message: string; blocked: boolean }> {
  const c = w.campaign;

  if (options.publish) {
    // Only the founder reaches this path; the guard is asked anyway so the
    // decision is on the record.
    const outcome = evaluateGuard(
      {
        actor: "founder",
        action: "PUBLISH_CONTENT",
        campaign: c,
        target: `${c.channels.join(", ")}`,
        kind: c.channels.includes("print") ? "catalogue_cover" : "social",
        triggeredBy: "founder.publish",
      },
      w.now,
    );
    recordPolicy(w, outcome.decision);
    if (outcome.verdict === "block") {
      addEvent(w, "founder", "policy", "Publish blocked", outcome.reason, {
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

    c.schedule = c.schedule.map((s) => ({ ...s, status: "published" }));
    c.runSchedule = c.runSchedule.map((i) => ({ ...i, status: "published" }));
    c.channelVersions = c.channelVersions.map((v) =>
      v.status === "failed" ? v : { ...v, status: "published" },
    );
    c.status = "published";
    c.running = false;
    c.updatedAt = stamp();
    addEvent(
      w,
      "founder",
      "decision",
      "Published",
      `Founder released ${c.channels.join(", ")}. Distribution recorded against each channel so AHR-06 can collect from what actually ran.`,
    );
    addStep(w, "media.publish", "founder", "ok", "Published", "Channel, timing and status written to shared context.");
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

  c.status = "published";
  const report = buildPerformanceReport(c, w.now);
  const { points, text, trace } = await decideRecommendation({
    campaign: c,
    settings: env.settings,
    llm: env.llm,
    results: report.results,
    summary: report.summary,
    fallback: deterministicRecommendation(c, report),
  });
  addTrace(w, trace, "media", "Next-campaign recommendation");

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

export function parseSeedDate(value: string) {
  return new Date(value).toISOString();
}

/** Exported for the workspace view: the guard rule text shown to the founder. */
export const GUARD_CLAUSE_HINT =
  "Agents may research, draft and check. They may not publish, exceed the spend threshold, change scope, or send a print piece live.";
