import type { Campaign, Creative } from "@/lib/types";
import type { GenerateRequest } from "./types";

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

export function posterPrompt(
  campaign: Campaign,
  creative: Creative,
  options?: { correction?: string; editing?: boolean },
) {
  const brief = campaign.brief;
  const scene =
    creative.prompt?.trim() ||
    [
      brief?.angle ? `Angle from the trend brief: ${brief.angle}.` : "",
      brief?.visualDirection ? `Visual direction from the trend brief: ${brief.visualDirection}.` : "",
      `The product is ${campaign.product}.`,
    ]
      .filter(Boolean)
      .join(" ");
  const reference = campaign.productImageUrl
    ? [
        "The attached photo is this product. Keep its shape, colour and markings recognisable.",
        productScene(campaign.product, campaign.category, campaign.notes ?? ""),
        "Do not depict a named real person, and do not replace the product with a different one.",
      ].join(" ")
    : "No product photo was supplied. Illustrate this exact product from the brief, not a generic category scene.";
  const base = [
    "Retail advertisement, 4:5, print quality.",
    reference,
    `Brand: ${campaign.sharedContext.retailer}.`,
    `Product: ${campaign.product}.`,
    scene,
    `Set only these words in type. Headline: “${creative.headline}”.`,
    creative.subhead ? `Supporting line: “${creative.subhead}”.` : "",
    `Call to action: “${creative.cta}”.`,
    "No competitor logos. Do not add a slogan that is not in those lines.",
  ]
    .filter(Boolean)
    .join(" ");
  const correction = options?.correction?.trim();
  if (!correction) return base;
  const lead = options?.editing
    ? "Edit the supplied advertisement. Keep the product, the people, the headline and the layout. Fix only this mistake, and make the action physically possible:"
    : "Draw the advertisement again. Fix this mistake, and make the action physically possible:";
  return [lead, correction, base].join(" ");
}

/** The image request for one poster, including the product photo when the founder uploaded one. */
export function posterRequest(
  campaign: Campaign,
  creative: Creative,
  modelId: string,
  options?: { correction?: string },
): GenerateRequest {
  const reference = campaign.productImageUrl ? [campaign.productImageUrl] : undefined;
  return {
    kind: "image",
    modelId,
    prompt: posterPrompt(campaign, creative, { correction: options?.correction }),
    aspectRatio: "4:5",
    quality: "medium",
    inputFidelity: reference ? "high" : undefined,
    contextImages: reference,
  };
}
