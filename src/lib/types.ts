import type { AdVideo, MediaGeneration, StudioRun } from "./media/types";
import type {
  AgentRun,
  ChannelResultStatus,
  ChannelVersion,
  ComplianceAttempt,
  Evidence,
  PerformanceReport,
  PolicyDecision,
  RecommendationDecision,
  RunScheduleItem,
  RunStep,
  ScheduleConflict,
  ToolCall,
  TrendBriefGap,
  TrendFinding,
} from "./runtime/types";

export type AgentId = "founder" | "trend" | "creative" | "compliance" | "media" | "intake";

export type Channel =
  | "instagram"
  | "web"
  | "email"
  | "print"
  | "digital_signage";

export type Country = "AU" | "NZ" | "UK" | "US";

export type CampaignStatus =
  | "draft"
  | "analysing"
  | "generating"
  | "compliance"
  | "revising"
  | "awaiting_approval"
  | "rejected"
  | "scheduling"
  | "scheduled"
  | "published"
  | "paused";

export type RiskLevel = "low" | "medium" | "high";

export type CampaignInput = {
  name: string;
  product: string;
  category: string;
  targetAudience: string;
  objective: string;
  budget: number;
  channels: Channel[];
  startDate: string;
  endDate: string;
  country: Country;
  notes: string;
  imageModelId?: string;
  videoModelId?: string;
  /** Ceiling the founder sets on automated spend for this campaign. */
  spendCapUsd?: number;
};

export type Trend = {
  id: string;
  topic: string;
  evidence: string;
  source: string;
  relevance: number;
  confidence: number;
};

export type Opportunity = {
  id: string;
  title: string;
  why: string;
  audienceFit: number;
  expectedValue: string;
  rank: number;
};

export type Persona = {
  id: string;
  name: string;
  age: string;
  summary: string;
  channels: string[];
  motivations: string[];
};

export type CampaignBrief = {
  product: string;
  angle: string;
  audience: string;
  channels: Channel[];
  keyMessage: string;
  claimsAllowed: string[];
  claimsAvoid: string[];
  visualDirection: string;
};

export type Palette = {
  bg: string;
  fg: string;
  accent: string;
  muted: string;
};

export type Creative = {
  id: string;
  variant: "A" | "B";
  version: number;
  kicker: string;
  headline: string;
  subhead: string;
  cta: string;
  caption: string;
  palette: Palette;
  motif: "campus" | "produce" | "pantry" | "editorial";
  status: "draft" | "flagged" | "revised" | "approved" | "rejected";
  prompt: string;
  generation?: MediaGeneration;
};

export type ComplianceFinding = {
  id: string;
  severity: RiskLevel;
  type: string;
  excerpt: string;
  explanation: string;
  rule: string;
};

export type ComplianceReport = {
  id: string;
  creativeId: string;
  version: number;
  risk: RiskLevel;
  score: number;
  verdict: "pass" | "revise" | "escalate";
  summary: string;
  findings: ComplianceFinding[];
  countryProfile: string;
  /** AHR-04 policy detail: issue basis, rule source, revision attempt. */
  attempt?: ComplianceAttempt;
};

export type ChannelAdaptation = {
  channel: Channel;
  headline: string;
  body: string;
  specs: string;
  postingTime: string;
  postingReason: string;
};

export type ScheduleItem = {
  id: string;
  channel: Channel;
  at: string;
  status: "scheduled" | "published" | "failed";
  note: string;
};

export type PerformanceMetrics = {
  impressions: number;
  clicks: number;
  ctr: number;
  engagement: number;
  conversions: number;
  reach: number;
  byChannel: Record<string, { impressions: number; ctr: number; engagement: number }>;
  summary: string;
  recommendation: string;
};

export type AgentEvent = {
  id: string;
  at: string;
  agent: AgentId;
  kind:
    | "handoff"
    | "insight"
    | "output"
    | "flag"
    | "revision"
    | "escalation"
    | "decision"
    | "schedule"
    | "feedback"
    | "policy"
    | "tool"
    | "gap"
    | "intake";
  title: string;
  detail: string;
  /** Links the line back to the run step, guard decision or tool call. */
  runStepId?: string;
  policyDecisionId?: string;
  toolCallId?: string;
  evidenceIds?: string[];
};

export type SharedContext = {
  retailer: string;
  product: string;
  audience: string;
  objective: string;
  country: Country;
  brandTone: string;
  approvedClaims: string[];
  previousPerformanceNote: string | null;
  /** Campaign the attached note came from, for traceability (UC-06 step 12). */
  previousPerformanceFrom: string | null;
  founderNotes: string[];
};

export type Campaign = CampaignInput & {
  id: string;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
  revisionCount: number;
  running: boolean;
  imageModelId: string;
  videoModelId: string;
  videoDurationSec: number;
  videos: AdVideo[];
  studioHistory: StudioRun[];
  studioBusy: null | "posters" | "video";
  sharedContext: SharedContext;
  trends: Trend[];
  opportunities: Opportunity[];
  personas: Persona[];
  brief: CampaignBrief | null;
  creatives: Creative[];
  complianceReports: ComplianceReport[];
  adaptations: ChannelAdaptation[];
  schedule: ScheduleItem[];
  /** @deprecated superseded by `performanceReport`; kept for seeded history. */
  performance: PerformanceMetrics | null;
  log: AgentEvent[];
  founderDecision: {
    action: "approve" | "reject" | "changes";
    note: string;
    at: string;
  } | null;

  /* ---- agent runtime (AHR-01 … AHR-06) ---- */
  /**
   * UC-02 ext 4.b: internal retail data (POS, catalogue history) is only read
   * when the retailer has authorised it. Defaults to true for the demo tenant.
   */
  internalDataAuthorised: boolean;
  /** Every factual claim the bench used, with its source and date. */
  evidence: Evidence[];
  /** AHR-02 findings, each linked to evidence. */
  trendFindings: TrendFinding[];
  /** What the analysis could not establish, and whether a human is needed. */
  trendGaps: TrendBriefGap[];
  /** Every version submitted to AHR-04, kept for audit. */
  complianceAttempts: ComplianceAttempt[];
  /** AHR-05 channel-ready versions, claim-frozen. */
  channelVersions: ChannelVersion[];
  /** AHR-05 conflicts flagged rather than silently resolved. */
  scheduleConflicts: ScheduleConflict[];
  runSchedule: RunScheduleItem[];
  /** AHR-06 structured collection, gaps and sourced recommendation. */
  performanceReport: PerformanceReport | null;
  recommendationDecision: RecommendationDecision | null;
  /** Declared per-channel report outcomes. See `ChannelResultStatus`. */
  collectorOverrides: Partial<Record<Channel, ChannelResultStatus>>;
  /** Every guard evaluation, allowed or blocked. */
  policyDecisions: PolicyDecision[];
  /** Step-by-step trace of the current/last bench run. */
  runSteps: RunStep[];
  /** Tool calls the agents actually made. */
  toolCalls: ToolCall[];
  /** Model + media spend incurred by agents. */
  spend: {
    inferenceUsd: number;
    mediaUsd: number;
    capUsd: number;
    blockedAttempts: number;
  };
  run: AgentRun | null;
  /** Set when a launch was refused, so the brief can show what to fix. */
  validationProblems: { field: string; message: string; clause: string }[];
};

export type BrandProfile = {
  retailerName: string;
  tagline: string;
  tone: string;
  visualStyle: string;
  approvedTerms: string[];
  bannedTerms: string[];
  colors: { ink: string; paper: string; signal: string };
  countryRules: Record<Country, string>;
};
