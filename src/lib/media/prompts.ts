import type { Campaign, CampaignBrief, Creative } from "@/lib/types";
import type { GenerateRequest } from "./types";

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

/**
 * The scene that sells this product. The uploaded photo stays the product;
 * the scene is why someone would buy it. Never name a real person.
 */
export function productScene(product: string, category: string, notes = ""): string {
  const text = `${product} ${category} ${notes}`.toLowerCase();
  const shoe = /shoe|sneaker|trainer|jordan|footwear/.test(text) || /\brunning\b/.test(text);
  const basketball = /basket|dunk|court|hoop|nba/.test(text);
  if (shoe && basketball) {
    return "Show this exact shoe on an appealing adult who looks like a professional basketball player, not a named or recognisable real person. They are wearing it while dunking on an indoor court, the ball above the rim. The shoe's shape, colour and markings stay recognisable and clearly visible.";
  }
  if (shoe && /run|jog|marathon|track/.test(text)) {
    return "Show this exact shoe on an appealing adult runner in mid-stride, not a named real person. The shoe's shape, colour and markings stay recognisable.";
  }
  if (shoe) {
    return "Show this exact shoe being worn by an appealing adult athlete in the sport it is made for. A basketball shoe is on someone dunking. The person is not a named real person, and the shoe's shape, colour and markings stay recognisable.";
  }
  if (/juice|drink|soda|coffee|tea|beverage|beer|wine/.test(text)) {
    return "Show an appealing adult enjoying this exact drink in a bright moment that would make someone buy it. Keep the pack's shape, colour and label recognisable. Not a named real person.";
  }
  if (/fruit|vegetable|produce|grocery|snack|chocolate|bread|milk|food|pantry/.test(text)) {
    return "Show this exact product being enjoyed, close enough that the pack or the food itself is recognisable, in the moment someone decides to buy it.";
  }
  return "Show an appealing adult using this exact product in the situation that would make someone buy it. Keep its shape, colour and markings recognisable. The person is not a named real person, and never a child.";
}

export function posterPrompt(campaign: Campaign, creative: Creative) {
  const reference = campaign.productImageUrl
    ? [
        "The attached photo is the product. Keep its shape, colour and markings recognisable.",
        productScene(campaign.product, campaign.category, campaign.notes ?? ""),
        "Do not depict a named real person, and do not replace the product with a different one.",
      ].join(" ")
    : "No product photo was supplied, so illustrate the product honestly from the description.";
  return [
    "Retail advertisement, 4:5, print quality.",
    reference,
    `Brand: ${campaign.sharedContext.retailer}.`,
    `Product: ${campaign.product}.`,
    `Headline: ${creative.headline}.`,
    creative.subhead,
    campaign.brief?.visualDirection ?? campaign.sharedContext.brandTone,
    "No competitor logos. Honest product, not stock-smile families.",
  ].join(" ");
}

/** The image request for one poster, including the product photo when the founder uploaded one. */
export function posterRequest(campaign: Campaign, creative: Creative, modelId: string): GenerateRequest {
  const reference = campaign.productImageUrl ? [campaign.productImageUrl] : undefined;
  return {
    kind: "image",
    modelId,
    prompt: posterPrompt(campaign, creative),
    aspectRatio: "4:5",
    quality: "medium",
    inputFidelity: reference ? "high" : undefined,
    contextImages: reference,
  };
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
