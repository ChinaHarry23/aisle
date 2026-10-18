import { uid } from "./ids";
import { copyFromBrief } from "./media/brief-copy";
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

export function makeCreatives(
  campaign: Campaign,
  brief: CampaignBrief,
  version: number,
): Creative[] {
  const motif = pack(campaign);
  const pal = palettes(motif);
  const copy = copyFromBrief({ ...campaign, brief }, brief.claimsAvoid);
  const status: Creative["status"] = version === 1 ? "draft" : "revised";
  return (["A", "B"] as const).map((variant) => ({
    id: uid("cr"),
    variant,
    version,
    kicker: copy[variant].kicker,
    headline: copy[variant].headline,
    subhead: copy[variant].subhead,
    cta: copy[variant].cta,
    caption: copy[variant].caption,
    palette: pal[variant],
    motif,
    status,
    prompt: copy[variant].prompt,
  }));
}

