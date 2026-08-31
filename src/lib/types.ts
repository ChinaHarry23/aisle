import type { AdVideo, MediaGeneration, StudioRun } from "./media/types";

export type AgentId = "founder" | "trend" | "creative" | "compliance" | "media";

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
    | "feedback";
  title: string;
  detail: string;
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
  performance: PerformanceMetrics | null;
  log: AgentEvent[];
  founderDecision: {
    action: "approve" | "reject" | "changes";
    note: string;
    at: string;
  } | null;
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
