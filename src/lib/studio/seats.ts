/**
 * The five seats, served to LangSmith Studio.
 *
 * Each export is a factory. The Agent Server calls it once per run with the
 * assistant config, then attaches its checkpointer, so a thread survives the
 * next message. Tools are the registry the bench uses, and a tool call is
 * written onto the campaign before the run returns.
 */

import { createMiddleware, dynamicSystemPromptMiddleware, tool } from "langchain";
import { z } from "zod";
import { agentTools } from "@/lib/agents/agent-tools";
import {
  compileSeatAgent,
  complianceSchema,
  copySchema,
  instructionsFor,
  intakeTurnSchema,
  recommendationSchema,
  trendBriefSchema,
  type AgentSeat,
} from "@/lib/agents/seats";
import { MeteredChatModel } from "@/lib/agents/metered-chat-model";
import { runComplete } from "@/lib/llm/metered-complete";
import type { CompleteRequest, CompleteResult } from "@/lib/llm/types";
import { nextMissingField } from "@/lib/intake/assistant";
import type { IntakeDraftState } from "@/lib/intake/shared";
import { COUNTRIES, validateIntake } from "@/lib/runtime/intake";
import { addEvent, callTool, type StepEnv, type Work } from "@/lib/runtime/steps";
import type { ToolAgent } from "@/lib/runtime/tools";
import type { BillingContext } from "@/lib/billing/meter";
import type { WorkspaceSettings } from "@/lib/settings";
import type { BrandProfile, Campaign, Country } from "@/lib/types";
import { loadStudioSeat, readStudioContext, saveStudioCampaign, type StudioContext } from "./context";

export const studioContextSchema = z.object({
  campaignId: z
    .string()
    .default("")
    .describe("Campaign id. Blank uses AISLE_STUDIO_CAMPAIGN_ID, then the first draft in the workspace."),
  userId: z
    .string()
    .default("")
    .describe("Workspace owner id or email. Blank uses AISLE_STUDIO_USER_ID, then the dev-alex desk."),
  modelId: z.string().default("").describe("Override the workspace model, for example openai:gpt-6-luna."),
});

const SCHEMAS = {
  trend: trendBriefSchema,
  creative: copySchema,
  compliance: complianceSchema,
  media: recommendationSchema,
  intake: intakeTurnSchema,
} as const;

const INTAKE_PATCH = ["name", "product", "category", "targetAudience", "objective", "notes"] as const;

export type StudioSeatSession = {
  userId: string;
  billing: BillingContext;
  modelId?: string;
  work: Work;
  env: StepEnv;
  settings: WorkspaceSettings;
  brand: BrandProfile;
  complete?: (req: CompleteRequest, billing?: BillingContext) => Promise<CompleteResult>;
};

type GraphArgs = [config?: unknown, runtime?: unknown];

function brief(campaign: Campaign, brand: BrandProfile): string {
  return [
    `Campaign: ${campaign.name} (${campaign.id}), status ${campaign.status}.`,
    `Product: ${campaign.product}. Category: ${campaign.category}.`,
    `Audience: ${campaign.targetAudience}. Objective: ${campaign.objective}.`,
    `Country: ${campaign.country}. Channels: ${campaign.channels.join(", ") || "none"}.`,
    `Dates: ${campaign.startDate} → ${campaign.endDate}. Budget: ${campaign.budget}.`,
    `Retailer: ${brand.retailerName}. Tone: ${brand.tone}.`,
    `Banned terms: ${brand.bannedTerms.join(", ") || "none"}.`,
    "Work only from this campaign and from tools. Do not publish, spend, or approve.",
  ].join("\n");
}

function intakeDraft(campaign: Campaign): IntakeDraftState {
  return {
    name: campaign.name,
    product: campaign.product,
    category: campaign.category,
    targetAudience: campaign.targetAudience,
    objective: campaign.objective,
    budget: campaign.budget,
    channels: campaign.channels,
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    country: campaign.country,
    notes: campaign.notes,
    fieldSources: {},
  };
}

function intakeTools(current: () => StudioSeatSession) {
  return [
    tool(
      async (args: { country?: string }) => {
        const session = current();
        const country =
          args.country && (COUNTRIES as string[]).includes(args.country) ? (args.country as Country) : session.work.campaign.country;
        return JSON.stringify({
          retailerName: session.brand.retailerName,
          tone: session.brand.tone,
          approvedTerms: session.brand.approvedTerms,
          bannedTerms: session.brand.bannedTerms,
          countryRule: session.brand.countryRules[country] ?? "",
        });
      },
      {
        name: "brand_profile",
        description: "Read the retailer's tone, approved terms, banned terms, and the advertising rule for a country.",
        schema: z.object({
          country: z.string().optional().describe("AU, NZ, UK, or US. Omit to use the campaign country."),
        }),
      },
    ),
    tool(
      async () => {
        const session = current();
        const draft = intakeDraft(session.work.campaign);
        const problems = validateIntake(draft, session.brand);
        return JSON.stringify({
          valid: problems.length === 0,
          problems,
          missingField: nextMissingField(draft, session.brand),
        });
      },
      {
        name: "intake_validate",
        description: "Validate the current campaign brief and list any missing or invalid fields.",
        schema: z.object({
          check: z.string().optional().describe("Pass 'current' to validate the campaign as it stands."),
        }),
      },
    ),
  ];
}

