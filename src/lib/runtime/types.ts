/**
 * Aisle agent runtime — domain model.
 *
 * These types carry the evidence, decisions and boundary records that the
 * Stage 1 requirements demand (AHR-01 … AHR-06). Nothing here is presentational:
 * every field is written by the runtime and read back by the founder desk.
 *
 * The runtime is plain TypeScript with no React and no browser APIs, so the same
 * module runs inside the Next.js route handler and inside a unit test.
 */

import type { Campaign, Channel, Country } from "@/lib/types";

export const MAX_REVISION_ATTEMPTS = 3;

/** Who asked for the work. Agents are not equal before the policy guard. */
export type Actor = "founder" | "trend" | "creative" | "compliance" | "media" | "intake";

export const agentActors = ["trend", "creative", "compliance", "media"] as const;
export type AgentActor = (typeof agentActors)[number];

export function isAgent(actor: Actor): actor is AgentActor {
  return (agentActors as readonly string[]).includes(actor);
}

/* ------------------------------------------------------------------ evidence */

/** How a finding was obtained. Used to separate fact from inference (AHR-02). */
export type SourceKind =
  | "external_public" // a real public API we actually called
  | "internal_retail" // POS / catalogue history: authorised internal data
  | "model_inference" // the LLM reasoned; no external record exists
  | "founder_input" // the founder typed it
  | "brand_rule"; // the retailer's own approved/banned term list

export type EvidenceStatus =
  | "verified" // the tool returned a record we can cite
  | "assumed" // a reasonable assumption, labelled as such
  | "conflicting" // sources disagree
  | "stale" // older than the currency window
  | "unavailable"; // the source could not be reached

export type Evidence = {
  id: string;
  claim: string;
  detail: string;
  sourceName: string;
  /** Public or documented locator. Empty for model inference. */
  sourceRef: string;
  sourceKind: SourceKind;
  /** ISO date the underlying information describes (not when we fetched it). */
  observedAt: string;
  fetchedAt: string;
  status: EvidenceStatus;
  confidence: number;
  /** Which agent raised it. */
  raisedBy: Actor;
  usedFor: string;
};

export type TrendFinding = {
  id: string;
  topic: string;
  /** What the analyser concluded. */
  finding: string;
  /** Supported by a citable source, or a labelled assumption. */
  basis: "supported" | "assumption";
  relevance: number;
  confidence: number;
  country: Country;
  channelRelevance: Channel[];
  risk?: string;
  themeSuggestion?: string;
  visualDirection?: string;
  evidenceIds: string[];
};

export type TrendBriefGap = {
  id: string;
  kind: "missing_source" | "outdated" | "conflict" | "unauthorised" | "low_confidence";
  detail: string;
  effect: string;
  needsFounder: boolean;
};

/* ------------------------------------------------------------- policy guard */

export type GuardVerdict = "allow" | "allow_with_note" | "block";

/**
 * Every action an agent could attempt. The guard decides; the engine obeys.
 * `FOUNDER.DECIDE` is the only path allowed to publish or spend.
 */
export type GuardedAction =
  | "PUBLISH_CONTENT"
  | "SPEND_MEDIA"
  | "EDIT_APPROVED_CLAIM"
  | "CHANGE_CAMPAIGN_SCOPE"
  | "IMPORT_UNAUTHORISED_DATA"
  | "SKIP_ITEM_SILENTLY"
  | "APPROVE_OWN_WORK"
  | "READ_INTERNAL_DATA"
  | "FOUNDER.DECIDE";

export type GuardRuleId =
  | "AHR-01-R13.publish"
  | "AHR-01-R13.spend"
  | "AHR-04-R12.approve-own-work"
  | "AHR-05-R.claims-frozen"
  | "AHR-05-R.scope"
  | "AHR-05-R.no-silent-skip"
  | "AHR-02-R.privacy";

export type PolicyDecision = {
  id: string;
  at: string;
  actor: Actor;
  action: GuardedAction;
  verdict: GuardVerdict;
  rule: GuardRuleId;
  /** Requirement clause this rule enforces, e.g. "UC-01 ext 13.a". */
  clause: string;
  target: string;
  reason: string;
  /** What a human has to do instead, when blocked. */
  remedy?: string;
  triggeredBy?: string;
};

