/**
 * The five seats of the one-person marketing company, as LangGraph agents.
 *
 * `createAgent` compiles each seat into a LangGraph. The campaign operation that
 * calls them is its own graph in `runtime/operation-graph.ts`, so a run traces as
 * the bench (intake, trend, creative, compliance, media) with the seat nested
 * under the node that asked for it.
 *
 * Each seat is a ReAct agent with its own instructions, its own tools and a Zod
 * schema for its answer. The agent decides which tools to call and when to stop —
 * that is the point of using the framework — while three things stay outside it,
 * because they are product guarantees rather than model behaviour:
 *
 *  - **The tool-call budget.** A credit hold reserves the worst case for *one*
 *    call, so unbounded looping is unbounded spending. `modelCallLimitMiddleware`
 *    and `toolCallLimitMiddleware` cap a run, and the cap is a named constant so
 *    the cost envelope is auditable.
 *  - **The policy guard.** Agents cannot publish, overspend or alter cleared
 *    claims, whatever they decide. `guard.ts` refuses those actions and records
 *    the refusal.
 *  - **The deterministic fallback.** With no model answering (offline, no key, no
 *    credits) every seat degrades to rules, so the product works in a demo with
 *    nothing configured.
 */

import { createAgent, modelCallLimitMiddleware, toolCallLimitMiddleware } from "langchain";
import { z } from "zod";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BaseMessage } from "@langchain/core/messages";
import { MAX_MODEL_CALLS_PER_RUN, MeteredChatModel, type MeteredModelConfig } from "./metered-chat-model";

/* --------------------------------------------------------------- schemas --- */

export const trendBriefSchema = z.object({
  priorities: z
    .array(
      z.object({
        topic: z.string().describe("Short name for the trend or opportunity."),
        relevance: z.number().min(0).max(100).describe("Relevance to this campaign, 0-100."),
        confidence: z.number().min(0).max(100).describe("How well the evidence supports it, 0-100."),
        theme: z.string().optional().describe("A campaign theme this suggests."),
        visual: z.string().optional().describe("A visual direction this suggests."),
      }),
    )
    .describe("Ranked findings, most relevant first."),
  angle: z.string().describe("The campaign angle, one sentence."),
  keyMessage: z.string().describe("The single line the advertising should land."),
  claimsAllowed: z.array(z.string()).describe("Claims that can be substantiated for this product."),
  claimsAvoid: z.array(z.string()).describe("Claims that cannot, including banned terms."),
  visualDirection: z.string().describe("Art direction for the creative agent."),
  limitations: z
    .array(z.string())
    .describe("What the available evidence could not establish. Be specific and honest."),
});

/** The creative seat rewriting one founder's visual correction into image prompts. */
export const imageRevisionSchema = z.object({
  prompts: z
    .array(
      z.object({
        id: z.string().describe("The creative id this prompt revises."),
        prompt: z
          .string()
          .describe(
            "A complete image-edit prompt. Describe the corrected poster. Do not merely repeat the founder's complaint.",
          ),
      }),
    )
    .describe("One revised image prompt for each poster supplied."),
});

export const copySchema = z.object({
  variants: z
    .array(
      z.object({
        variant: z.enum(["A", "B"]),
        kicker: z.string().describe("Small line above the headline."),
        headline: z.string().describe("The poster headline. No unverifiable claims."),
        subhead: z.string().describe("The supporting line."),
        cta: z.string().describe("Call to action."),
        caption: z.string().describe("Social/catalogue caption."),
        prompt: z.string().describe("Image-generation prompt for the poster."),
      }),
    )
    .describe("Exactly two variants, A and B."),
});

export const complianceSchema = z.object({
  issues: z.array(
    z.object({
      category: z.enum([
        "misleading_claim",
        "unsupported_claim",
        "missing_condition",
        "price_accuracy",
        "copyright",
        "audience_targeting",
        "platform_policy",
        "brand_guideline",
      ]),
      basis: z
        .enum(["confirmed_breach", "human_judgement"])
        .describe(
          "confirmed_breach of a named rule, or human_judgement when a person must decide.",
        ),
      severity: z.enum(["high", "medium", "low"]),
      excerpt: z.string().describe("The exact words or element at issue."),
      explanation: z.string().describe("Why it is a problem under the cited rule."),
      rule: z.string().describe("The specific law, policy or brand rule."),
      recommendedCorrection: z.string().describe("What to change."),
    }),
  ),
  summary: z.string().describe("The review result in one or two sentences."),
  outcome: z
    .enum(["pass", "changes_required", "manual_review"])
    .optional()
    .describe(
      "pass only when issues is empty. changes_required when the copy must be rewritten. manual_review when a person must decide. pass does not approve or publish.",
    ),
});

export const recommendationSchema = z.object({
  points: z.array(
    z.object({
      verdict: z.enum(["keep", "drop", "change"]),
      area: z.enum(["channel_mix", "claims", "creative_angle", "timing", "audience"]),
      text: z.string().describe("The recommendation, citing the figure or channel it rests on."),
      evidence: z.string().describe("The collected channel figure this is based on."),
    }),
  ),
});

