import type { Campaign, CampaignBrief, Creative } from "@/lib/types";

export function fallbackBrief(campaign: Campaign): CampaignBrief {
  return {
    product: campaign.product,
    angle: campaign.objective,
    audience: campaign.targetAudience,
    channels: campaign.channels,
    keyMessage: campaign.product,
    claimsAllowed: campaign.sharedContext.approvedClaims,
    claimsAvoid: [],
    visualDirection: campaign.sharedContext.brandTone,
  };
}

export function posterPrompt(campaign: Campaign, creative: Creative) {
  return [
    "Retail advertising poster, 4:5, print quality.",
    `Brand: ${campaign.sharedContext.retailer}.`,
    `Product: ${campaign.product}.`,
    `Headline: ${creative.headline}.`,
    creative.subhead,
    campaign.brief?.visualDirection ?? campaign.sharedContext.brandTone,
    "No competitor logos. Honest product, not stock-smile families.",
  ].join(" ");
}

export function videoPrompt(campaign: Campaign, durationSec: number) {
  const hero = campaign.creatives[0];
  return [
    `${durationSec}-second retail ad.`,
    `Product: ${campaign.product}.`,
    `Line: ${hero?.headline ?? campaign.brief?.keyMessage ?? campaign.objective}.`,
    `Audience: ${campaign.targetAudience}.`,
    "No unsubstantiated claims. End on pack shot.",
  ].join(" ");
}