function registryTools(seat: ToolAgent, current: () => StudioSeatSession, onCall: () => void) {
  const session = current;
  // `agentTools` only calls `execute`. The campaign is read then, after beforeAgent has loaded it.
  return agentTools(seat, {
    campaign: undefined as unknown as Campaign,
    brand: undefined as unknown as BrandProfile,
    at: "",
    execute: async (name, args) => {
      const live = session();
      onCall();
      return callTool(live.work, seat, name, args, live.env);
    },
  });
}

function applyIntakePatch(campaign: Campaign, patch: Record<string, unknown> | undefined) {
  if (!patch) return false;
  let changed = false;
  for (const key of INTAKE_PATCH) {
    const value = patch[key];
    if (typeof value !== "string" || !value.trim()) continue;
    campaign[key] = value.trim();
    changed = true;
  }
  return changed;
}

type SeatBuild = {
  /** Present for tests. A Studio run loads the campaign in `beforeAgent` instead. */
  session?: StudioSeatSession;
  hint?: StudioContext;
};

function assignedModel(seat: AgentSeat, session: StudioSeatSession): string {
  if (session.modelId) return session.modelId;
  return seat === "intake" ? session.settings.agents.trend.modelId : session.settings.agents[seat].modelId;
}

/**
 * One seat graph.
 *
 * The campaign is not chosen when the server draws the graph. `beforeAgent`
 * loads it from the run input (`campaignId`, `userId`, `modelId`), then the
 * assistant config, then `AISLE_STUDIO_USER_ID` / the first draft. Tests pass
 * `session` and skip that load.
 */
export function assembleStudioSeat(seat: AgentSeat, session: StudioSeatSession) {
  return buildStudioSeat(seat, { session });
}

function buildStudioSeat(seat: AgentSeat, options: SeatBuild) {
  const holder: { session?: StudioSeatSession } = { session: options.session };
  const current = () => {
    if (!holder.session) throw new Error("Studio has not loaded a campaign for this run.");
    return holder.session;
  };
  const live = {
    agent: seat,
    modelId: options.session ? assignedModel(seat, options.session) : "openai:gpt-6-luna",
    billing: options.session?.billing,
    localBaseUrl: options.session?.settings.localBaseUrl,
    localModel: options.session?.settings.localModel,
    complete: options.session?.complete ?? runComplete,
  };
  const chat = new MeteredChatModel(live);
  let toolCalls = 0;
  const tools = seat === "intake" ? intakeTools(current) : registryTools(seat, current, () => {
    toolCalls += 1;
  });

  return compileSeatAgent({
    seat,
    chat,
    tools,
    schema: SCHEMAS[seat] as z.ZodType,
    contextSchema: studioContextSchema,
    stateSchema: studioContextSchema,
    instructions: instructionsFor(seat),
    extraMiddleware: [
      createMiddleware({
        name: "aisleStudioLoad",
        beforeAgent: async (state, runtime) => {
          if (options.session) return;
          const fromState = (state ?? {}) as StudioContext;
          const fromRuntime = readStudioContext(undefined, { executionRuntime: { context: runtime.context } });
          holder.session = await loadStudioSeat({
            campaignId: fromState.campaignId || fromRuntime.campaignId || options.hint?.campaignId,
            userId: fromState.userId || fromRuntime.userId || options.hint?.userId,
            modelId: fromState.modelId || fromRuntime.modelId || options.hint?.modelId,
          });
          live.modelId = assignedModel(seat, holder.session);
          live.billing = holder.session.billing;
          live.localBaseUrl = holder.session.settings.localBaseUrl;
          live.localModel = holder.session.settings.localModel;
        },
      }),
      dynamicSystemPromptMiddleware(() => {
        const session = holder.session;
        if (!session) return instructionsFor(seat);
        return `${instructionsFor(seat)}\n\n${brief(session.work.campaign, session.brand)}`;
      }),
      createMiddleware({
        name: "aisleStudioCommit",
        afterAgent: async (state) => {
          const session = holder.session;
          if (!session) return;
          const structured = (state as { structuredResponse?: { draftPatch?: Record<string, unknown> } }).structuredResponse;
          const patched = seat === "intake" && applyIntakePatch(session.work.campaign, structured?.draftPatch);
          const spent = chat.usage.costUsd > 0;
          if (!patched && !spent && toolCalls === 0) return;
          if (spent || toolCalls > 0) {
            session.work.campaign.spend = {
              ...session.work.campaign.spend,
              inferenceUsd: Math.round((session.work.campaign.spend.inferenceUsd + chat.usage.costUsd) * 1e5) / 1e5,
            };
            addEvent(
              session.work,
              seat,
              "insight",
              `Studio · ${seat}`,
              `${chat.usage.models.join(", ") || live.modelId} · $${chat.usage.costUsd.toFixed(4)} · ${toolCalls} tool call(s).`,
            );
          }
          await saveStudioCampaign(session.userId, session.work);
        },
      }),
    ],
  });
}

function seatGraph(seat: AgentSeat, ...args: GraphArgs) {
  return buildStudioSeat(seat, { hint: readStudioContext(args[0], args[1]) });
}

export function trend(...args: GraphArgs) {
  return seatGraph("trend", ...args);
}

export function creative(...args: GraphArgs) {
  return seatGraph("creative", ...args);
}

export function compliance(...args: GraphArgs) {
  return seatGraph("compliance", ...args);
}

export function media(...args: GraphArgs) {
  return seatGraph("media", ...args);
}

export function intake(...args: GraphArgs) {
  return seatGraph("intake", ...args);
}