export type BudgetLedger = {
  /** Founder-set ceiling for automated spend (UC-01 ext 13.a). */
  mediaCapUsd: number;
  /** Ceiling for model + media spend incurred by agents. */
  spendCapUsd: number;
  mediaCommittedUsd: number;
  inferenceSpendUsd: number;
  blockedAttempts: number;
};

/* --------------------------------------------------------------- compliance */

export type ComplianceIssueCategory =
  | "misleading_claim"
  | "unsupported_claim"
  | "missing_condition"
  | "price_accuracy"
  | "copyright"
  | "audience_targeting"
  | "platform_policy"
  | "brand_guideline";

/**
 * AHR-04 requires the checker to separate a confirmed breach from something a
 * human should judge. `basis` is that separation.
 */
export type ComplianceIssue = {
  id: string;
  category: ComplianceIssueCategory;
  basis: "confirmed_breach" | "human_judgement";
  severity: "high" | "medium" | "low";
  excerpt: string;
  explanation: string;
  rule: string;
  policySource: string;
  policyDate: string;
  recommendedCorrection: string;
};

export type ComplianceOutcome =
  | "pass" // → Awaiting Human Approval
  | "changes_required" // → back to Image Generation
  | "manual_review"; // 3 attempts spent, or policy unusable

export type ComplianceAttempt = {
  id: string;
  at: string;
  attempt: number;
  creativeVersion: number;
  creativeIds: string[];
  /** The exact inputs the reviewed ad was generated from (AHR-04 precondition). */
  inputDigest: string;
  modelId: string;
  outcome: ComplianceOutcome;
  risk: "low" | "medium" | "high";
  score: number;
  summary: string;
  issues: ComplianceIssue[];
  policyRefs: string[];
  policyComplete: boolean;
};

/* -------------------------------------------------------------- distribution */

export type ChannelVersionStatus = "adapted" | "scheduled" | "published" | "failed";

export type ChannelVersion = {
  id: string;
  channel: Channel;
  headline: string;
  body: string;
  specs: string;
  /** Frozen copy of the approved claims, so we can prove nothing changed. */
  approvedClaims: string[];
  claimsUnchanged: boolean;
  status: ChannelVersionStatus;
  proposedAt: string;
  postingReason: string;
  /** Set when the adaptation could not be produced for this channel. */
  failure?: string;
};

export type ScheduleConflict = {
  id: string;
  channel: Channel;
  at: string;
  kind: "same_slot" | "frequency" | "outside_window" | "budget";
  detail: string;
  withCampaignId?: string;
  withCampaignName?: string;
  resolved: boolean;
};

export type ScheduleItemStatus = "proposed" | "adapted" | "scheduled" | "published" | "failed";

export type RunScheduleItem = {
  id: string;
  channel: Channel;
  at: string;
  status: ScheduleItemStatus;
  note: string;
  channelVersionId: string;
  conflictIds: string[];
};

/* ---------------------------------------------------------------- feedback */

/**
 * A declared outcome for one channel's report.
 *
 * AHR-06 turns on what happens when a channel does *not* report: the founder must
 * be able to see a gap demonstrated, not take it on trust. Real adapters decide
 * this from the channel's own API; until those exist, this is how the prototype
 * makes each case reproducible — the Performance tab offers it, and the scenario
 * suite asserts on it — instead of waiting for a random campaign id to produce one.
 */
export type ChannelResultStatus =
  | "ok"
  | "no_data"
  | "not_authorised"
  | "late"
  | "incomplete"
  | "excluded";

export type ChannelResult = {
  channel: Channel;
  status: ChannelResultStatus;
  sourceName: string;
  collectedAt: string;
  periodFrom: string;
  periodTo: string;
  figures: {
    impressions: number;
    reach: number;
    clicks: number;
    ctr: number;
    engagement: number;
    conversions: number;
    storeResponse?: number;
  } | null;
  note: string;
  /** Figures that arrived but did not match this campaign. */
  excludedReason?: string;
};

export type RecommendationPoint = {
  id: string;
  verdict: "keep" | "drop" | "change";
  area: "channel_mix" | "claims" | "creative_angle" | "timing" | "audience";
  text: string;
  evidenceIds: string[];
};

