/**
 * The existing tool registry, exposed to LangChain.
 *
 * The tools themselves are unchanged: they still run against the same real
 * sources, still raise the same `Evidence` rows, and still report honestly when a
 * source is unreachable. What is new is that an agent may now *choose* which of
 * them to call, in what order, and how many times — within the run's bound.
 *
 * Wrapping rather than rewriting matters for two reasons. The evidence ledger is
 * what AHR-02 is graded on, so the record must keep coming from one place. And the
 * registry already knows which agent may call what (`ToolDefinition.agent`), which
 * keeps the per-seat tool sets honest.
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { BrandProfile, Campaign } from "@/lib/types";
import {
  TOOL_REGISTRY,
  type ToolAgent,
  type ToolDefinition,
  type ToolOutcome,
} from "@/lib/runtime/tools";

/**
 * Tool arguments are declared as `a, b, c` in the registry, so the per-tool schema
 * is built from that list. Every argument is a string: they carry a topic, a
 * category or a country, and the tools coerce what they need.
 */
export function toolSchema(definition: ToolDefinition) {
  const shape: Record<string, z.ZodString> = {};
  for (const arg of definition.args) {
    shape[arg] = z.string().describe(toolArgHelp(definition.name, arg));
  }
  return z.object(shape);
}

/** Without this the model sees a bare argument name and guesses. */
function toolArgHelp(tool: string, arg: string): string {
  const help: Record<string, Record<string, string>> = {
    "retail.internal_signals": {
      category: "The product category to read, e.g. Apparel or Grocery.",
    },
    "web.market_context": {
      topic: "The product or category to look up, e.g. a product name.",
    },
    "web.competitor_scan": {
      query: "A short public search query, e.g. 'outerwear AU retail promotion'.",
    },
    "web.season_weather": {
      country: "Two-letter market code: AU, NZ, UK or US.",
    },
    "web.shelf_prices": {
      query: "The product to price, e.g. 'apple juice'. Australian catalogue only.",
    },
  };
  return help[tool]?.[arg] ?? `The ${arg} argument.`;
}

export type AgentToolContext = {
  campaign: Campaign;
  brand: BrandProfile;
  /** Frozen "now" for the whole command, so every tool records one instant. */
  at: string;
  /** Runs the tool and records the call. Supplied by the engine. */
  execute: (name: string, args: Record<string, string>) => Promise<ToolOutcome>;
  /** Called for every call the agent makes, for the run trace. */
  onCall?: (name: string, args: Record<string, string>, outcome: ToolOutcome) => void;
};

/**
 * A LangChain tool per registry entry.
 *
 * The return value is JSON, because that is what goes back to the model in the
 * tool result message. `data` is the payload the tool actually produced; a tool
 * that failed returns its summary and status so the model can see the failure and
 * adapt, instead of the agent loop dying on an exception.
 */
export function agentTools(agent: ToolAgent, context: AgentToolContext): DynamicStructuredTool[] {
  return TOOL_REGISTRY.filter((definition) => definition.agent === agent).map((definition) =>
    new DynamicStructuredTool({
      name: definition.name,
      description: definition.description,
      schema: toolSchema(definition),
      func: async (args: Record<string, unknown>) => {
        // The registry speaks string arguments; a model that sends a number or a
        // boolean is coerced rather than rejected, since that is a formatting
        // difference, not a wrong call.
        const flat: Record<string, string> = {};
        for (const [key, value] of Object.entries(args ?? {})) {
          flat[key] = typeof value === "string" ? value : String(value ?? "");
        }
        const outcome = await context.execute(definition.name, flat);
        context.onCall?.(definition.name, flat, outcome);
        return JSON.stringify({
          status: outcome.status,
          summary: outcome.summary,
          data: outcome.data,
          ...(outcome.gap ? { gap: outcome.gap } : {}),
        });
      },
    }),
  );
}

/** The tool names a seat may call, for the runtime view and the tests. */
export function toolNamesFor(agent: ToolAgent): string[] {
  return TOOL_REGISTRY.filter((definition) => definition.agent === agent).map((d) => d.name);
}
