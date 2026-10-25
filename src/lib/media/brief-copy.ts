import type { Campaign } from "@/lib/types";

/** The two poster variants the creative step can write without a live model. */
export type BriefCopy = {
  variant: "A" | "B";
  kicker: string;
  headline: string;
  subhead: string;
  cta: string;
  caption: string;
  /** Scene instruction for the image model, taken from this campaign's trend brief. */
  prompt: string;
};

const SUPERLATIVES = [
  "clinically proven",
  "australia's best",
  "number one",
  "risk-free",
  "risk free",
  "healthiest",
  "guaranteed",
  "miracle",
];

function clip(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** Drop banned wording and the stock superlatives that used to be pasted onto every draft. */
function scrubClaims(text: string, banned: string[]) {
  let out = text;
  const terms = [...banned, ...SUPERLATIVES]
    .map((term) => term.trim())
    .filter((term) => term.length > 1)
    .sort((a, b) => b.length - a.length);
  for (const term of terms) {
    out = out.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "");
  }
  return out
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/^[,.;:\s]+|[,;:\s]+$/g, "")
    .trim();
}

function noteTerms(notes: string[]) {
  return notes.flatMap((note) => {
    const quoted = [...note.matchAll(/[“"]([^”"]{2,80})[”"]/g)].map((match) => match[1]);
    const head = note.split(":")[0]?.trim() ?? "";
    return head.length > 1 && head.length <= 48 ? [...quoted, head] : quoted;
  });
}

/**
 * Poster lines and the image prompt, written from the trend brief for this product.
 * Two variants share that brief and differ in which fact they lead with.
 */
export function copyFromBrief(
  campaign: Campaign,
  banned: string[] = [],
  notes: string[] = [],
): Record<"A" | "B", BriefCopy> {
  const brief = campaign.brief;
  const product = campaign.product.trim();
  const short = product.split(/[|(]/)[0].trim() || product;
  const block = [...banned, ...noteTerms(notes), ...(brief?.claimsAvoid ?? [])];
  const claims = (brief?.claimsAllowed ?? [])
    .map((claim) => scrubClaims(claim, block))
    .filter((claim) => claim.length > 1)
    .slice(0, 3);
  const angle = scrubClaims(brief?.angle || campaign.objective, block) || `For ${campaign.targetAudience}.`;
  const rawKey = scrubClaims(brief?.keyMessage || short, block);
  const key = /without the theatre|no theatre/i.test(rawKey) ? short : rawKey || short;
  const visual = scrubClaims(brief?.visualDirection || campaign.sharedContext.brandTone, block);
  const retailer = campaign.sharedContext.retailer;
  const facts = claims.length
    ? `Facts from the trend brief that may be shown: ${claims.join("; ")}.`
    : "Show no product claim beyond the lines of type.";

  const scene = (headline: string) =>
    [
      `This advertisement is only about ${product}.`,
      `Audience: ${campaign.targetAudience}.`,
      `Angle from the trend brief: ${angle}.`,
      visual ? `Visual direction from the trend brief: ${visual}.` : "",
      facts,
      "Depict that angle for this product. Do not replace it with a generic category scene.",
      `The only headline to set in type is: ${headline}.`,
    ]
      .filter(Boolean)
      .join(" ");

  const claimA = claims[0];
  const claimB = claims[1] ?? claims[0];
  const headlineA = clip(key, 90);
  const headlineB = clip(key.toLowerCase() === short.toLowerCase() ? claimA || angle : short, 90);
  const subheadA = clip(
    claimA && !angle.toLowerCase().includes(claimA.toLowerCase()) ? `${angle} ${claimA}.` : angle,
    160,
  );
  const subheadB = clip(claimB ? `${claimB}. ${angle}` : angle, 160);

  return {
    A: {
      variant: "A",
      kicker: clip(campaign.category, 40),
      headline: headlineA,
      subhead: subheadA,
      cta: campaign.channels.includes("print") ? "See it in store" : "See the offer",
      caption: clip([short, claimA, retailer].filter(Boolean).join(". "), 200),
      prompt: scene(headlineA),
    },
    B: {
      variant: "B",
      kicker: clip(campaign.category, 40),
      headline: headlineB,
      subhead: subheadB,
      cta: "Shop",
      caption: clip(`${angle} ${retailer}.`, 200),
      prompt: scene(headlineB),
    },
  };
}