export type PerformanceReport = {
  id: string;
  at: string;
  publishedAt: string;
  /** What actually went live, per channel. */
  ranChannels: Channel[];
  results: ChannelResult[];
  gaps: string[];
  totals: {
    impressions: number;
    reach: number;
    clicks: number;
    ctr: number;
    engagement: number;
    conversions: number;
  } | null;
  summary: string;
  /** Empty when the evidence cannot support advice (UC-06 ext 8.a). */
  recommendationPoints: RecommendationPoint[];
  recommendationText: string | null;
  recommendationUnsupported: boolean;
};

export type RecommendationDecision = {
  action: "accepted" | "edited" | "discarded";
  text: string | null;
  note: string;
  at: string;
  author: string;
  /** True once the note has been attached to a later campaign brief. */
  attachedToCampaignId: string | null;
};

/* --------------------------------------------------------------- run + log */

export type RunStatus = "idle" | "running" | "paused" | "awaiting_human" | "complete" | "halted";

export type ToolCall = {
  id: string;
  at: string;
  agent: AgentActor;
  tool: string;
  args: Record<string, string | number | boolean>;
  status: "ok" | "empty" | "error" | "skipped";
  summary: string;
  latencyMs: number;
  /** Evidence raised by this call, if any. */
  evidenceIds: string[];
};

export type RunStepId =
  | "intake.validate"
  | "trend.receive"
  | "trend.research"
  | "trend.brief"
  | "creative.receive"
  | "creative.generate"
  | "creative.revise"
  | "compliance.receive"
  | "compliance.review"
  | "compliance.decide"
  | "media.receive"
  | "media.adapt"
  | "media.schedule"
  | "media.conflict_check"
  | "founder.gate"
  | "media.publish"
  | "feedback.collect"
  | "feedback.summarise";

export type RunStep = {
  id: string;
  at: string;
  step: RunStepId;
  agent: Actor;
  status: "ok" | "warn" | "blocked" | "error";
  title: string;
  detail: string;
  policyDecisionId?: string;
  toolCallId?: string;
  evidenceIds?: string[];
};

export type AgentRun = {
  id: string;
  campaignId: string;
  startedAt: string;
  updatedAt: string;
  status: RunStatus;
  step: RunStepId;
  /** Bounded so a demo run always terminates. */
  stepsTaken: number;
  maxSteps: number;
  revisionAttempts: number;
  toolsUsed: string[];
  haltedReason: string | null;
  /** Set when the run needs the founder before it can continue. */
  awaiting: null | "brief_correction" | "trend_clarification" | "approval" | "conflict" | "failure";
  awaitingDetail: string | null;
};

/* ------------------------------------------------------------------ commands */

export type Command =
  /** Validate the brief, write the shared context, hand to the Trend Analyser. */
  | { type: "START"; actor: "founder"; note?: string }
  | { type: "PAUSE"; actor: "founder"; note?: string }
  /** Let the run work until it needs the founder or finishes. */
  | { type: "ADVANCE"; actor: "founder" | "system"; maxSteps?: number }
  /** Founder decision at the approval gate. */
  | { type: "APPROVE"; actor: "founder"; note: string }
  | { type: "REQUEST_CHANGES"; actor: "founder"; note: string }
  | { type: "REJECT"; actor: "founder"; note: string }
  /** Trigger the publish step. The guard decides whether it may happen. */
  | { type: "PUBLISH"; actor: "founder" | "media"; note?: string }
  /** Collect authorised results and draft the next-campaign recommendation. */
  | { type: "COLLECT_FEEDBACK"; actor: "founder" | "system" }
  | {
      type: "DECIDE_RECOMMENDATION";
      actor: "founder";
      action: RecommendationDecision["action"];
      text?: string;
      note?: string;
    }
  /** Deliberately frame an out-of-bounds action so the guard can refuse it. */
  | { type: "ATTEMPT_BLOCKED"; actor: GuardedAction; note?: string }
  /** Resolve or accept a flagged scheduling conflict. */
  | { type: "RESOLVE_CONFLICT"; actor: "founder"; conflictId: string; note: string };

export type EngineContext = {
  /** Every campaign in the workspace — needed for cross-campaign conflicts. */
  campaigns: Campaign[];
  /** Today, injectable so tests are deterministic. */
  now: string;
};

export type EngineResult = {
  campaign: Campaign;
  run: AgentRun;
  /** New log lines, already appended to `campaign.log`. */
  events: Campaign["log"];
  runSteps: RunStep[];
  policyDecisions: PolicyDecision[];
  /** True when another ADVANCE would do more work. */
  canAdvance: boolean;
  message: string;
};
