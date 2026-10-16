import { uid, sleep, formatUsd, formatNumber } from "./ids";
import { requestComplete } from "./llm/client";
import { getLlmOrDefault } from "./llm/catalog";
import type { AgentSlot } from "./llm/types";
import { requestGenerate } from "./media/client";
import { posterPrompt } from "./media/prompts";
import { makeLog } from "./seed";
import type { WorkspaceSettings } from "./settings";
import type {
  BrandProfile,
  Campaign,
  CampaignBrief,
  Channel,
  ChannelAdaptation,
  ComplianceFinding,
  ComplianceReport,
  Creative,
  Opportunity,
  Persona,
  ScheduleItem,
  Trend,
} from "./types";

export type EngineApi = {
  read: (id: string) => Campaign | undefined;
  brand: () => BrandProfile;
  settings: () => WorkspaceSettings;
  patch: (id: string, partial: Partial<Campaign>) => void;
  log: (id: string, event: ReturnType<typeof makeLog>) => void;
  still: (id: string, token: number) => boolean;
};

async function noteBackend(id: string, api: EngineApi, agent: AgentSlot, task: string, prompt: string) {
  const settings = api.settings();
  const assignment = settings.agents[agent];
  const model = getLlmOrDefault(assignment.modelId);
  const result = await requestComplete({
    agent,
    modelId: assignment.modelId,
    prompt,
    localBaseUrl: settings.localBaseUrl,
    localModel: settings.localModel,
  });
  const liveBit = result.text ? ` · model returned ${result.text.length} chars` : "";
  api.log(
    id,
    makeLog(
      agent,
      "insight",
      `${task} · ${model.name}`,
      `${model.provider} · ${result.status} · est. ${formatUsd(result.usage.costUsd)} · ${formatNumber(result.usage.totalTokens)} tokens${liveBit}. ${result.note}`,
    ),
  );
  return result;
}

const STEP = 720;

function pack(campaign: Campaign) {
  const t = `${campaign.product} ${campaign.name} ${campaign.category} ${campaign.targetAudience}`.toLowerCase();
  if (/jacket|parka|coat|outerwear|hoodie|apparel|knit/.test(t)) return "campus" as const;
  if (/fruit|yoghurt|yogurt|grocery|produce|catalogue|peach|plum|veg|milk/.test(t))
    return "produce" as const;
  if (/coffee|bean|pantry|chocolate/.test(t)) return "pantry" as const;
  return "editorial" as const;
}

