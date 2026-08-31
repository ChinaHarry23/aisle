import { uid } from "./ids";
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from "./media/catalog";
import { stubGenerate } from "./media/stub";
import type { WorkspaceSettings } from "./settings";
import type {
  AgentEvent,
  BrandProfile,
  Campaign,
  CampaignInput,
  SharedContext,
} from "./types";

export const defaultBrand: BrandProfile = {
  retailerName: "Lane & Co.",
  tagline: "Neighbourhood retail, properly done.",
  tone: "Warm, direct, never shouty. Australian English. Speak like a good local shop, not a holding company.",
  visualStyle:
    "Paper catalogue meets modern grocery: cream stock, ink type, a single signal red. Photography is honest. No neon, no stock-smile families.",
  approvedTerms: [
    "seasonal",
    "neighbourhood",
    "quality",
    "value",
    "Australian",
    "made to last",
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
  colors: { ink: "#1c1917", paper: "#f3eee5", signal: "#c4342a" },
  countryRules: {
    AU: "Australian Consumer Law. No absolute superiority claims without substantiation. Health claims need evidence. Prices include GST unless stated. Promotional statements must not mislead a reasonable consumer.",
    NZ: "Fair Trading Act. Similar to ACL: no misleading or unsubstantiated claims. Comparative advertising needs a fair basis.",
    UK: "CAP/ASA. Claims must be substantiated. Health and environmental claims are high-scrutiny. Promotions must include significant conditions.",
    US: "FTC truth-in-advertising. Endorsements and typicality claims need evidence. Avoid unsubstantiated superlatives.",
  },
};

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

export function makeContext(
  input: Pick<
    CampaignInput,
    "product" | "targetAudience" | "objective" | "country" | "notes"
  >,
  brand: BrandProfile,
  previousPerformanceNote: string | null,
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
    founderNotes: input.notes ? [input.notes] : [],
  };
}

export function blankCampaign(
  input: CampaignInput,
  brand: BrandProfile,
  previousPerformanceNote: string | null,
  settings?: Pick<WorkspaceSettings, "imageModelId" | "videoModelId" | "videoDurationSec">,
): Campaign {
  const createdAt = new Date().toISOString();
  return {
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
    sharedContext: makeContext(input, brand, previousPerformanceNote),
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
  };
}

