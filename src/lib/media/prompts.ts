import type { Campaign, Creative } from "@/lib/types";
import type { BrandInputs, PaletteRole } from "./brand-inputs";
import type { AspectRatio, GenerateRequest } from "./types";
import { currentStrategy } from "@/lib/trend/strategy";

/** Older runs stored workflow placeholders in the same fields as art direction. */
export function creativeDirectionText(value: string | null | undefined): string {
  const text = value?.trim() ?? "";
  return /^(?:visual direction (?:awaits|unavailable)|report synthesis needs review|campaign direction awaits|no supported (?:theme|market message)|pending\b|awaiting\b)/i.test(text) ? "" : text;
}

/** Keeps room for the headline and call to action, which are set in type, and stops the model crowding the frame. */
const COPY_SPACE =
  "Compose with the product as the clear hero and leave a calm, uncluttered area of the frame for the headline and call to action.";

const PEOPLE =
  "Any person is a natural, relaxed adult with believable proportions, hands and expression, not a named or recognisable real person, and never a child.";

/** Shopper-facing grocery categories, in the order they are tested (the first match wins). */
const SCENES: { match: RegExp; scene: string[] }[] = [
  {
    match: /\b(juice|soft drinks?|soda|cola|water|sparkling|coffee|tea|kombucha|beverages?|drinks?|cordial|energy drinks?)\b/,
    scene: [
      "Show this exact drink ice cold and refreshing, the pack or glass in clear focus with condensation, ice and a fresh slice or sprig that matches the flavour.",
      "Bright natural light, a sunny picnic, patio or kitchen setting, a sense of refreshment.",
      "If a person appears, a happy adult enjoying it, secondary to the drink.",
    ],
  },
  {
    // Before meat and dairy so "ice cream", "cheese pizza" and "frozen chicken nuggets" are frozen foods, not fresh ones.
    match: /\b(frozen|ice ?cream|gelato|pizzas?|dumplings?|ready ?meals?|nuggets?|fries|(?:hot|oven|crinkle[- ]cut) chips|hot ?dogs?)\b/,
    scene: [
      "Show this exact product both in its pack and served hot, golden and ready to eat, as a quick easy dinner or a treat the family shares.",
      "Cosy evening kitchen or relaxed living-room table, warm light, a little steam or cold mist, appetising close-up detail.",
      "If a person appears, a happy adult or adults sharing the meal, secondary to the food.",
    ],
  },
  {
    match: /\b(meat|beef|steak|mince|chicken|lamb|pork|bacon|sausages?|ham|seafood|salmon|prawns?|fish|barramundi)\b/,
    scene: [
      "Show this exact cut or pack looking fresh and appetising, then on the plate or the pan it is destined for: a sizzling barbecue, a family dinner table or a simple weeknight meal.",
      "Rich natural colour and texture, a little steam or herb garnish, warm side light, a slight overhead or three-quarter angle.",
      "If a person appears, only their hands serving or a happy adult at the table, secondary to the food.",
    ],
  },
  {
    match: /\b(fruits?|vegetables?|veg|produce|apples?|bananas?|berries|strawberr(?:y|ies)|blueberr(?:y|ies)|avocados?|tomato(?:es)?|salad|lettuce|carrots?|potato(?:es)?|mangoes|mango|grapes?|citrus|oranges?|herbs?)\b/,
    scene: [
      "Show this exact fresh produce at its peak: vivid, glossy and generous, with water droplets, natural variation and a few cut pieces that reveal the inside.",
      "A market crate, wooden bench or sunlit kitchen counter, bright soft daylight, a slight overhead or three-quarter angle, abundance rather than a single lonely item.",
      "If a person appears, only hands picking, washing or slicing, secondary to the produce.",
    ],
  },
  {
    match: /\b(bread|bakery|loaf|rolls?|buns?|croissants?|pastr(?:y|ies)|muffins?|cakes?|donuts?|sourdough|pies?)\b/,
    scene: [
      "Show this exact baked product fresh from the oven: golden crust, visible crumb or filling, a wisp of steam, a few crumbs and a butter knife on a wooden board or linen cloth.",
      "Warm morning window light, cosy and inviting, shallow depth of field.",
      "If a person appears, only hands tearing or slicing it.",
    ],
  },
  {
    match: /\b(milk|cheese|yoghurt|yogurt|butter|cream|eggs?|dairy|custard)\b/,
    scene: [
      "Show this exact dairy or egg product clean, cool and wholesome on a bright kitchen bench or breakfast table, with a natural serving: a poured glass, a spoonful, a cracked egg or a cheese board.",
      "Soft cool daylight, crisp whites, a little fresh fruit or herbs for colour, the pack facing the camera and fully legible.",
      "If a person appears, a happy adult enjoying breakfast, secondary to the product.",
    ],
  },
  {
    match: /\b(snacks?|crisps|chips|chocolate|biscuits?|cookies?|lollies|lolly|confectionery|candy|nuts?|popcorn|muesli bars?|bars?)\b/,
    scene: [
      "Show this exact snack or treat close up and tempting, the pack open or a few pieces spilling out, a small moment of reward: a friends' get-together, a lunchbox or an afternoon break.",
      "Bright, fun and colourful with a playful but simple setting, crisp texture detail, bright, flattering light.",
      "If a person appears, a happy adult enjoying it, secondary to the product.",
    ],
  },
  {
    match: /\b(pets?|dogs?|cats?|puppy|kitten|pet food)\b/,
    scene: [
      "Show this exact pet product beside a happy, healthy dog or cat in a bright, comfortable home or garden, the pack clear and legible in the foreground.",
      "Warm daylight, a sense of care and companionship, the animal looking content.",
    ],
  },
  {
    match: /\b(pasta|rice|noodles?|sauce|oil|flour|cereal|canned|tinned|spices?|spreads?|honey|jam|baking|soup|pantry|stock|grains?|lentils?|beans?)\b/,
    scene: [
      "Show this exact pantry product being used to make a simple, delicious meal: the pack beside the finished dish and a few of its fresh ingredients on a tidy kitchen bench.",
      "Warm kitchen light, steam rising from the dish, a slight overhead or three-quarter angle, home-cooked and easy.",
      "If a person appears, only hands stirring or serving, secondary to the product.",
    ],
  },
];

