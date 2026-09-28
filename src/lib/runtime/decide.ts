/**
 * The LLM decision layer.
 *
 * Each agent gets one narrow, structured decision to make, and the model's answer
 * is used *as a decision* — which findings to prioritise, which claims to write,
 * which flags are confirmed breaches, what to keep or change next cycle.
 *
 * When no backend is configured (the default for a fresh clone) every decision
 * falls back to the deterministic rule set below, and the run records which path
 * it took. A live model therefore improves the output but is never required for
 * the prototype to work or to be demonstrable.
 */

import { runComplete } from "@/lib/llm/complete";
import { getLlmOrDefault } from "@/lib/llm/catalog";
import type { CompleteResult } from "@/lib/llm/types";
import type { AgentSlot } from "@/lib/llm/types";
import type { CompleteRequest } from "@/lib/llm/types";
import type { WorkspaceSettings } from "@/lib/settings";
import type { BrandProfile, Campaign, Channel } from "@/lib/types";
import type { ChannelResult, ComplianceIssue, RecommendationPoint } from "./types";

export type LlmRuntime = {
  request: (req: CompleteRequest) => Promise<CompleteResult>;
  /** Identifies the transport so the run trace can say what decision path was used. */
  meta?: { label: string; live: boolean };
};

export function makeLlmRuntime(): LlmRuntime {
  return { request: (req) => runComplete(req), meta: { label: "server", live: true } };
}

