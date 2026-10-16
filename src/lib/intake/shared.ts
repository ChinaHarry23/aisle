/**
 * Browser-safe types, constants, and pure helpers for the conversational intake assistant.
 *
 * Kept separate from `src/lib/intake/assistant.ts` so client components
 * (`/campaigns/new` and `IntakeChatbot`) never pull the server-only metered LLM
 * funnel and database ledger into the browser bundle.
 */

import type { CompleteResult } from "@/lib/llm/types";
import type { ValidationProblem } from "@/lib/runtime/intake";
import type { AgentEvent, Channel, Country, IntakeFieldSources } from "@/lib/types";

export const MAX_INTAKE_TURNS = 12;

export const ASSISTANT_NOTE_PREFIX = "[Drafted by intake assistant — confirm before launch] ";

export type IntakeChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  at?: string;
};

export type IntakeDraftState = {
  name: string;
  product: string;
  category: string;
  targetAudience: string;
  objective: string;
  budget: number;
  channels: Channel[];
  startDate: string;
  endDate: string;
  country: Country;
  notes: string;
  fieldSources: IntakeFieldSources;
};

export type IntakeTurnOutput = {
  reply: string;
  draft: IntakeDraftState;
  problems: ValidationProblem[];
  missingField:
    | "product"
    | "category"
    | "targetAudience"
    | "objective"
    | "budget"
    | "channels"
    | "dates"
    | "country"
    | "none";
  options: string[];
  readyToReview: boolean;
  turnCount: number;
  turnCapReached: boolean;
  refusedCommand: boolean;
  filteredBannedTerms: string[];
  usedTools: string[];
  logEvents: AgentEvent[];
  trace: {
    modelId: string;
    modelName: string;
    path: "live_model" | "deterministic_fallback";
    status: CompleteResult["status"];
    costUsd: number;
    totalTokens: number;
    calls: number;
    note: string;
  };
};

export function emptyIntakeDraft(): IntakeDraftState {
  return {
    name: "",
    product: "",
    category: "Grocery",
    targetAudience: "",
    objective: "",
    budget: 0,
    channels: [],
    startDate: "",
    endDate: "",
    country: "AU",
    notes: "",
    fieldSources: {},
  };
}

/** Quick-reply options for the current missing field (always <= 3 options). */
export function optionsForMissingField(
  missing: IntakeTurnOutput["missingField"],
  draft: IntakeDraftState,
): string[] {
  switch (missing) {
    case "product":
      return [
        "Navel oranges + cold-pressed juice",
        "Northline Trail Parka (navy)",
        "Single-origin espresso beans (500g)",
      ];
    case "targetAudience":
      return [
        "Inner-west households and weekend market shoppers, 25–50",
        "Australian university students and daily commuters, 18–25",
        "Weekday after-work grocery shoppers, 28–45",
      ];
    case "objective":
      return [
        "Lift weekly catalogue engagement and basket attach",
        "Drive store visits and seasonal trial this cycle",
        "Increase online add-to-cart and mid-week repeat orders",
      ];
    case "budget":
      return ["$4,500", "$8,000", "$15,000"];
    case "channels":
      return [
        "Instagram, Website, and Email",
        "Instagram, Email, and Print catalogue",
        "All channels (Instagram, Web, Email, Print, In-store signage)",
      ];
    case "dates":
      return [
        "2026-10-19 to 2026-11-01",
        "2026-10-26 to 2026-11-08",
        "2026-11-02 to 2026-11-15",
      ];
    case "country":
      return ["AU", "NZ", "UK"];
    default:
      return draft.name ? [] : ["Use suggested campaign name"];
  }
}