export const intakeTurnSchema = z.object({
  reply: z
    .string()
    .describe("Your conversational reply to the founder. Ask for one missing field at a time."),
  missingField: z
    .enum([
      "product",
      "category",
      "targetAudience",
      "objective",
      "budget",
      "channels",
      "dates",
      "country",
      "none",
    ])
    .describe("Which required field you are asking for next, or 'none' when all required fields are valid."),
  options: z
    .array(z.string())
    .max(3)
    .optional()
    .describe("At most three quick-reply options the founder can click."),
  draftPatch: z
    .object({
      name: z.string().optional().describe("Suggested campaign name (respecting brand banned terms)."),
      product: z.string().optional().describe("Product name extracted from the founder's message."),
      category: z.string().optional().describe("Category: Grocery, Apparel, Pantry, Home, or Beauty."),
      targetAudience: z.string().optional().describe("Target audience description."),
      objective: z.string().optional().describe("Campaign objective."),
      notes: z.string().optional().describe("Additional founder direction (labelled as assistant-drafted until confirmed)."),
    })
    .optional()
    .describe(
      "Free-text brief fields updated from this turn. NEVER include budget, channels, startDate, endDate, or country unless the founder explicitly stated them.",
    ),
  readyToReview: z
    .boolean()
    .describe("True only when intake_validate returned zero problems and the draft is ready for the founder to review in the form."),
});

/* -------------------------------------------------------------- prompts --- */

const TREND_SYSTEM = `You are the Trend Analyser for a neighbourhood retailer running weekly promotion cycles.

You are given a founder's campaign brief and a set of tools that read real sources:
the retailer's own POS and catalogue history, public market reference, public
competitor language, and the forecast for the campaign window.

Work only from what the tools return. Call the tools you need — you decide which
are relevant and in what order — then answer.

Rules you must not break:
- Every finding must rest on something a tool returned. If nothing supports it, it
  is an assumption and you must say so in "limitations", not in a finding.
- Record what you could not establish. A limitation reported honestly is worth more
  than a confident guess.
- Never invent market data, prices, competitor behaviour or customer research.
- Prefer specific, verifiable product facts over superlatives.`;

const CREATIVE_SYSTEM = `You are the Image Generation agent (copy and art direction) for a neighbourhood retailer.

Write two poster variants, A and B, in the brand's voice, for the product and
audience you are given. Every claim must be a verifiable product fact drawn from
the brief's allowed claims.

Rules you must not break:
- Never use a banned term, a superlative, a health claim or a guarantee.
- If the compliance notes tell you a claim was rejected, remove it and keep the
  angle. Do not replace it with a different unsupported claim.
- The image prompt describes the poster honestly: no competitor logos, no
  stock-photo families, no claim that the picture cannot show.`;

const COMPLIANCE_SYSTEM = `You are the Compliance Checker for a neighbourhood retailer.

Review the advertisement against the advertising law of the campaign's country,
the retailer's brand rules, and the platform policies of the channels it will run on.

Rules you must not break:
- You may analyse, flag and recommend corrections. You may NEVER approve, publish
  or clear an advertisement. Approval is a human decision and not yours to make.
- Separate a confirmed breach of a named rule from something that needs human
  judgement. Put the first in "confirmed_breach" and the second in
  "human_judgement" — do not blur them.
- Cite the specific rule for every issue, and say exactly what to change.
- A banned term you find in the advertisement is a confirmed breach. There is no context in which it passes.
- If the policy you would need is missing or unclear, say so as an issue rather
  than assuming the advertisement is fine.
- Set outcome to pass only when issues is empty, changes_required when the copy
  must be rewritten, or manual_review when a person must decide. pass does not
  approve or publish the advertisement.`;

const MEDIA_SYSTEM = `You are the Media Manager for a neighbourhood retailer.

A campaign has finished. You are given the results that were actually collected,
channel by channel, including channels that did not report.

Rules you must not break:
- Only use the figures you are given. Never estimate a missing channel, and never
  carry a figure over from another campaign.
- Every recommendation must cite the channel or figure it rests on.
- If the collected evidence cannot support keep/drop/change advice, return no
  points rather than generic advice.
- You may recommend. You may not publish, change spend, or add a channel: those are
  the founder's decisions.`;

const INTAKE_SYSTEM = `You are the Conversational Intake Assistant for a neighbourhood retailer (AHR-01 Context Entry).

You interview the Human Founder to assemble a valid CampaignInput draft for review in the new-campaign form.
You have two read-only tools:
- brand_profile: reads the retailer's tone, approved terms, banned terms, and country advertising rules.
- intake_validate: runs validateIntake() against the candidate brief and returns any ValidationProblem items.

Rules you must not break:
- Ask for missing required fields one at a time in a concise, natural conversation.
- NEVER invent or guess budget, campaign start/end dates, country, or distribution channels. Always ask the founder for those explicitly.
- You may suggest free-text fields (campaign name, product framing, category, targetAudience, objective, notes) and offer at most 3 quick-reply options per turn.
- Never use any term from the brand's bannedTerms list.
- You have NO command access: you cannot launch the pipeline, approve creatives, publish, or commit spend. If the founder asks you to launch or publish, explain that you only prepare the draft and they must click "Launch agents" in the form after reviewing.`;

