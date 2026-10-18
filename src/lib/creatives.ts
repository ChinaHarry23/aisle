import { uid } from "./ids";
import type { Campaign, CampaignBrief, Creative } from "./types";

function pack(campaign: Campaign) {
  const t = `${campaign.product} ${campaign.name} ${campaign.category} ${campaign.targetAudience}`.toLowerCase();
  if (/jacket|parka|coat|outerwear|hoodie|knit/.test(t)) return "campus" as const;
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

