import { uid } from "./ids";
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from "./media/catalog";
import { stubGenerate } from "./media/stub";
import { withRuntimeDefaults } from "./runtime/defaults";
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
    internalDataAuthorised: true,
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

export function seedCampaigns(brand: BrandProfile): Campaign[] {
  // Seeded campaigns carry only what the demo needs; `withRuntimeDefaults`
  // fills the rest of the runtime contract at the end of this function.
  const produce = {
    id: "cmp_spring_produce",
    name: "Sample: Spring fresh produce (needs your approval)",
    product: "Seasonal Australian-grown fruit and veg",
    category: "Grocery",
    targetAudience: "Families doing the weekly shop, 30–50",
    objective: "Drive weekly-shop sales of in-season fresh produce over two weeks",
    budget: 12000,
    channels: ["instagram"],
    startDate: "2026-10-19",
    endDate: "2026-11-01",
    country: "AU",
    notes: "Sample campaign: the agents have finished and it is waiting for you. Open it, read the checks, then approve. Keep it fresh and down to earth, no health claims.",
    status: "awaiting_approval",
    createdAt: "2026-10-13T03:30:00.000Z",
    updatedAt: "2026-10-13T04:05:00.000Z",
    revisionCount: 1,
    running: false,
    imageModelId: "ideogram:v4-quality",
    videoModelId: "google:veo-3.1-fast",
    videoDurationSec: 8,
    videos: [],
    studioHistory: [],
    studioBusy: null,
    sharedContext: {
      retailer: brand.retailerName,
      product: "Seasonal Australian-grown fruit and veg",
      audience: "Families doing the weekly shop, 30–50",
      objective: "Lift weekly-shop sales of in-season fresh produce",
      country: "AU",
      brandTone: brand.tone,
      approvedClaims: ["In season now", "Australian grown where labelled", "Fresh every day"],
      previousPerformanceNote: null,
      previousPerformanceFrom: null,
      founderNotes: ["Keep it fresh and down to earth. No health claims."],
    },
    internalDataAuthorised: true,
    evidence: [
      {
        id: "ev_spring_1",
        claim: "Spring produce is peaking early",
        detail:
          "Buyer notes: strawberries, asparagus and mangoes are arriving in volume two weeks into spring, with first-week POS up 18% on last year.",
        sourceName: "Buyer notes + POS",
        sourceRef: "internal://pos/fresh-produce/2026-10-12",
        sourceKind: "internal_retail",
        observedAt: "2026-10-11",
        fetchedAt: "2026-10-12T22:31:00.000Z",
        status: "verified",
        confidence: 86,
        raisedBy: "trend",
        usedFor: "Seasonal timing",
      },
      {
        id: "ev_spring_2",
        claim: "Weekly-shop baskets with fresh produce are larger",
        detail:
          "Baskets that start with a fresh produce item carry more lines than baskets that do not, across the last eight weeks of online orders.",
        sourceName: "Online order history",
        sourceRef: "internal://orders/basket-size/2026-10-12",
        sourceKind: "internal_retail",
        observedAt: "2026-10-10",
        fetchedAt: "2026-10-12T22:31:03.000Z",
        status: "verified",
        confidence: 80,
        raisedBy: "trend",
        usedFor: "Angle selection",
      },
      {
        id: "ev_spring_3",
        claim: "Shoppers respond to plain value over hype",
        detail:
          "Modelled from category behaviour, not measured for this retailer this season.",
        sourceName: "Assumption register",
        sourceRef: "assumption://category-behaviour/fresh-produce",
        sourceKind: "model_inference",
        observedAt: "2026-10-12",
        fetchedAt: "2026-10-12T22:31:06.000Z",
        status: "assumed",
        confidence: 58,
        raisedBy: "trend",
        usedFor: "Tone guidance",
      },
    ],
    trendFindings: [
      {
        id: "tf_spring_1",
        topic: "Spring produce is landing early",
        finding:
          "Strawberries, asparagus and mangoes are arriving in volume ahead of last year, so the freshness story is genuinely timely for these two weeks.",
        basis: "supported",
        relevance: 94,
        confidence: 86,
        country: "AU",
        channelRelevance: ["instagram"],
        themeSuggestion: "Spring is here. So is the good stuff.",
        visualDirection: "Bright, well-lit produce on white with Apple green type. Real food, no clutter.",
        evidenceIds: ["ev_spring_1"],
      },
      {
        id: "tf_spring_2",
        topic: "Fresh first builds a bigger shop",
        finding:
          "Online baskets that begin with fresh produce are larger, so the campaign leads the shop with produce rather than a single-item deal.",
        basis: "supported",
        relevance: 87,
        confidence: 80,
        country: "AU",
        channelRelevance: ["instagram"],
        themeSuggestion: "Start the shop with what's in season.",
        evidenceIds: ["ev_spring_2"],
      },
      {
        id: "tf_spring_3",
        topic: "Plain value reads better than hype",
        finding: "A modelled read of category behaviour, not surveyed preference.",
        basis: "assumption",
        relevance: 78,
        confidence: 58,
        country: "AU",
        channelRelevance: ["instagram"],
        risk: "Superlatives such as 'best' or 'healthiest' are on the brand banned-terms list.",
        evidenceIds: [],
      },
    ],
    trendGaps: [
      {
        id: "gap_spring_1",
        kind: "low_confidence",
        detail: "No customer survey data is connected for this cycle.",
        effect: "Personas are modelled from category behaviour, not interviewed shoppers.",
        needsFounder: false,
      },
    ],
    trends: [
      {
        id: "tr_s1",
        topic: "Spring produce is landing early",
        evidence:
          "Buyer notes: strawberries, asparagus and mangoes arriving in volume. First-week POS +18% vs last year.",
        source: "Buyer + POS",
        relevance: 94,
        confidence: 86,
      },
      {
        id: "tr_s2",
        topic: "Fresh first builds a bigger shop",
        evidence: "Online baskets that start with fresh produce carry more lines across eight weeks of orders.",
        source: "Online order history",
        relevance: 87,
        confidence: 80,
      },
    ],
    opportunities: [
      {
        id: "op_s1",
        title: "Start the shop with what's in season",
        why: "Timeliness is real this fortnight, and leading with produce is the strongest basket-builder we can show.",
        audienceFit: 92,
        expectedValue: "High for web and email, steady for print.",
        rank: 1,
      },
      {
        id: "op_s2",
        title: "Australian grown, labelled",
        why: "Origin is a verifiable fact where labelled and supports the brand's fresh-food positioning without a superlative.",
        audienceFit: 84,
        expectedValue: "Medium: supporting proof point, not the hero.",
        rank: 2,
      },
    ],
    personas: [
      {
        id: "ps_s1",
        name: "Sam, weekly-shop parent",
        age: "41, Brisbane",
        summary:
          "Plans the shop on the app on Sunday night. Buys what looks fresh and fair, ignores big claims.",
        channels: ["Email", "Woolworths app and web", "Instagram"],
        motivations: ["Fresh and in season", "Fair prices", "Quick to plan"],
      },
    ],
    brief: {
      product: "Seasonal Australian-grown fruit and veg",
      angle: "Spring is here. Start the shop with what's in season.",
      audience: "Families doing the weekly shop, 30–50",
      channels: ["instagram"],
      keyMessage: "In season now. Fresh every day.",
      claimsAllowed: ["In season now", "Australian grown where labelled", "Fresh every day"],
      claimsAvoid: ["Australia's best produce", "Healthiest choice", "Guaranteed fresh"],
      visualDirection:
        "Bright, well-lit produce on white, Apple green type with a Sulu lime accent. Real food, no clutter.",
    },
    creatives: [
      {
        id: "cr_spring_a",
        variant: "A",
        version: 2,
        kicker: "Woolworths · Spring",
        headline: "In season now. Fresh every day.",
        subhead: "Start the weekly shop with Australian-grown strawberries, asparagus and mangoes.",
        cta: "Shop fresh produce",
        caption:
          "Spring is here. Strawberries, asparagus and mangoes are in season now, Australian grown where labelled.",
        palette: { bg: "#ffffff", fg: "#25251f", accent: "#008446", muted: "#6b7a6e" },
        motif: "produce",
        status: "revised",
        prompt:
          "Bright, well-lit spring produce on a white background, Apple green headline, Sulu lime accent, no clutter.",
        // Drawn by Claude as an SVG rather than rendered by an image model, so the
        // sample has a real picture without needing a provider key.
        generation: {
          ...stubGenerate(
            {
              kind: "image",
              modelId: "ideogram:v4-quality",
              prompt: "Spring produce illustration: asparagus, strawberries and mango on Apple green and lime.",
              aspectRatio: "4:5",
            },
            "Illustration drawn by Claude (SVG)",
          ),
          url: "/spring-produce.svg",
        },
      },
      {
        id: "cr_spring_b",
        variant: "B",
        version: 2,
        kicker: "Woolworths · This week",
        headline: "Spring is here. So is the good stuff.",
        subhead: "Fresh, in season and ready for the weekly shop.",
        cta: "See this week's fresh",
        caption: "In season now at Woolworths. Fresh every day.",
        palette: { bg: "#024a1f", fg: "#ffffff", accent: "#c8f170", muted: "#a9c9b0" },
        motif: "editorial",
        status: "revised",
        prompt: "Deep green catalogue panel, white serif headline, lime accent, small produce photo.",
      },
    ],
    complianceReports: [
      {
        id: "cp_spring_1",
        creativeId: "cr_spring_a",
        version: 1,
        risk: "medium",
        score: 66,
        verdict: "revise",
        summary:
          "Version 1 said 'Australia's freshest produce'. Returned to creative with a structured fix.",
        findings: [
          {
            id: "sf1",
            severity: "medium",
            type: "Unsubstantiated superiority",
            excerpt: "Australia's freshest produce",
            explanation:
              "An absolute superiority claim needs substantiation we do not hold, and it conflicts with the brand's banned terms.",
            rule: "AU · ACL s18 / s29 + brand banned terms",
          },
        ],
        countryProfile: "AU",
      },
      {
        id: "cp_spring_2",
        creativeId: "cr_spring_a",
        version: 2,
        risk: "low",
        score: 94,
        verdict: "pass",
        summary:
          "Revised copy uses verifiable facts (in season, Australian grown where labelled). Tone matches the brand. Cleared for distribution.",
        findings: [],
        countryProfile: "AU",
      },
    ],
    adaptations: [
      {
        channel: "instagram",
        headline: "In season now.",
        body: "Strawberries, asparagus and mangoes. Australian grown where labelled. Fresh every day.",
        specs: "4:5 feed and 9:16 Stories, hook in the first 125 characters, up to 3 hashtags.",
        postingTime: "Tue 12:15",
        postingReason: "Lunch-break scrolling peaks midday on weekdays.",
      },
    ],
    schedule: [],
    performance: null,
    log: [
      makeLog("founder", "decision", "Campaign created", "Spring fresh produce for weekly-shop families.", "2026-10-12T22:30:00.000Z"),
      makeLog("trend", "insight", "Seasonal and basket data scanned", "Produce is landing early and fresh-first baskets are larger.", "2026-10-12T22:31:10.000Z"),
      makeLog("trend", "output", "Brief handed to creative", "Angle: Spring is here. Start the shop with what's in season.", "2026-10-12T22:32:00.000Z"),
      makeLog("creative", "output", "v1 generated (2 variants)", "A: white and green. B: deep green panel.", "2026-10-12T22:34:00.000Z"),
      makeLog("compliance", "flag", "v1 failed: superiority claim", "'Australia's freshest produce' has no substantiation. Structured fix sent to creative.", "2026-10-12T22:35:00.000Z"),
      makeLog("creative", "revision", "v2 rewritten", "Claim replaced with 'In season now. Fresh every day.'", "2026-10-12T22:37:00.000Z"),
      makeLog("compliance", "output", "v2 passed (low risk)", "Score 94. Waiting for the founder.", "2026-10-12T22:39:00.000Z"),
      makeLog("media", "schedule", "Instagram version ready", "Feed post adapted and a posting time proposed. Waiting for founder approval.", "2026-10-13T04:05:00.000Z"),
    ],
    founderDecision: null,
  } satisfies Partial<Campaign>;

  return [
    withRuntimeDefaults(produce as Partial<Campaign> as Campaign),
  ];
}
