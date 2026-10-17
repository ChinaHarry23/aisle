/**
 * "What credits buy", priced from the same catalogs the meter uses, so the
 * table cannot drift from what a call really costs. Ids are resolved
 * defensively: a model that has left the catalog drops out of the table
 * rather than showing a fallback model's price under the wrong name.
 */

import { creditsForCost } from "@/lib/billing/plan";
import { PROVIDER_DEFAULT_MODEL, getLlmOrDefault } from "@/lib/llm/catalog";
import { quoteLlm } from "@/lib/llm/estimate";
import { getModelOrDefault } from "@/lib/media/catalog";
import { quoteModel } from "@/lib/media/estimate";

export type CreditExample = { label: string; detail: string; costUsd: number; credits: number };

function llmExample(modelId: string | undefined, provider: string): CreditExample | null {
  if (!modelId) return null;
  const model = getLlmOrDefault(modelId);
  if (model.id !== modelId) return null;
  const quote = quoteLlm(model.id, "trend");
  return {
    label: `One agent decision · ${provider}`,
    detail: `${model.name}, about ${(quote.inputTokens + quote.outputTokens).toLocaleString("en-US")} tokens`,
    costUsd: quote.costUsd,
    credits: creditsForCost(quote.costUsd),
  };
}

function mediaExample(
  candidates: string[],
  kind: "image" | "video",
  label: (name: string) => string,
  durationSec?: number,
): CreditExample | null {
  for (const id of candidates) {
    const model = getModelOrDefault(id, kind);
    if (model?.id !== id) continue;
    const quote = quoteModel(model.id, { durationSec });
    return { label: label(model.name), detail: quote.billedAs, costUsd: quote.costUsd, credits: creditsForCost(quote.costUsd) };
  }
  return null;
}

export function creditExamples(): CreditExample[] {
  const rows: (CreditExample | null)[] = [];
  const defaults = PROVIDER_DEFAULT_MODEL as Partial<Record<string, string>>;
  const attempt = (make: () => CreditExample | null) => {
    try {
      rows.push(make());
    } catch {
      // A catalog mid-change should cost a table row, not the page.
    }
  };
  attempt(() => llmExample(defaults.openai, "OpenAI"));
  attempt(() => llmExample(defaults.anthropic, "Claude"));
  attempt(() => mediaExample(["openai:gpt-image-2.5"], "image", (name) => `A poster · ${name}`));
  attempt(() =>
    mediaExample(["google:omni-flash", "google:veo-3.1-fast"], "video", (name) => `An 8 s ad video · ${name}`, 8),
  );
  return rows.filter((row): row is CreditExample => row !== null);
}
