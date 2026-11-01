import { uid } from "./ids";
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from "./media/catalog";
import { withRuntimeDefaults } from "./runtime/defaults";
import { sampleCampaigns } from "./sample-campaigns";
import type { WorkspaceSettings } from "./settings";
import type {
  AgentEvent,
  BrandProfile,
  Campaign,
  CampaignInput,
  SharedContext,
} from "./types";

export const defaultBrand: BrandProfile = {
  retailerName: "Woolworths",
  logoUrl: "/woolworths-logo.jpg",
  website: "https://www.woolworths.com.au/",
  about:
    "One of Australia's leading retailers, founded in 1924 and headquartered in Bella Vista, NSW. Supermarkets, liquor and general merchandise across Australia and New Zealand, with a fast-growing online grocery business and a focus on fresh food, sustainability and food-waste reduction.",
  tagline: "The fresh food people.",
  tone: "Friendly, helpful and down to earth. Australian English. Focus on fresh food, everyday value and helping families eat well, without hype.",
  visualStyle:
    "Clean and bright: white space, Apple green (#008446) as the lead colour with a Sulu lime accent. Fresh, well-lit produce photography and real food. No neon, no clutter.",
  approvedTerms: [
    "fresh",
    "seasonal",
    "Australian grown",
    "everyday low price",
    "quality",
    "value",
  ],
  bannedTerms: [
    "guaranteed",
    "miracle",
    "clinically proven",
    "Australia's best",
    "healthiest",
    "risk-free",
    "number one",
  ],
  colors: { ink: "#25251f", paper: "#ffffff", signal: "#008446", accent: "#c8f170", deep: "#024a1f" },
  countryRules: {
    AU: "Australian Consumer Law. No absolute superiority claims without substantiation. Health claims need evidence. Prices include GST unless stated. Promotional statements must not mislead a reasonable consumer.",
    NZ: "Fair Trading Act. Similar to ACL: no misleading or unsubstantiated claims. Comparative advertising needs a fair basis.",
    UK: "CAP/ASA. Claims must be substantiated. Health and environmental claims are high-scrutiny. Promotions must include significant conditions.",
    US: "FTC truth-in-advertising. Endorsements and typicality claims need evidence. Avoid unsubstantiated superlatives.",
  },
};

/** Saved workspaces from before the Woolworths palette still hold the old default
 *  colours (red on cream). Swap that untouched palette for the current one and keep
 *  every other field the user may have edited. */
const LEGACY_COLORS = { ink: "#1c1917", paper: "#f3eee5", signal: "#c4342a" };

export function migrateLegacyBrand<T extends Partial<BrandProfile>>(brand: T): T {
  const c = brand.colors;
  const legacy =
    c?.signal?.toLowerCase() === LEGACY_COLORS.signal &&
    c.ink?.toLowerCase() === LEGACY_COLORS.ink &&
    c.paper?.toLowerCase() === LEGACY_COLORS.paper;
  return legacy ? { ...brand, colors: defaultBrand.colors } : brand;
}

export function makeLog(
  agent: AgentEvent["agent"],
  kind: AgentEvent["kind"],
  title: string,
  detail: string,
  at?: string,
): AgentEvent {
  return {
    id: uid("log"),
    at: at ?? new Date().toISOString(),
    agent,
    kind,
    title,
    detail,
  };
}

function makeContext(
  input: Pick<
    CampaignInput,
    "product" | "targetAudience" | "objective" | "country" | "notes"
  >,
  brand: BrandProfile,
  previousPerformanceNote: string | null,
  previousPerformanceFrom: string | null,
): SharedContext {
  return {
    retailer: brand.retailerName,
    product: input.product,
    audience: input.targetAudience,
    objective: input.objective,
    country: input.country,
    brandTone: brand.tone,
    approvedClaims: [],
    previousPerformanceNote,
    previousPerformanceFrom: previousPerformanceNote ? previousPerformanceFrom : null,
    founderNotes: input.notes ? [input.notes] : [],
  };
}

export function blankCampaign(
  input: CampaignInput,
  brand: BrandProfile,
  previousPerformanceNote: string | null,
  settings?: Pick<WorkspaceSettings, "imageModelId" | "videoModelId" | "videoDurationSec">,
  previousPerformanceFrom: string | null = null,
): Campaign {
  const createdAt = new Date().toISOString();
  return withRuntimeDefaults({
    ...input,
    id: uid("cmp"),
    status: "draft",
    createdAt,
    updatedAt: createdAt,
    revisionCount: 0,
    running: false,
    imageModelId: input.imageModelId ?? settings?.imageModelId ?? DEFAULT_IMAGE_MODEL,
    videoModelId: input.videoModelId ?? settings?.videoModelId ?? DEFAULT_VIDEO_MODEL,
    videoDurationSec: settings?.videoDurationSec ?? 8,
    videos: [],
    studioHistory: [],
    studioBusy: null,
    sharedContext: makeContext(input, brand, previousPerformanceNote, previousPerformanceFrom),
    trends: [],
    opportunities: [],
    personas: [],
    brief: null,
    creatives: [],
    complianceReports: [],
    adaptations: [],
    schedule: [],
    performance: null,
    log: [
      makeLog(
        "founder",
        "decision",
        "Campaign created",
        `${input.name} — ${input.product} for ${input.targetAudience}. Tasks will be handed to the agent bench when launched.`,
        createdAt,
      ),
    ],
    founderDecision: null,
    internalDataAuthorised: false,
    evidence: [],
    trendFindings: [],
    trendGaps: [],
    complianceAttempts: [],
    channelVersions: [],
    scheduleConflicts: [],
    runSchedule: [],
    performanceReport: null,
    recommendationDecision: null,
    policyDecisions: [],
    runSteps: [],
    toolCalls: [],
    spend: {
      inferenceUsd: 0,
      mediaUsd: 0,
      capUsd: 0,
      blockedAttempts: 0,
    },
    run: null,
    validationProblems: [],
    collectorOverrides: {},
  });
}

/** The two published campaigns every account is given. */
export const SAMPLE_CAMPAIGN_IDS = ["cmp_0746alsscv", "cmp_a64b30ipxy"];

const SAMPLE_SUFFIX = " (Sample)";

/** Campaign titles shown on the board and in the library. */
export function sampleCampaignName(name: string) {
  const trimmed = name.trim();
  return trimmed.endsWith(SAMPLE_SUFFIX) ? trimmed : `${trimmed}${SAMPLE_SUFFIX}`;
}

export function seedCampaigns(_brand: BrandProfile): Campaign[] {
  // The sample is a frozen copy of two published campaigns. Cloning keeps one
  // account's edits from changing the copy the next account receives.
  return sampleCampaigns.map((campaign) =>
    withRuntimeDefaults({
      ...structuredClone(campaign),
      name: sampleCampaignName(campaign.name),
    }),
  );
}