/** Pull the first JSON object or array out of a model response. */
export function extractJson<T>(text: string | null): T | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.search(/[[{]/);
  if (start === -1) return null;
  const slice = body.slice(start);
  try {
    return JSON.parse(slice) as T;
  } catch {
    // Try to trim a trailing explanation after the closing brace.
    const lastObj = slice.lastIndexOf("}");
    const lastArr = slice.lastIndexOf("]");
    const end = Math.max(lastObj, lastArr);
    if (end === -1) return null;
    try {
      return JSON.parse(slice.slice(0, end + 1)) as T;
    } catch {
      return null;
    }
  }
}

export type DecisionTrace = {
  agent: AgentSlot;
  modelId: string;
  modelName: string;
  status: CompleteResult["status"];
  path: "live_model" | "deterministic_fallback";
  note: string;
  usage: CompleteResult["usage"];
};

function traceFor(  agent: AgentSlot,
  assignment: { modelId: string },
  result: CompleteResult,
  used: boolean,
): DecisionTrace {
  const model = getLlmOrDefault(assignment.modelId);
  return {
    agent,
    modelId: model.id,
    modelName: model.name,
    status: result.status,
    path: used ? "live_model" : "deterministic_fallback",
    note: used
      ? `Live decision from ${model.name}.`
      : `Deterministic rules used — ${result.note}`,
    usage: result.usage,
  };
}

function assignmentFor(campaign: Campaign, settings: WorkspaceSettings, agent: AgentSlot) {
  void campaign;
  return settings.agents[agent];
}

/* -------------------------------------------------------------- trend brief -- */

export type TrendDecision = {
  priorities: { topic: string; relevance: number; confidence: number; theme?: string; visual?: string }[];
  angle: string;
  keyMessage: string;
  claimsAllowed: string[];
  claimsAvoid: string[];
  visualDirection: string;
  limitations: string[];
};

export async function decideTrendBrief(input: {
  campaign: Campaign;
  brand: BrandProfile;
  settings: WorkspaceSettings;
  llm: LlmRuntime;
  evidenceLines: string[];
  fallback: TrendDecision;
}): Promise<{ decision: TrendDecision; trace: DecisionTrace }> {
  const assignment = assignmentFor(input.campaign, input.settings, "trend");
  const prompt = [
    `Retailer: ${input.brand.retailerName}. Country: ${input.campaign.country}.`,
    `Product: ${input.campaign.product}. Category: ${input.campaign.category}.`,
    `Audience: ${input.campaign.targetAudience}. Objective: ${input.campaign.objective}.`,
    `Channels: ${input.campaign.channels.join(", ")}. Dates: ${input.campaign.startDate} → ${input.campaign.endDate}.`,
    `Brand tone: ${input.brand.tone}`,
    `Allowed terms: ${input.brand.approvedTerms.join(", ")}.`,
    `Banned terms (never use): ${input.brand.bannedTerms.join(", ")}.`,
    "",
    "Evidence collected by tools (source · date · status):",
    ...input.evidenceLines.map((l) => `- ${l}`),
    "",
    "Decide the campaign brief from this evidence only. Do not invent market data.",
    "Reply with JSON only:",
    '{"priorities":[{"topic":"","relevance":0-100,"confidence":0-100,"theme":"","visual":""}],',
    '"angle":"","keyMessage":"","claimsAllowed":["verifiable product facts only"],',
    '"claimsAvoid":["claims we cannot substantiate"],"visualDirection":"","limitations":["what the evidence could not establish"]}',
  ].join("\n");

  const result = await input.llm.request({
    agent: "trend",
    modelId: assignment.modelId,
    prompt,
    localBaseUrl: input.settings.localBaseUrl,
    localModel: input.settings.localModel,
  });
  const parsed = extractJson<TrendDecision>(result.text);
  if (result.status === "ok" && parsed && typeof parsed.angle === "string") {
    return {
      decision: {
        priorities: Array.isArray(parsed.priorities)
          ? parsed.priorities.slice(0, 4).map((p) => ({
              topic: String(p.topic ?? "").slice(0, 120),
              relevance: clamp(p.relevance, 50, 99),
              confidence: clamp(p.confidence, 40, 95),
              theme: p.theme ? String(p.theme).slice(0, 120) : undefined,
              visual: p.visual ? String(p.visual).slice(0, 160) : undefined,
            }))
          : input.fallback.priorities,
        angle: String(parsed.angle).slice(0, 240),
        keyMessage: String(parsed.keyMessage ?? input.fallback.keyMessage).slice(0, 160),
        claimsAllowed: stringList(parsed.claimsAllowed, input.fallback.claimsAllowed, 6),
        claimsAvoid: stringList(parsed.claimsAvoid, input.fallback.claimsAvoid, 6),
        visualDirection: String(parsed.visualDirection ?? input.fallback.visualDirection).slice(0, 240),
        limitations: stringList(parsed.limitations, input.fallback.limitations, 5),
      },
      trace: traceFor("trend", assignment, result, true),
    };
  }
  return { decision: input.fallback, trace: traceFor("trend", assignment, result, false) };
}

/* ------------------------------------------------------------------- copy --- */

export type CopyVariant = {
  variant: "A" | "B";
  kicker: string;
  headline: string;
  subhead: string;
  cta: string;
  caption: string;
  prompt: string;
};

export async function decideCopy(input: {
  campaign: Campaign;
  brand: BrandProfile;
  settings: WorkspaceSettings;
  llm: LlmRuntime;
  version: number;
  complianceNotes: string[];
  fallback: CopyVariant[];
}): Promise<{ variants: CopyVariant[]; trace: DecisionTrace }> {
  const assignment = assignmentFor(input.campaign, input.settings, "creative");
  const brief = input.campaign.brief;
  const prompt = [
    `Write two poster variants (A and B) for ${input.brand.retailerName}, ${input.campaign.country}.`,
    `Product: ${input.campaign.product}. Audience: ${input.campaign.targetAudience}.`,
    brief ? `Angle: ${brief.angle}. Key message: ${brief.keyMessage}.` : "",
    brief ? `Claims allowed: ${brief.claimsAllowed.join(", ")}.` : "",
    `Never use these banned terms: ${input.brand.bannedTerms.join(", ")}.`,
    `Brand tone: ${input.brand.tone}`,
    input.version > 1
      ? `This is revision ${input.version}. Compliance returned the last draft with: ${input.complianceNotes.join(" | ") || "no notes"}. Fix exactly those problems and keep the angle.`
      : "",
    "Every claim must be a verifiable product fact. No superlatives, no health claims, no guarantees.",
    'Reply with JSON only: {"variants":[{"variant":"A","kicker":"","headline":"","subhead":"","cta":"","caption":"","prompt":"image prompt"},{...B}]}',
  ]
    .filter(Boolean)
    .join("\n");

  const result = await input.llm.request({
    agent: "creative",
    modelId: assignment.modelId,
    prompt,
    localBaseUrl: input.settings.localBaseUrl,
    localModel: input.settings.localModel,
  });
  const parsed = extractJson<{ variants?: CopyVariant[] }>(result.text);
  const variants = parsed?.variants?.filter((v) => v && typeof v.headline === "string");
  if (result.status === "ok" && variants && variants.length >= 2) {
    const banned = input.brand.bannedTerms.map((t) => t.toLowerCase());
    const cleaned = variants.slice(0, 2).map((v, i) => ({
      variant: (i === 0 ? "A" : "B") as "A" | "B",
      kicker: str(v.kicker, input.fallback[i]?.kicker ?? ""),
      headline: str(v.headline, input.fallback[i]?.headline ?? ""),
      subhead: str(v.subhead, input.fallback[i]?.subhead ?? ""),
      cta: str(v.cta, input.fallback[i]?.cta ?? ""),
      caption: str(v.caption, input.fallback[i]?.caption ?? ""),
      prompt: str(v.prompt, input.fallback[i]?.prompt ?? ""),
    }));
    // A model that ignores the banned list would otherwise burn a revision cycle
    // silently; drop those variants and let the deterministic copy stand.
    const dirty = cleaned.some((v) =>
      banned.some((term) => `${v.headline} ${v.subhead} ${v.caption}`.toLowerCase().includes(term)),
    );
    if (!dirty) {
      return { variants: cleaned, trace: traceFor("creative", assignment, result, true) };
    }
    return {
      variants: input.fallback,
      trace: {
        ...traceFor("creative", assignment, result, false),
        note: "Model output used a banned term; deterministic copy used instead.",
      },
    };
  }
  return { variants: input.fallback, trace: traceFor("creative", assignment, result, false) };
}

/* -------------------------------------------------------------- compliance -- */

export type ComplianceDecision = {
  issues: ComplianceIssue[];
  summary: string;
};

export async function decideCompliance(input: {
  campaign: Campaign;
  brand: BrandProfile;
  settings: WorkspaceSettings;
  llm: LlmRuntime;
  copy: string;
  attempt: number;
  fallback: ComplianceDecision;
}): Promise<{ decision: ComplianceDecision; trace: DecisionTrace }> {
  const assignment = assignmentFor(input.campaign, input.settings, "compliance");
  const policy = input.brand.countryRules[input.campaign.country];
  const prompt = [
    `You are the Compliance Checker for ${input.brand.retailerName}. Country: ${input.campaign.country}. Attempt ${input.attempt} of 3.`,
    `Applicable law: ${policy}`,
    `Brand banned terms: ${input.brand.bannedTerms.join(", ")}.`,
    `Brand approved terms: ${input.brand.approvedTerms.join(", ")}.`,
    `Channels: ${input.campaign.channels.join(", ")}. Audience: ${input.campaign.targetAudience}.`,
    "",
    "Advertisement under review:",
    input.copy,
    "",
    "Identify every compliance issue. Separate a confirmed breach of a named rule from",
    "something that needs human judgement. Never approve anything: you may only flag.",
    'Reply with JSON only: {"issues":[{"category":"misleading_claim|unsupported_claim|missing_condition|price_accuracy|copyright|audience_targeting|platform_policy|brand_guideline",',
    '"basis":"confirmed_breach|human_judgement","severity":"high|medium|low","excerpt":"","explanation":"","rule":"","recommendedCorrection":""}],"summary":""}',
  ].join("\n");

  const result = await input.llm.request({
    agent: "compliance",
    modelId: assignment.modelId,
    prompt,
    localBaseUrl: input.settings.localBaseUrl,
    localModel: input.settings.localModel,
  });
  const parsed = extractJson<{ issues?: Partial<ComplianceIssue>[]; summary?: string }>(result.text);
  if (result.status === "ok" && Array.isArray(parsed?.issues)) {
    const issues: ComplianceIssue[] = parsed.issues.slice(0, 8).map((raw) => ({
      id: `ci_${Math.random().toString(36).slice(2, 9)}`,
      category: category(raw.category),
      basis: raw.basis === "human_judgement" ? "human_judgement" : "confirmed_breach",
      severity: severity(raw.severity),
      excerpt: str(raw.excerpt, "—"),
      explanation: str(raw.explanation, "Flagged by the compliance model."),
      rule: str(raw.rule, `${input.campaign.country} advertising standards`),
      policySource: `${input.campaign.country} regulator guidance`,
      policyDate: new Date().toISOString().slice(0, 10),
      recommendedCorrection: str(raw.recommendedCorrection, "Rewrite without the flagged claim."),
    }));
    // The deterministic pass is still merged in: a model must not be able to
    // clear a banned term that the brand list forbids outright.
    const merged = mergeIssues(input.fallback.issues, issues);
    return {
      decision: {
        issues: merged,
        summary: str(parsed.summary, input.fallback.summary),
      },
      trace: traceFor("compliance", assignment, result, true),
    };
  }
  return { decision: input.fallback, trace: traceFor("compliance", assignment, result, false) };
}

/* -------------------------------------------------------------- performance -- */

export async function decideRecommendation(input: {
  campaign: Campaign;
  settings: WorkspaceSettings;
  llm: LlmRuntime;
  results: ChannelResult[];
  summary: string;
  fallback: RecommendationPoint[];
}): Promise<{ points: RecommendationPoint[]; text: string | null; trace: DecisionTrace }> {
  const assignment = assignmentFor(input.campaign, input.settings, "media");
  const reported = input.results.filter((r) => r.figures);
  if (reported.length === 0) {
    return {
      points: [],
      text: null,
      trace: {
        agent: "media",
        modelId: getLlmOrDefault(assignment.modelId).id,
        modelName: getLlmOrDefault(assignment.modelId).name,
        status: "stubbed",
        path: "deterministic_fallback",
        note: "No channel returned usable data, so no sourced recommendation was produced (UC-06 ext 8.a).",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          billedAs: "not called",
          estimate: true,
          latencyMs: 0,
        },
      },
    };
  }

  const prompt = [
    `Campaign "${input.campaign.name}" for ${input.campaign.product} has finished.`,
    `Channels run: ${input.campaign.channels.join(", ")}.`,
    "Collected results (only these figures exist — do not invent others):",
    ...input.results.map(
      (r) =>
        `- ${r.channel} [${r.status}] ${
          r.figures
            ? `impressions ${r.figures.impressions}, reach ${r.figures.reach}, CTR ${r.figures.ctr}%, engagement ${r.figures.engagement}%, conversions ${r.figures.conversions}`
            : r.note
        }`,
    ),
    `Summary of what ran: ${input.summary}`,
    "",
    "Recommend what to keep, drop or change for the next campaign. Each point must cite",
    "the channel or figure it is based on. Never recommend automatic publishing or extra spend.",
    'Reply with JSON only: {"points":[{"verdict":"keep|drop|change","area":"channel_mix|claims|creative_angle|timing|audience","text":"","evidence":"the channel or figure this rests on"}]}',
  ].join("\n");

  const result = await input.llm.request({
    agent: "media",
    modelId: assignment.modelId,
    prompt,
    localBaseUrl: input.settings.localBaseUrl,
    localModel: input.settings.localModel,
  });
  const parsed = extractJson<{
    points?: { verdict?: string; area?: string; text?: string; evidence?: string }[];
  }>(result.text);
  if (result.status === "ok" && parsed?.points?.length) {
    const points: RecommendationPoint[] = parsed.points.slice(0, 5).map((p, i) => ({
      id: `rp_${i}_${Math.random().toString(36).slice(2, 7)}`,
      verdict: p.verdict === "keep" || p.verdict === "drop" ? p.verdict : "change",
      area: area(p.area),
      text: `${str(p.text, "—")} (basis: ${str(p.evidence, "collected channel figures")})`,
      evidenceIds: [],
    }));
    return {
      points,
      text: points.map((p) => `${p.verdict.toUpperCase()} ${p.area}: ${p.text}`).join("\n"),
      trace: traceFor("media", assignment, result, true),
    };
  }
  return {
    points: input.fallback,
    text: input.fallback.map((p) => `${p.verdict.toUpperCase()} ${p.area}: ${p.text}`).join("\n"),
    trace: traceFor("media", assignment, result, false),
  };
}