export function seedCampaigns(brand: BrandProfile): Campaign[] {
  const parka: Campaign = {
    id: "cmp_parka",
    name: "Trail Parka — campus winter drop",
    product: "Northline Trail Parka (navy)",
    category: "Apparel",
    targetAudience: "Australian university students, 18–24",
    objective: "Drive awareness and add-to-cart for the new winter jacket",
    budget: 18000,
    channels: ["instagram", "web", "email", "digital_signage"],
    startDate: "2026-08-18",
    endDate: "2026-09-07",
    country: "AU",
    notes: "Promote our new winter jacket to Australian university students.",
    status: "published",
    createdAt: "2026-08-16T09:12:00.000Z",
    updatedAt: "2026-08-18T07:40:00.000Z",
    revisionCount: 1,
    running: false,
    imageModelId: "ideogram:v4-quality",
    videoModelId: "google:veo-3.1-fast",
    videoDurationSec: 8,
    videos: [
      {
        id: "vid_parka_1",
        version: 1,
        title: "Trail Parka — 8s campus walk",
        prompt:
          "8-second retail ad. Navy Trail Parka on a wet Melbourne campus path. No wilderness. End on pack shot. Headline: Weatherproof. Not wilderness.",
        durationSec: 8,
        aspect: "9:16",
        status: "ready",
        generation: stubGenerate(
          {
            kind: "video",
            modelId: "google:veo-3.1-fast",
            prompt:
              "8-second retail ad. Navy Trail Parka on a wet Melbourne campus path. No wilderness. End on pack shot.",
            durationSec: 8,
            aspectRatio: "9:16",
          },
          "Seeded studio take",
        ),
      },
    ],
    studioHistory: [],
    studioBusy: null,
    sharedContext: {
      retailer: brand.retailerName,
      product: "Northline Trail Parka (navy)",
      audience: "Australian university students, 18–24",
      objective: "Drive awareness and add-to-cart for the new winter jacket",
      country: "AU",
      brandTone: brand.tone,
      approvedClaims: [
        "Water-resistant shell",
        "Packs into its own pocket",
        "Cut for commuting, not the summit",
      ],
      previousPerformanceNote: null,
      founderNotes: [
        "Keep it campus, not outdoorsy-macho. No mountain-peak clichés.",
      ],
    },
    trends: [
      {
        id: "tr_1",
        topic: "Campus southerlies, not ski trips",
        evidence:
          "POS: outerwear +34% WoW in stores within 2km of universities. Search: 'uni jacket rain' up 41% in NSW/VIC.",
        source: "POS + internal search",
        relevance: 96,
        confidence: 88,
      },
      {
        id: "tr_2",
        topic: "Quiet utility over logo-heavy streetwear",
        evidence:
          "Social listening: students posting 'actual warm' garments; logo-forward puffers underperforming in comments.",
        source: "Social listening",
        relevance: 84,
        confidence: 79,
      },
      {
        id: "tr_3",
        topic: "Late-winter layering, not July sale energy",
        evidence:
          "Seasonal cycle: Lane & Co. winter clearance usually week 36. Trail Parka is a newness story, not a markdown story.",
        source: "Seasonal calendar",
        relevance: 81,
        confidence: 91,
      },
    ],
    opportunities: [
      {
        id: "op_1",
        title: "Weatherproof, not wilderness",
        why: "Students buy jackets for 8am lectures and tram stops. Competitor ads still sell 'adventure'. The gap is commuting warmth with a straight face.",
        audienceFit: 94,
        expectedValue: "High — category is in-season, creative angle is unoccupied.",
        rank: 1,
      },
      {
        id: "op_2",
        title: "Packable for the library bag",
        why: "Packs-into-pocket is a true product fact and maps to bag-space anxiety on campus.",
        audienceFit: 86,
        expectedValue: "Medium — supporting proof point, not the hero.",
        rank: 2,
      },
    ],
    personas: [
      {
        id: "ps_1",
        name: "Mina, second-year arts",
        age: "20, Melbourne",
        summary:
          "Walks 18 minutes to campus. Buys two good pieces a season. Follows slow-fashion accounts, ignores outdoor-brand heroics.",
        channels: ["Instagram Stories", "student email", "in-store"],
        motivations: ["Looks considered", "Doesn't drown in rain", "Not a costume"],
      },
      {
        id: "ps_2",
        name: "Jonah, engineering",
        age: "22, Sydney",
        summary:
          "Lives in a leaky sharehouse. Wants one jacket that works from lab to pub. Sceptical of 'performance' copy.",
        channels: ["Instagram", "website", "digital signage near campus stores"],
        motivations: ["Warmth", "Price honesty", "No gearhead jargon"],
      },
    ],
    brief: {
      product: "Northline Trail Parka (navy)",
      angle: "Campus weather, not wilderness. A jacket for lectures, trams, and the walk between.",
      audience: "Australian university students, 18–24",
      channels: ["instagram", "web", "email", "digital_signage"],
      keyMessage: "Weatherproof. Not wilderness.",
      claimsAllowed: [
        "Water-resistant shell",
        "Packs into its own pocket",
        "Designed for commuting",
      ],
      claimsAvoid: ["Warmest jacket in Australia", "Guaranteed dry", "Professional-grade expedition"],
      visualDirection: "Navy field, cream type, red signal mark. Cropped urban rain, not alpine peaks.",
    },
    creatives: [
      {
        id: "cr_parka_a",
        variant: "A",
        version: 2,
        kicker: "Northline · Winter 26",
        headline: "Weatherproof. Not wilderness.",
        subhead: "The Trail Parka. Cut for 8am lectures and 6pm southerlies.",
        cta: "Shop the parka",
        caption:
          "New Trail Parka in navy. Water-resistant shell, packs into its pocket. Made for campus weather — Lane & Co.",
        palette: {
          bg: "#1b2430",
          fg: "#f4efe6",
          accent: "#c4342a",
          muted: "#8b9aab",
        },
        motif: "campus",
        status: "approved",
        prompt:
          "Editorial navy parka on a wet campus path, cream serif headline, no mountain peaks, Lane & Co. signal red mark.",
        generation: stubGenerate(
          {
            kind: "image",
            modelId: "ideogram:v4-quality",
            prompt:
              "Editorial navy parka on a wet campus path, cream serif headline, no mountain peaks, Lane & Co. signal red mark.",
            aspectRatio: "4:5",
          },
          "Seeded studio take",
        ),
      },
      {
        id: "cr_parka_b",
        variant: "B",
        version: 2,
        kicker: "Northline · Campus drop",
        headline: "Winter, but make it campus.",
        subhead: "Warmth that fits in a bag. No summit required.",
        cta: "See the drop",
        caption:
          "Trail Parka — packable, water-resistant, priced like a neighbourhood shop not a flagship outdoor brand.",
        palette: {
          bg: "#f3eee5",
          fg: "#1c1917",
          accent: "#c4342a",
          muted: "#6b645b",
        },
        motif: "editorial",
        status: "approved",
        prompt:
          "Cream catalogue page, oversized serif, small navy parka illustration, plenty of paper margin.",
        generation: stubGenerate(
          {
            kind: "image",
            modelId: "bfl:flux-2-pro",
            prompt:
              "Cream catalogue page, oversized serif, small navy parka illustration, plenty of paper margin.",
            aspectRatio: "4:5",
          },
          "Seeded studio take",
        ),
      },
    ],
    complianceReports: [
      {
        id: "cp_parka_1",
        creativeId: "cr_parka_a",
        version: 1,
        risk: "high",
        score: 38,
        verdict: "revise",
        summary:
          "Version 1 used an unsubstantiated superiority claim ('the warmest jacket in Australia'). Returned to creative with a structured fix.",
        findings: [
          {
            id: "f1",
            severity: "high",
            type: "Unsubstantiated superiority",
            excerpt: "The warmest jacket in Australia",
            explanation:
              "ACL prohibits absolute comparative claims without a reasonable basis. No lab or panel data exists for 'warmest'.",
            rule: "AU · ACL s18 / s29",
          },
        ],
        countryProfile: "AU",
      },
      {
        id: "cp_parka_2",
        creativeId: "cr_parka_a",
        version: 2,
        risk: "low",
        score: 91,
        verdict: "pass",
        summary:
          "Revised copy uses verifiable product facts. Tone matches brand. Cleared for distribution after founder sign-off on medium-reach student targeting.",
        findings: [],
        countryProfile: "AU",
      },
    ],
    adaptations: [
      {
        channel: "instagram",
        headline: "Weatherproof. Not wilderness.",
        body: "Trail Parka in navy. Water-resistant. Packs into its pocket. For lectures, trams, and the walk between. — Lane & Co.",
        specs: "1:1 and 4:5, caption ≤ 125 characters of hook, no more than 3 hashtags.",
        postingTime: "Tue 11:40",
        postingReason: "Campus Stories peak between 11:20–12:10 on teaching days.",
      },
      {
        channel: "web",
        headline: "The Trail Parka — campus winter drop",
        body: "A water-resistant shell cut for commuting, not the summit. Packs into its own pocket. Navy, in store and online.",
        specs: "1440×520 hero, 6-word headline, secondary proof bullets.",
        postingTime: "Tue 07:00",
        postingReason: "Homepage refresh before morning commuting traffic.",
      },
      {
        channel: "email",
        headline: "A jacket for the walk to class",
        body: "New from Northline: the Trail Parka. Water-resistant, packable, priced without outdoor-brand theatre. 14-day returns.",
        specs: "600px, headline + 70 words, single CTA.",
        postingTime: "Tue 16:35",
        postingReason: "Student inboxes open after last lecture, before dinner.",
      },
      {
        channel: "digital_signage",
        headline: "Weatherproof. Not wilderness.",
        body: "Trail Parka · Navy · In store",
        specs: "Portrait 9:16, 6 words, high contrast at 3 metres.",
        postingTime: "Always-on week of 18 Aug",
        postingReason: "Campus-adjacent stores, lecture-changeover dwell.",
      },
    ],
    schedule: [
      {
        id: "sch_1",
        channel: "web",
        at: "2026-08-18T07:00:00.000Z",
        status: "published",
        note: "Homepage hero live",
      },
      {
        id: "sch_2",
        channel: "instagram",
        at: "2026-08-18T01:40:00.000Z",
        status: "published",
        note: "Feed + Stories",
      },
      {
        id: "sch_3",
        channel: "email",
        at: "2026-08-18T06:35:00.000Z",
        status: "published",
        note: "Student list, 41k",
      },
      {
        id: "sch_4",
        channel: "digital_signage",
        at: "2026-08-18T00:00:00.000Z",
        status: "published",
        note: "4 campus-adjacent stores",
      },
    ],
    performance: {
      impressions: 412000,
      clicks: 19780,
      ctr: 4.8,
      engagement: 3.1,
      conversions: 1260,
      reach: 188000,
      byChannel: {
        instagram: { impressions: 240000, ctr: 5.4, engagement: 4.2 },
        web: { impressions: 88000, ctr: 3.9, engagement: 1.4 },
        email: { impressions: 41000, ctr: 6.1, engagement: 5.0 },
        digital_signage: { impressions: 43000, ctr: 0, engagement: 0 },
      },
      summary:
        "Angle 'Weatherproof. Not wilderness.' outperformed variant B on Instagram CTR (5.4% vs 3.1%). Students saved the packable proof-point more than the fashion framing.",
      recommendation:
        "Carry the commuting-not-wilderness angle into the next outerwear cycle. Do not reopen a 'warmest/best' claim — revision loop already spent a cycle on it.",
    },
    log: [
      makeLog(
        "founder",
        "decision",
        "Campaign created",
        "Promote our new winter jacket to Australian university students.",
        "2026-08-16T09:12:00.000Z",
      ),
      makeLog(
        "trend",
        "handoff",
        "Received campaign task",
        "Shared context loaded: product, audience, AU market, brand tone.",
        "2026-08-16T09:12:08.000Z",
      ),
      makeLog(
        "trend",
        "insight",
        "POS + seasonal + social scanned",
        "Outerwear velocity is campus-local. Competitor ads still sell wilderness.",
        "2026-08-16T09:12:20.000Z",
      ),
      makeLog(
        "trend",
        "output",
        "Brief handed to creative",
        "Angle: Weatherproof. Not wilderness. Personas Mina and Jonah attached.",
        "2026-08-16T09:12:32.000Z",
      ),
      makeLog(
        "creative",
        "output",
        "Two variants generated",
        "A: navy field, commuting line. B: cream catalogue page. v1 included a superiority claim later rejected.",
        "2026-08-16T09:13:00.000Z",
      ),
      makeLog(
        "compliance",
        "flag",
        "High-risk claim on v1",
        "'The warmest jacket in Australia' — no substantiation. Sending structured fix to creative.",
        "2026-08-16T09:13:12.000Z",
      ),
      makeLog(
        "creative",
        "revision",
        "v2 rewritten from compliance notes",
        "Claim replaced with water-resistant / packable / commuting facts.",
        "2026-08-16T09:13:28.000Z",
      ),
      makeLog(
        "compliance",
        "output",
        "v2 passed (low risk)",
        "Score 91. Forwarded to Media Manager.",
        "2026-08-16T09:13:40.000Z",
      ),
      makeLog(
        "media",
        "schedule",
        "Adapted and published",
        "Instagram, web, email, in-store signage. Posting times from student behaviour.",
        "2026-08-18T07:40:00.000Z",
      ),
      makeLog(
        "media",
        "feedback",
        "Results returned to Trend Analyser",
        "4.8% CTR. Commuting angle wins. Next outerwear brief should keep it.",
        "2026-08-23T18:00:00.000Z",
      ),
    ],
    founderDecision: {
      action: "approve",
      note: "Ship variant A as hero. Keep B for email.",
      at: "2026-08-16T10:02:00.000Z",
    },
  };

  const fruit: Campaign = {
    id: "cmp_stonefruit",
    name: "Week 34 catalogue — stone fruit & yoghurt",
    product: "Seasonal stone fruit + Lane & Co. pot-set yoghurt",
    category: "Grocery",
    targetAudience: "Household shoppers, 28–45, inner-city and suburban",
    objective: "Lift weekly catalogue engagement and attach yoghurt to fruit baskets",
    budget: 9000,
    channels: ["print", "email", "web", "instagram"],
    startDate: "2026-08-26",
    endDate: "2026-09-01",
    country: "AU",
    notes: "Catalogue cover + social. Keep it edible, not wellness-cult.",
    status: "awaiting_approval",
    createdAt: "2026-08-23T04:10:00.000Z",
    updatedAt: "2026-08-23T04:18:00.000Z",
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
      product: "Seasonal stone fruit + Lane & Co. pot-set yoghurt",
      audience: "Household shoppers, 28–45, inner-city and suburban",
      objective: "Lift weekly catalogue engagement and attach yoghurt to fruit baskets",
      country: "AU",
      brandTone: brand.tone,
      approvedClaims: ["In season this week", "Pot-set yoghurt", "Australian grown where labelled"],
      previousPerformanceNote:
        "Trail Parka: commuting angle beat fashion framing. Shoppers respond to specific, honest use-cases.",
      founderNotes: ["Keep it edible, not wellness-cult."],
    },
    trends: [
      {
        id: "tr_f1",
        topic: "Stone fruit arriving a week early",
        evidence:
          "Buyer notes: yellow peaches and plums landing 6 days ahead of last year. POS on early trays already +22% vs LY.",
        source: "Buyer + POS",
        relevance: 93,
        confidence: 86,
      },
      {
        id: "tr_f2",
        topic: "Breakfast bundles beat single-SKU shouts",
        evidence:
          "Last three catalogues: fruit+dairy pairs outsold hero-fruit-only covers on attach rate.",
        source: "Catalogue history",
        relevance: 88,
        confidence: 83,
      },
      {
        id: "tr_f3",
        topic: "Wellness language is fatigued",
        evidence:
          "Social comments on competitor 'healthiest breakfast' ads: sarcasm, not saves. Brand banned-terms already include 'healthiest'.",
        source: "Social + brand rules",
        relevance: 80,
        confidence: 90,
      },
    ],
    opportunities: [
      {
        id: "op_f1",
        title: "This week's fruit, this week's breakfast",
        why: "Timeliness is the catalogue's actual job. Pairing yoghurt is a basket-build, not a health claim.",
        audienceFit: 92,
        expectedValue: "High for week-34 cover and email.",
        rank: 1,
      },
    ],
    personas: [
      {
        id: "ps_f1",
        name: "Priya, Thursday shopper",
        age: "36, Parramatta",
        summary:
          "Shops after school pickup. Skims the catalogue on the app, buys what looks ripe, not what looks 'wellness'.",
        channels: ["Email", "print catalogue", "Instagram"],
        motivations: ["Ripeness", "Price clarity", "One good breakfast idea"],
      },
    ],
    brief: {
      product: "Seasonal stone fruit + Lane & Co. pot-set yoghurt",
      angle: "This week's fruit. This week's breakfast. No wellness sermon.",
      audience: "Household shoppers, 28–45",
      channels: ["print", "email", "web", "instagram"],
      keyMessage: "Peaches are in. Yoghurt is waiting.",
      claimsAllowed: ["In season this week", "Pot-set", "Australian grown where labelled"],
      claimsAvoid: ["Australia's healthiest breakfast", "Guaranteed ripe", "Superfood"],
      visualDirection: "Olive and cream produce still-life. Type like a market chalkboard, not a supplement brand.",
    },
    creatives: [
      {
        id: "cr_fruit_a",
        variant: "A",
        version: 2,
        kicker: "Week 34 · Catalogue",
        headline: "Peaches are in. Yoghurt is waiting.",
        subhead: "Stone fruit, in season this week. Lane & Co. pot-set yoghurt on the next shelf.",
        cta: "Open this week's catalogue",
        caption:
          "Yellow peaches and plums, in season. Pair with pot-set yoghurt. Week 34 at Lane & Co.",
        palette: {
          bg: "#3d4f2f",
          fg: "#f6f1e4",
          accent: "#e8c56b",
          muted: "#c5d0b4",
        },
        motif: "produce",
        status: "flagged",
        prompt: "Still-life peaches on olive ground, cream serif, catalogue week mark.",
        generation: stubGenerate(
          {
            kind: "image",
            modelId: "ideogram:v4-quality",
            prompt: "Still-life peaches on olive ground, cream serif, catalogue week mark.",
            aspectRatio: "4:5",
          },
          "Seeded studio take",
        ),
      },
      {
        id: "cr_fruit_b",
        variant: "B",
        version: 2,
        kicker: "Week 34",
        headline: "Breakfast is a peach.",
        subhead: "In season this week — trays at the front, yoghurt beside.",
        cta: "See specials",
        caption: "Stone fruit is in. Catalogue week 34.",
        palette: {
          bg: "#f3eee5",
          fg: "#2b2118",
          accent: "#c4342a",
          muted: "#7a6a58",
        },
        motif: "editorial",
        status: "flagged",
        prompt: "Paper catalogue cover, fruit illustration, generous margin.",
        generation: stubGenerate(
          {
            kind: "image",
            modelId: "google:imagen-4",
            prompt: "Paper catalogue cover, fruit illustration, generous margin.",
            aspectRatio: "4:5",
          },
          "Seeded studio take",
        ),
      },
    ],
    complianceReports: [
      {
        id: "cp_fruit_1",
        creativeId: "cr_fruit_a",
        version: 1,
        risk: "high",
        score: 34,
        verdict: "revise",
        summary: "v1 used 'Australia's healthiest breakfast'. Returned to creative.",
        findings: [
          {
            id: "ff1",
            severity: "high",
            type: "Health / superiority",
            excerpt: "Australia's healthiest breakfast",
            explanation:
              "Health superlatives require substantiation we do not have. Also on the brand banned-terms list.",
            rule: "AU · ACL + brand banned terms",
          },
        ],
        countryProfile: "AU",
      },
      {
        id: "cp_fruit_2",
        creativeId: "cr_fruit_a",
        version: 2,
        risk: "medium",
        score: 62,
        verdict: "escalate",
        summary:
          "Health claim removed. Remaining issue: implied everyday pricing on catalogue cover without a condition line. Escalating to the founder — promotional catalogues are high-visibility.",
        findings: [
          {
            id: "ff2",
            severity: "medium",
            type: "Promotional completeness",
            excerpt: "Catalogue cover with product pairing, no 'see in-store for price' line",
            explanation:
              "Week-34 specials are region-specific. Cover should not imply a national price. Founder to confirm the condition line before print lock.",
            rule: "AU · ACL + Lane & Co. catalogue policy",
          },
        ],
        countryProfile: "AU",
      },
    ],
    adaptations: [],
    schedule: [],
    performance: null,
    log: [
      makeLog(
        "founder",
        "decision",
        "Campaign created",
        "Week 34 catalogue — stone fruit & yoghurt.",
        "2026-08-23T04:10:00.000Z",
      ),
      makeLog(
        "trend",
        "insight",
        "Used prior campaign feedback",
        "Parka results: specific honest use-cases outperform swagger. Applied to breakfast pairing.",
        "2026-08-23T04:11:00.000Z",
      ),
      makeLog(
        "trend",
        "output",
        "Brief handed to creative",
        "Angle: This week's fruit. This week's breakfast.",
        "2026-08-23T04:12:00.000Z",
      ),
      makeLog(
        "creative",
        "output",
        "v1 generated (2 variants)",
        "Cover lines drafted for print, email, web, Instagram.",
        "2026-08-23T04:13:00.000Z",
      ),
      makeLog(
        "compliance",
        "flag",
        "v1 failed — health superlative",
        "Returned to Image Generation with a structured fix.",
        "2026-08-23T04:14:00.000Z",
      ),
      makeLog(
        "creative",
        "revision",
        "v2 — health claim removed",
        "Now: 'Peaches are in. Yoghurt is waiting.'",
        "2026-08-23T04:16:00.000Z",
      ),
      makeLog(
        "compliance",
        "escalation",
        "Medium risk — founder required",
        "Print lock needs a regional price condition line. Cannot auto-publish a catalogue cover.",
        "2026-08-23T04:18:00.000Z",
      ),
    ],
    founderDecision: null,
  };

  return [fruit, parka];
}
