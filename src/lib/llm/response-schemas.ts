/**
 * Strict JSON schemas for OpenAI structured output.
 *
 * Every property is required and additional properties are forbidden, which is
 * what the Responses API and Chat Completions demand when `strict` is true.
 */

const priority = {
  type: "object",
  additionalProperties: false,
  properties: {
    topic: { type: "string" },
    relevance: { type: "number" },
    confidence: { type: "number" },
    theme: { type: "string" },
    visual: { type: "string" },
  },
  required: ["topic", "relevance", "confidence", "theme", "visual"],
} as const;

/** The brief the trend step stores and the copy step prints from. */
export const trendBriefSchema = {
  name: "trend_brief",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      priorities: { type: "array", items: priority },
      angle: { type: "string" },
      keyMessage: { type: "string" },
      claimsAllowed: { type: "array", items: { type: "string" } },
      claimsAvoid: { type: "array", items: { type: "string" } },
      visualDirection: { type: "string" },
      limitations: { type: "array", items: { type: "string" } },
    },
    required: [
      "priorities",
      "angle",
      "keyMessage",
      "claimsAllowed",
      "claimsAvoid",
      "visualDirection",
      "limitations",
    ],
  },
} as const;

const variant = {
  type: "object",
  additionalProperties: false,
  properties: {
    variant: { type: "string", enum: ["A", "B"] },
    kicker: { type: "string" },
    headline: { type: "string" },
    subhead: { type: "string" },
    cta: { type: "string" },
    caption: { type: "string" },
    prompt: { type: "string" },
  },
  required: ["variant", "kicker", "headline", "subhead", "cta", "caption", "prompt"],
} as const;

/** The two poster variants: lines of type plus the image prompt. */
export const copySchema = {
  name: "poster_copy",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      variants: { type: "array", items: variant },
    },
    required: ["variants"],
  },
} as const;