const INSTRUCTIONS = {
  trend: TREND_SYSTEM,
  creative: CREATIVE_SYSTEM,
  compliance: COMPLIANCE_SYSTEM,
  media: MEDIA_SYSTEM,
  intake: INTAKE_SYSTEM,
} as const;

export const SEAT_SCHEMAS = {
  trend: trendBriefSchema,
  creative: copySchema,
  compliance: complianceSchema,
  media: recommendationSchema,
  intake: intakeTurnSchema,
} as const;

/* --------------------------------------------------------------- factory --- */

export type AgentSeat = keyof typeof INSTRUCTIONS;

export function instructionsFor(seat: AgentSeat): string {
  return INSTRUCTIONS[seat];
}

type BuiltAgent<T> = {
  /** Answers the task, having called whatever tools it decided it needed. */
  invoke: (input: { task: string }) => Promise<T>;
};

type SeatOptions<T> = (
  | {
      /** A ready chat model, so the caller can read its usage meter afterwards. */
      chat: MeteredChatModel;
      model?: never;
    }
  | {
      chat?: never;
      /** Or a config, in which case one is built here. */
      model: MeteredModelConfig;
    }
) & {
  seat: AgentSeat;
  tools: StructuredToolInterface[];
  schema: z.ZodType<T>;
  /** Overrides the default instructions, for the art-director seat. */
  instructions?: string;
  /** Studio passes the assistant context so LangSmith can show the fields. */
  contextSchema?: z.ZodObject<z.ZodRawShape>;
  /** Extra channels merged with the message state. Studio uses these as the run form. */
  stateSchema?: z.ZodObject<z.ZodRawShape>;
  /** Appended after the call-budget middleware. */
  extraMiddleware?: NonNullable<Parameters<typeof createAgent>[0]["middleware"]>;
};

/**
 * The LangGraph behind one seat.
 *
 * `buildAgent` wraps this with the text-or-tool answer parser the engine uses.
 * Studio serves the graph itself, so threads, time travel and the drawing stay
 * on the Agent Server.
 */
export function compileSeatAgent<T>(options: SeatOptions<T>) {
  const chat = options.chat ? options.chat : new MeteredChatModel(options.model);
  return createAgent({
    model: chat,
    tools: options.tools,
    systemPrompt: options.instructions ?? INSTRUCTIONS[options.seat],
    responseFormat: options.schema,
    name: `aisle_${options.seat}`,
    ...(options.contextSchema ? { contextSchema: options.contextSchema } : {}),
    ...(options.stateSchema ? { stateSchema: options.stateSchema } : {}),
    middleware: [
      // The cost guarantee: a run cannot exceed the credit envelope it reserved.
      modelCallLimitMiddleware({
        runLimit: MAX_MODEL_CALLS_PER_RUN,
        exitBehavior: "error",
      }),
      toolCallLimitMiddleware({
        runLimit: MAX_MODEL_CALLS_PER_RUN * 2,
        exitBehavior: "error",
      }),
      ...(options.extraMiddleware ?? []),
    ],
  });
}

/**
 * Build one seat.
 *
 * `tools` is the seat's own registry slice, so an agent cannot call a tool that
 * belongs to another seat even if it asks for one by name.
 */
export function buildAgent<T>(options: SeatOptions<T>): BuiltAgent<T> {
  const agent = compileSeatAgent(options);

  return {
    async invoke(input) {
      const result = await agent.invoke({
        messages: [{ role: "user", content: input.task }],
      });

      // Two answer shapes are legitimate, and both occur in practice.
      //
      // A model that can call tools answers by calling the structured-output tool
      // LangChain advertises for `responseFormat`, and the framework parses it
      // into `structuredResponse`. A model that cannot call tools — a smaller
      // local model, or an OpenAI model asked without tool support — instead
      // replies with the JSON as text, which is exactly what this application did
      // before agents existed. Accepting only the first silently downgraded every
      // such run to the deterministic rules.
      const structured = (result as { structuredResponse?: unknown }).structuredResponse;
      if (structured !== undefined) {
        return options.schema.parse(structured) as T;
      }

      const messages = (result as { messages?: BaseMessage[] }).messages ?? [];
      const last = [...messages].reverse().find((message) => message.getType() === "ai");
      const text = typeof last?.content === "string" ? last.content : null;
      const parsed = parseJsonObject(text);
      if (parsed === null) {
        throw new Error(`The ${options.seat} agent finished without a structured answer.`);
      }
      // Validated against the same schema either way, so a text answer is held to
      // exactly the standard a tool call is.
      return options.schema.parse(parsed) as T;
    },
  };
}

/**
 * The first JSON object in a model's text, or null.
 *
 * Local models habitually wrap JSON in a sentence or a fenced block, so this looks
 * for the object rather than requiring the whole reply to be one.
 */
function parseJsonObject(text: string | null): unknown {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.indexOf("{");
  if (start === -1) return null;
  const end = body.lastIndexOf("}");
  if (end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}
