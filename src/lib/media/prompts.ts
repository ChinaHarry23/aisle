import type { Campaign, CampaignBrief, Creative } from "@/lib/types";

export function fallbackBrief(campaign: Campaign): CampaignBrief {
  return { product: campaign.product, angle: campaign.objective, audience: campaign.targetAudience, channels: campaign.channels, keyMessage: campaign.product, claimsAllowed: campaign.sharedContext.approvedClaims, claimsAvoid: [], visualDirection: campaign.sharedContext.brandTone };
}

/** The creative agent authors the picture. This wrapper sets output conventions, not a scene. */
export function posterPrompt(campaign: Campaign, creative: Creative) {
  if (!creative.prompt.trim()) throw new Error("A creative-agent image prompt is required before rendering.");
  return [
    creative.prompt,
    "Render the background artwork only, portrait 4:5, photographic materials. Leave intentional negative space for separately authored advertising copy.",
    "Do not draw a finished poster, typography, prices, logos or watermarks. Respect the supplied campaign's visual restrictions.",
    campaign.brief?.visualDirection ?? campaign.sharedContext.brandTone,
  ].join("\n");
}