function palettes(motif: Creative["motif"]) {
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

function buildResearch(campaign: Campaign, brand: BrandProfile) {
  const motif = pack(campaign);
  const prior = campaign.sharedContext.previousPerformanceNote;
  const product = campaign.product;
  const audience = campaign.targetAudience;

  const trends: Trend[] =
    motif === "campus"
      ? [
          {
            id: uid("tr"),
            topic: "Commuter weather, not expedition gear",
            evidence: `POS near campuses is lifting for ${product}. Search clusters around rain, lectures, and 'actual warm' — not hiking.`,
            source: "POS + internal search",
            relevance: 94,
            confidence: 86,
          },
          {
            id: uid("tr"),
            topic: "Quiet utility is outperforming logo-forward puffers",
            evidence: "Social comments reward garments that look considered, not costumed. Outdoor-brand heroics are being mocked, not saved.",
            source: "Social listening",
            relevance: 82,
            confidence: 77,
          },
          {
            id: uid("tr"),
            topic: "Late-winter newness vs clearance",
            evidence: `${brand.retailerName} seasonal cycle still has a newness window before markdown week. This is a drop, not a sale.`,
            source: "Seasonal calendar",
            relevance: 80,
            confidence: 90,
          },
        ]
        : motif === "produce"
        ? [
            {
              id: uid("tr"),
              topic: `${campaign.product} is a cycle-worthy seasonal`,
              evidence: `Buyer notes and POS show ${product} moving this week. Catalogue covers that name the product outperform generic 'fresh' lines.`,
              source: "Buyer + POS",
              relevance: 93,
              confidence: 85,
            },
            {
              id: uid("tr"),
              topic: "Basket-build pairs beat single-SKU shouts",
              evidence: "Recent catalogues: pairing a dairy or pantry item with hero produce lifts attach rate.",
              source: "Catalogue history",
              relevance: 87,
              confidence: 81,
            },
            {
              id: uid("tr"),
              topic: "Wellness superlatives are fatigued",
              evidence: "Competitor 'healthiest' ads draw sarcasm. Banned-terms list already blocks this language.",
              source: "Social + brand rules",
              relevance: 79,
              confidence: 89,
            },
          ]
        : [
            {
              id: uid("tr"),
              topic: `Demand signal around ${product}`,
              evidence: `Sales patterns and seasonal cadence suggest ${product} is worth a cycle for ${audience}.`,
              source: "POS + seasonal cycle",
              relevance: 86,
              confidence: 74,
            },
            {
              id: uid("tr"),
              topic: "Channel attention is fragmented",
              evidence: "Same offer needs a short social hook, a website proof stack, and a quieter email.",
              source: "Channel mix",
              relevance: 78,
              confidence: 80,
            },
            {
              id: uid("tr"),
              topic: "Honesty is the available gap",
              evidence: "Competitor ads in this category still lead with unsubstantiated superlatives. Brand rules forbid following them.",
              source: "Competitor scan",
              relevance: 81,
              confidence: 76,
            },
          ];

  if (prior) {
    trends.unshift({
      id: uid("tr"),
      topic: "Prior campaign feedback",
      evidence: prior,
      source: "Media Manager → Trend Analyser loop",
      relevance: 90,
      confidence: 92,
    });
  }

  const opportunities: Opportunity[] =
    motif === "campus"
      ? [
          {
            id: uid("op"),
            title: "Weatherproof, not wilderness",
            why: `${audience} buy for the walk between buildings. Competitors still sell summits. That gap is the brief.`,
            audienceFit: 94,
            expectedValue: "High — in-season, unoccupied angle.",
            rank: 1,
          },
          {
            id: uid("op"),
            title: "Packable as the proof, not the headline",
            why: "A true product fact that maps to bag-space anxiety. Supporting point, not the hero.",
            audienceFit: 84,
            expectedValue: "Medium",
            rank: 2,
          },
        ]
      : motif === "produce"
        ? [
            {
              id: uid("op"),
              title: "This week's fruit, this week's breakfast",
              why: "Timeliness is the catalogue's job. Pairing is a basket-build, not a health claim.",
              audienceFit: 92,
              expectedValue: "High for cover + email.",
              rank: 1,
            },
            {
              id: uid("op"),
              title: "Name the variety, skip the sermon",
              why: `${audience} skim. Specific produce names outperform 'freshness' as a vibe.`,
              audienceFit: 85,
              expectedValue: "Medium",
              rank: 2,
            },
          ]
        : [
            {
              id: uid("op"),
              title: `A specific use-case for ${product}`,
              why: `Tie ${product} to one honest job-to-be-done for ${audience}, then prove it with allowed claims.`,
              audienceFit: 88,
              expectedValue: "High if the claim stays factual.",
              rank: 1,
            },
            {
              id: uid("op"),
              title: "Quiet proof over swagger",
              why: "Brand tone forbids shouty superlatives. The opportunity is sounding like the shop, not a holding company.",
              audienceFit: 80,
              expectedValue: "Medium — brand-safe, distinctive.",
              rank: 2,
            },
          ];

  const personas: Persona[] =
    motif === "campus"
      ? [
          {
            id: uid("ps"),
            name: "Mina, second-year arts",
            age: "20",
            summary: `Walks to campus. Buys two considered pieces a season. Is the centre of ${audience}.`,
            channels: ["Instagram Stories", "email", "in-store"],
            motivations: ["Looks considered", "Handles rain", "Not a costume"],
          },
          {
            id: uid("ps"),
            name: "Jonah, engineering",
            age: "22",
            summary: "One jacket from lab to pub. Sceptical of performance copy.",
            channels: ["Instagram", "website", "signage"],
            motivations: ["Warmth", "Price honesty", "No gearhead jargon"],
          },
        ]
      : [
          {
            id: uid("ps"),
            name: "Priya, Thursday shopper",
            age: "36",
            summary: `Skims ${brand.retailerName} catalogue on the app. Buys what looks useful this week.`,
            channels: ["Email", "print", "Instagram"],
            motivations: ["Clarity", "Timing", "One good idea"],
          },
          {
            id: uid("ps"),
            name: "Tom, after-work basket",
            age: "41",
            summary: "Shops once, hates being preached at. Responds to specifics.",
            channels: ["Web", "email", "in-store signage"],
            motivations: ["Speed", "Fair price", "No wellness cult"],
          },
        ];

  const brief: CampaignBrief =
    motif === "campus"
      ? {
          product,
          angle: "Campus weather, not wilderness.",
          audience,
          channels: campaign.channels,
          keyMessage: "Weatherproof. Not wilderness.",
          claimsAllowed: ["Water-resistant shell", "Packs into its own pocket", "Cut for commuting"],
          claimsAvoid: ["Warmest in Australia", "Guaranteed dry", "Expedition-grade"],
          visualDirection: "Navy, cream type, signal red. Urban rain, not alpine peaks.",
        }
        : motif === "produce"
        ? {
            product,
            angle: `This week's ${product}. No wellness sermon.`,
            audience,
            channels: campaign.channels,
            keyMessage: `${product.split(/[+—]/)[0].trim()} is in this week.`,
            claimsAllowed: ["In season this week", "Australian grown where labelled", "Available in store"],
            claimsAvoid: ["Healthiest breakfast", "Superfood", "Guaranteed ripe"],
            visualDirection: "Olive still-life, cream paper, market type.",
          }
        : {
            product,
            angle: `One honest job ${product} does for ${audience}.`,
            audience,
            channels: campaign.channels,
            keyMessage: `${product}, without the theatre.`,
            claimsAllowed: [...brand.approvedTerms.slice(0, 3), "Available this cycle"],
            claimsAvoid: [...brand.bannedTerms.slice(0, 4)],
            visualDirection: brand.visualStyle,
          };

  return { trends, opportunities, personas, brief, motif };
}

function v1Copy(campaign: Campaign, motif: Creative["motif"]) {
  if (motif === "campus") {
    return {
      A: {
        kicker: "Northline · Winter 26",
        headline: "The warmest jacket in Australia",
        subhead: `Guaranteed dry through ${campaign.targetAudience.split(",")[0].toLowerCase()} weather.`,
        cta: "Shop the parka",
        caption: `New ${campaign.product}. The warmest jacket in Australia — guaranteed.`,
      },
      B: {
        kicker: "Drop",
        headline: "Winter, but make it campus.",
        subhead: "Australia's number one uni jacket. Risk-free warmth.",
        cta: "See the drop",
        caption: `${campaign.product} — number one on campus.`,
      },
    };
  }
  if (motif === "produce") {
    return {
      A: {
        kicker: "Week 34 · Catalogue",
        headline: "Australia's healthiest breakfast",
        subhead: "Clinically proven goodness. Stone fruit + yoghurt, guaranteed ripe.",
        cta: "Open the catalogue",
        caption: "Australia's healthiest breakfast, only at Lane & Co.",
      },
      B: {
        kicker: "Catalogue",
        headline: "Miracle mornings",
        subhead: "The healthiest shop in the neighbourhood.",
        cta: "See specials",
        caption: "Miracle produce, week 34.",
      },
    };
  }
  return {
    A: {
      kicker: campaign.category,
      headline: `Australia's best ${campaign.product}`,
      subhead: "Guaranteed results. Number one in its class.",
      cta: "Shop now",
      caption: `${campaign.product} — Australia's best. Guaranteed.`,
    },
    B: {
      kicker: campaign.category,
      headline: `${campaign.product}, miracle edition`,
      subhead: "Risk-free. Clinically proven. The healthiest choice.",
      cta: "Get it",
      caption: `Don't miss ${campaign.product}.`,
    },
  };
}

function v2Copy(campaign: Campaign, motif: Creative["motif"], brief: CampaignBrief) {
  if (motif === "campus") {
    return {
      A: {
        kicker: "Northline · Winter 26",
        headline: "Weatherproof. Not wilderness.",
        subhead: `The ${campaign.product}. Cut for 8am lectures and 6pm southerlies.`,
        cta: "Shop the parka",
        caption: `${campaign.product}. Water-resistant shell, packs into its pocket. Made for campus weather — Lane & Co.`,
      },
      B: {
        kicker: "Campus drop",
        headline: "Winter, but make it campus.",
        subhead: "Warmth that fits in a bag. No summit required.",
        cta: "See the drop",
        caption: `${campaign.product} — packable, water-resistant, priced like a neighbourhood shop.`,
      },
    };
  }
  if (motif === "produce") {
    const hero = campaign.product.split(/[+—]/)[0].trim();
    return {
      A: {
        kicker: "This week's catalogue",
        headline: `${hero} is in.`,
        subhead: `In season this week. ${campaign.product}.`,
        cta: "Open this week's catalogue",
        caption: `${campaign.product}. In season this week at Lane & Co.`,
      },
      B: {
        kicker: "Weekly",
        headline: `Make a week of ${hero.toLowerCase()}.`,
        subhead: "In season this week — trays at the front.",
        cta: "See specials",
        caption: `${campaign.product}. Catalogue this week.`,
      },
    };
  }
  return {
    A: {
      kicker: campaign.category,
      headline: brief.keyMessage,
      subhead: `${campaign.product} for ${campaign.targetAudience}. ${brief.angle}`,
      cta: "See the offer",
      caption: `${campaign.product} — ${brief.angle} Lane & Co.`,
    },
    B: {
      kicker: campaign.category,
      headline: campaign.product,
      subhead: brief.angle,
      cta: "Shop",
      caption: `${campaign.product}. ${brief.claimsAllowed[0] ?? ""}`.trim(),
    },
  };
}

export function makeCreatives(
  campaign: Campaign,
  brief: CampaignBrief,
  version: number,
): Creative[] {
  const motif = pack(campaign);
  const pal = palettes(motif);
  const copy = version === 1 ? v1Copy(campaign, motif) : v2Copy(campaign, motif, brief);
  const status = version === 1 ? "draft" : "revised";
  return (["A", "B"] as const).map((variant) => ({
    id: uid("cr"),
    variant,
    version,
    ...copy[variant],
    palette: pal[variant],
    motif,
    status,
    prompt: `${brief.visualDirection} Headline: ${copy[variant].headline}. Product: ${campaign.product}. Brand: Lane & Co.`,
  }));
}

function reviewCreatives(
  campaign: Campaign,
  brand: BrandProfile,
  creatives: Creative[],
): ComplianceReport[] {
  const banned = brand.bannedTerms.map((t) => t.toLowerCase());
  const country = campaign.country;
  const profile = `${country} · ${brand.countryRules[country].slice(0, 140)}…`;

  return creatives.map((creative) => {
    const blob = `${creative.headline} ${creative.subhead} ${creative.caption}`.toLowerCase();
    const findings: ComplianceFinding[] = banned
      .filter((term) => blob.includes(term.toLowerCase()))
      .map((term) => ({
        id: uid("f"),
        severity: "high",
        type: "Banned or unsubstantiated claim",
        excerpt: term,
        explanation: `“${term}” is on the brand banned list and fails ${country} advertising standards without a substantiation file we do not have.`,
        rule: `${country} · ${term}`,
      }));

    if (campaign.channels.includes("print") && creative.version >= 2 && !findings.some((f) => f.severity === "high")) {
      findings.push({
        id: uid("f"),
        severity: "medium",
        type: "Promotional completeness",
        excerpt: "Catalogue / print lock without a regional condition line",
        explanation:
          "Print is high-visibility and region-specific pricing may apply. Founder should confirm the condition line before lock.",
        rule: `${country} · catalogue policy`,
      });
    }

    if (
      campaign.budget >= 10000 &&
      creative.version >= 2 &&
      !findings.some((f) => f.severity === "high")
    ) {
      findings.push({
        id: uid("f"),
        severity: "medium",
        type: "Spend / reach",
        excerpt: `Budget ${campaign.budget.toLocaleString("en-AU")} above the auto-publish threshold`,
        explanation:
          "High-spend or youth-reach campaigns are founder decisions even when the copy is clean. Approve, reject, or send back.",
        rule: `${country} · founder threshold`,
      });
    }

    const high = findings.some((f) => f.severity === "high");
    const medium = findings.some((f) => f.severity === "medium");
    const risk = high ? "high" : medium ? "medium" : "low";
    const verdict = high ? "revise" : medium ? "escalate" : "pass";
    const score = high ? 34 + creative.version * 4 : medium ? 62 : 90 + creative.version;

    return {
      id: uid("cp"),
      creativeId: creative.id,
      version: creative.version,
      risk,
      score: Math.min(score, 96),
      verdict,
      summary: high
        ? `v${creative.version} uses claims we cannot support. Structured feedback goes back to Image Generation.`
        : medium
          ? `Fixable legal language is clean, but residual promotional risk needs the founder before distribution.`
          : `v${creative.version} uses allowed product facts. Brand tone holds. Cleared to Media Manager.`,
      findings,
      countryProfile: profile,
    } satisfies ComplianceReport;
  });
}

function postingTime(channel: Channel, country: Campaign["country"]) {
  const tz = country === "US" ? "local retail" : "AEST";
  const table: Record<Channel, { time: string; reason: string }> = {
    instagram: {
      time: `Tue 11:40 ${tz}`,
      reason: "Stories and feed peak late morning on teaching / mid-week shop days.",
    },
    web: {
      time: `Tue 07:00 ${tz}`,
      reason: "Homepage refresh before commute and school-run traffic.",
    },
    email: {
      time: `Tue 16:35 ${tz}`,
      reason: "Inboxes open after work and last lecture, before dinner.",
    },
    print: {
      time: "Catalogue drop Wednesday",
      reason: "In-store dwell is highest mid-week; avoid clashing with the prior circular.",
    },
    digital_signage: {
      time: "Always-on for campaign dates",
      reason: "Loop during high-dwell: lecture changeover and Thursday evening shop.",
    },
  };
  return table[channel];
}

function adapt(campaign: Campaign, creative: Creative): ChannelAdaptation[] {
  return campaign.channels.map((channel) => {
    const post = postingTime(channel, campaign.country);
    const bodies: Record<Channel, string> = {
      instagram: `${creative.headline} ${creative.subhead}`.slice(0, 180),
      web: `${creative.subhead} ${creative.caption}`,
        email: `${creative.subhead} 14-day returns. ${campaign.sharedContext.retailer}`,
      print: `${creative.headline} ${creative.subhead} See in-store for regional prices.`,
      digital_signage: `${creative.headline} · In store`,
    };
    const specs: Record<Channel, string> = {
      instagram: "1:1 and 4:5, hook in first line, ≤3 hashtags.",
      web: "1440×520 hero, 6-word headline, proof bullets.",
      email: "600px, headline + ~70 words, single CTA.",
      print: "A4 cover, condition line required, 3-metre readable kicker.",
      digital_signage: "9:16 portrait, 6 words, high contrast.",
    };
    return {
      channel,
      headline:
        channel === "email" ? creative.subhead : creative.headline,
      body: bodies[channel],
      specs: specs[channel],
      postingTime: post.time,
      postingReason: post.reason,
    };
  });
}

function buildSchedule(campaign: Campaign): ScheduleItem[] {
  const start = new Date(`${campaign.startDate}T07:00:00`);
  return campaign.channels.map((channel, i) => {
    const at = new Date(start.getTime() + i * 90 * 60 * 1000).toISOString();
    return {
      id: uid("sch"),
      channel,
      at,
      status: "scheduled" as const,
      note: `Queued after founder approval · ${postingTime(channel, campaign.country).time}`,
    };
  });
}

export async function runFromTrend(id: string, token: number, api: EngineApi) {
  const c0 = api.read(id);
  if (!c0 || !api.still(id, token)) return;
  const brand = api.brand();

  api.patch(id, { status: "analysing", running: true });
  api.log(id, makeLog("trend", "handoff", "Received campaign task", "Shared context loaded: product, audience, market, brand tone, prior performance."));
  await noteBackend(
    id,
    api,
    "trend",
    "Reasoning backend",
    `Analyse demand for ${c0.product} aimed at ${c0.targetAudience} in ${c0.country}. Objective: ${c0.objective}. Brand: ${brand.retailerName}. Tone: ${brand.tone}. Return JSON trends, opportunities, personas, brief.`,
  );
  await sleep(STEP);
  if (!api.still(id, token)) return;

  api.log(
    id,
    makeLog(
      "trend",
      "insight",
      "Scanning POS, seasonal cycle, social",
      `Looking at ${c0.product} against ${c0.country} shopper behaviour this cycle.`,
    ),
  );
  await sleep(STEP);
  if (!api.still(id, token)) return;

  if (c0.sharedContext.previousPerformanceNote) {
    api.log(
      id,
      makeLog(
        "trend",
        "feedback",
        "Prior results folded into this brief",
        c0.sharedContext.previousPerformanceNote,
      ),
    );
    await sleep(STEP);
    if (!api.still(id, token)) return;
  }

  const research = buildResearch(c0, brand);
  api.patch(id, {
    trends: research.trends,
    opportunities: research.opportunities,
    personas: research.personas,
    brief: research.brief,
    sharedContext: {
      ...c0.sharedContext,
      approvedClaims: research.brief.claimsAllowed,
    },
    updatedAt: new Date().toISOString(),
  });
  api.log(
    id,
    makeLog(
      "trend",
      "output",
      "Brief handed to Image Generation",
      `${research.brief.angle} Personas and ranked opportunities attached.`,
    ),
  );
  await sleep(STEP);
  if (!api.still(id, token)) return;
  await runCreative(id, token, api, 1);
}

export async function runCreative(
  id: string,
  token: number,
  api: EngineApi,
  version: number,
) {
  const c = api.read(id);
  if (!c?.brief || !api.still(id, token)) return;
  api.patch(id, { status: version === 1 ? "generating" : "revising", running: true });
  api.log(
    id,
    makeLog(
      "creative",
      version === 1 ? "handoff" : "revision",
      version === 1 ? "Received campaign brief" : "Revising from compliance notes",
      version === 1
        ? "Generating two variants (A/B) under brand guidelines."
        : "Removing unsupported claims. Keeping the angle, changing the proof.",
    ),
  );
  await noteBackend(
    id,
    api,
    "creative",
    "Copy backend",
    `Write two poster variants for ${c.product}. Brief: ${c.brief.angle}. Key message: ${c.brief.keyMessage}. Avoid: ${c.brief.claimsAvoid.join(", ")}. Visual: ${c.brief.visualDirection}.`,
  );
  await sleep(STEP + 200);
  if (!api.still(id, token)) return;

  const creatives = makeCreatives(c, c.brief, version);
  const modelId = api.settings().imageModelId;
  const withGen = [];
  for (const cr of creatives) {
    const generation = await requestGenerate({
      kind: "image",
      modelId,
      prompt: posterPrompt(c, cr),
      aspectRatio: "4:5",
    });
    withGen.push({ ...cr, generation });
  }
  const cost = withGen.reduce((n, cr) => n + (cr.generation?.usage.costUsd ?? 0), 0);
  const tokens = withGen.reduce((n, cr) => n + (cr.generation?.usage.totalTokens ?? 0), 0);
  api.patch(id, {
    creatives: withGen,
    imageModelId: modelId,
    revisionCount: version - 1,
    studioHistory: [
      ...(c.studioHistory ?? []),
      {
        id: uid("run"),
        at: new Date().toISOString(),
        kind: "image",
        modelId,
        label: `v${version} posters`,
        costUsd: cost,
        totalTokens: tokens,
      },
    ],
    updatedAt: new Date().toISOString(),
  });
  api.log(
    id,
    makeLog(
      "creative",
      "output",
      `v${version} generated — variants A and B`,
      `${withGen.map((cr) => `${cr.variant}: “${cr.headline}”`).join(" · ")} · ${modelId} · est. $${cost.toFixed(3)}`,
    ),
  );
  await sleep(STEP);
  if (!api.still(id, token)) return;
  await runCompliance(id, token, api);
}

export async function runCompliance(id: string, token: number, api: EngineApi) {
  const c = api.read(id);
  if (!c || !api.still(id, token)) return;
  const brand = api.brand();
  api.patch(id, { status: "compliance", running: true });
  api.log(
    id,
    makeLog(
      "compliance",
      "handoff",
      `Reviewing v${c.creatives[0]?.version ?? 1} against ${c.country} rules`,
      brand.countryRules[c.country],
    ),
  );
  await noteBackend(
    id,
    api,
    "compliance",
    "Review backend",
    `Review this copy for ${c.country} advertising law. Banned: ${brand.bannedTerms.join(", ")}. Copy: ${c.creatives.map((cr) => `${cr.headline} ${cr.subhead}`).join(" | ")}`,
  );
  await sleep(STEP);
  if (!api.still(id, token)) return;

  const reports = reviewCreatives(c, brand, c.creatives);
  const worst = reports.reduce((a, b) => (a.score < b.score ? a : b));
  api.patch(id, {
    complianceReports: [...c.complianceReports, ...reports],
    creatives: c.creatives.map((cr) => ({
      ...cr,
      status: worst.verdict === "pass" ? "draft" : "flagged",
    })),
    updatedAt: new Date().toISOString(),
  });

  if (worst.verdict === "revise") {
    const version = c.creatives[0]?.version ?? 1;
    if (version >= 2) {
      api.log(
        id,
        makeLog(
          "compliance",
          "escalation",
          "Retry limit reached — escalating",
          "Two passes still carry risk. Human Founder must decide.",
        ),
      );
      api.patch(id, { status: "awaiting_approval", running: false });
      return;
    }
    api.log(
      id,
      makeLog(
        "compliance",
        "flag",
        "High-risk claims — sending back to creative",
        worst.findings.map((f) => f.excerpt).join(", ") || worst.summary,
      ),
    );
    await sleep(STEP);
    if (!api.still(id, token)) return;
    await runCreative(id, token, api, version + 1);
    return;
  }

  if (worst.verdict === "escalate") {
    api.log(
      id,
      makeLog(
        "compliance",
        "escalation",
        "Medium risk — founder required",
        worst.summary,
      ),
    );
    api.patch(id, { status: "awaiting_approval", running: false });
    return;
  }

  api.log(
    id,
    makeLog("compliance", "output", "Passed — handing to Media Manager", worst.summary),
  );
  await sleep(STEP);
  if (!api.still(id, token)) return;
  await runMedia(id, token, api);
}

export async function runMedia(id: string, token: number, api: EngineApi) {
  const c = api.read(id);
  if (!c || !api.still(id, token)) return;
  const hero = c.creatives.find((x) => x.variant === "A") ?? c.creatives[0];
  if (!hero) return;

  api.patch(id, { status: "scheduling", running: true });
  api.log(
    id,
    makeLog(
      "media",
      "handoff",
      "Received approved master",
      "Adapting for each selected channel. Original claims and compliance notes stay intact.",
    ),
  );
  await noteBackend(
    id,
    api,
    "media",
    "Distribution backend",
    `Adapt “${hero.headline}” for channels: ${c.channels.join(", ")}. Country ${c.country}. Keep claims intact.`,
  );
  await sleep(STEP);
  if (!api.still(id, token)) return;

  const adaptations = adapt(c, { ...hero, status: "approved" });
  const schedule = buildSchedule(c);
  api.patch(id, {
    adaptations,
    schedule,
    creatives: c.creatives.map((cr) => ({ ...cr, status: "approved" })),
    updatedAt: new Date().toISOString(),
  });
  api.log(
    id,
    makeLog(
      "media",
      "schedule",
      "Channel versions + posting times ready",
      adaptations.map((a) => `${a.channel}: ${a.postingTime}`).join(" · "),
    ),
  );
  api.patch(id, { status: "scheduled", running: false });
}

export function publishCampaign(campaign: Campaign): Partial<Campaign> {
  return {
    status: "published",
    running: false,
    schedule: campaign.schedule.map((s) => ({ ...s, status: "published" })),
    performance: {
      impressions: 128000 + Math.round(campaign.budget * 4),
      clicks: 4200 + Math.round(campaign.budget * 0.12),
      ctr: 3.2,
      engagement: 2.4,
      conversions: 180 + Math.round(campaign.budget * 0.02),
      reach: 64000 + Math.round(campaign.budget * 2),
      byChannel: Object.fromEntries(
        campaign.channels.map((ch) => [
          ch,
          { impressions: 20000, ctr: 2.8, engagement: 2.1 },
        ]),
      ),
      summary: `Early read on ${campaign.name}: the approved angle is holding. No compliance incidents after publish.`,
      recommendation:
        "Feed this result back into the next Trend Analyser brief — keep the factual angle, do not reopen banned claims.",
    },
    updatedAt: new Date().toISOString(),
  };
}