/* ---------------------------------------------------------------- helpers --- */

function clamp(n: unknown, min: number, max: number) {
  const v = typeof n === "number" && Number.isFinite(n) ? n : min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function str(v: unknown, fallback: string) {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 600) : fallback;
}

function stringList(v: unknown, fallback: string[], max: number) {
  if (!Array.isArray(v)) return fallback;
  const list = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  return list.length ? list.slice(0, max).map((s) => s.slice(0, 120)) : fallback;
}

function severity(v: unknown): ComplianceIssue["severity"] {
  return v === "high" || v === "medium" || v === "low" ? v : "medium";
}

const CATEGORIES: ComplianceIssue["category"][] = [
  "misleading_claim",
  "unsupported_claim",
  "missing_condition",
  "price_accuracy",
  "copyright",
  "audience_targeting",
  "platform_policy",
  "brand_guideline",
];

function category(v: unknown): ComplianceIssue["category"] {
  return CATEGORIES.includes(v as ComplianceIssue["category"])
    ? (v as ComplianceIssue["category"])
    : "unsupported_claim";
}

const AREAS: RecommendationPoint["area"][] = [
  "channel_mix",
  "claims",
  "creative_angle",
  "timing",
  "audience",
];

function area(v: unknown): RecommendationPoint["area"] {
  return AREAS.includes(v as RecommendationPoint["area"])
    ? (v as RecommendationPoint["area"])
    : "creative_angle";
}

/** Deterministic issues always survive; model issues add on top, de-duplicated. */
function mergeIssues(baseline: ComplianceIssue[], extra: ComplianceIssue[]): ComplianceIssue[] {
  const seen = new Set(baseline.map((i) => i.excerpt.toLowerCase()));
  const merged = [...baseline];
  for (const issue of extra) {
    const key = issue.excerpt.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(issue);
  }
  return merged;
}

export function channelsLabel(channels: Channel[]) {
  return channels.join(", ");
}