/**
 * The scene that sells this product. The uploaded photo stays the product;
 * the scene is why someone would buy it. Never name a real person.
 */
export function productScene(product: string, category: string, notes = ""): string {
  const text = `${product} ${category} ${notes}`.toLowerCase();
  const found = SCENES.find((entry) => entry.match.test(text));
  const scene = found?.scene ?? [
    "Show this exact grocery product at its most appealing in the everyday moment someone would buy and use it, with the pack large, well lit and easy to recognise.",
    "A real, lived-in kitchen or table setting, natural light, a few fresh ingredients or serving touches that suit the product.",
    "Keep its shape, colour and label recognisable.",
  ];
  return [...scene, PEOPLE, COPY_SPACE].join(" ");
}

export function posterPrompt(
  campaign: Campaign,
  creative: Creative,
  options?: { correction?: string; editing?: boolean; brand?: BrandInputs | null },
) {
  const brief = campaign.brief;
  const strategy = currentStrategy(campaign);
  const visual = creativeDirectionText(strategy?.visualDirection ?? brief?.visualDirection);
  const scene =
    creativeDirectionText(creative.prompt) ||
    [
      creativeDirectionText(strategy?.recommendedAngle ?? brief?.angle) ? `Campaign angle: ${creativeDirectionText(strategy?.recommendedAngle ?? brief?.angle)}.` : "",
      visual ? `Visual direction: ${visual}.` : "",
      `The product is ${campaign.product}.`,
    ]
      .filter(Boolean)
      .join(" ");
  const reference = campaign.productImageUrl
    ? [
        "The attached photo is this product. Keep its shape, colour and markings recognisable.",
        creativeDirectionText(creative.prompt) || visual
          ? "Use the campaign scene described below; keep the photographed product recognisable within it."
          : productScene(campaign.product, campaign.category, campaign.notes ?? ""),
        "Do not depict a named real person, and do not replace the product with a different one.",
      ].join(" ")
    : "No product photo was supplied. Illustrate this exact product from the brief, not a generic category scene.";
  const brandText = options?.brand ? brandSection(options.brand) : "";
  const base = [
    "Retail advertisement, 4:5, print quality.",
    reference,
    `Brand: ${campaign.sharedContext.retailer}.`,
    `Product: ${campaign.product}.`,
    scene,
    brandText,
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
  options?: { correction?: string; brand?: BrandInputs | null; aspectRatio?: AspectRatio },
): GenerateRequest {
  const reference = campaign.productImageUrl ? [campaign.productImageUrl] : undefined;
  return {
    kind: "image",
    modelId,
    prompt: posterPrompt(campaign, creative, { correction: options?.correction, brand: options?.brand }),
    aspectRatio: options?.aspectRatio ?? "4:5",
    quality: "medium",
    inputFidelity: reference ? "high" : undefined,
    contextImages: reference,
  };
}

/* -- Brand section of the prompt ---------------------------------------- */

/** Where the real brand logo is placed after the render. The prompt keeps this corner clear. */
export const LOGO_ZONE = { placement: "top-left", widthPct: 14 } as const;

const PALETTE_SHARE: Record<PaletteRole, string> = {
  background: "about 60% of the frame",
  text: "type and fine detail",
  accent: "about 30% of the frame",
  highlight: "small highlights, about 10%",
  deep: "shadows and depth",
};

/** The brand paragraph placed before the exact-wording lines. Empty when nothing about the brand is known. */
function brandSection(brand: BrandInputs): string {
  const lines: string[] = [];
  if (brand.palette.entries.length) {
    lines.push(`Brand colours, used exactly and with no other dominant colour: ${brand.palette.entries.map((entry) => `${entry.role} ${entry.hex} (${PALETTE_SHARE[entry.role]})`).join("; ")}.`);
  }
  if (brand.style.visualStyle) lines.push(`Brand look: ${brand.style.visualStyle}`);
  if (brand.style.tone) lines.push(`Brand tone: ${brand.style.tone}`);
  if (brand.logo) {
    lines.push(`Keep the ${LOGO_ZONE.placement} corner, about ${LOGO_ZONE.widthPct}% of the width, plain and free of type and busy detail: the real brand logo is added there afterwards. Do not draw any logo, wordmark or brand mark yourself.`);
  }
  return lines.join(" ");
}
