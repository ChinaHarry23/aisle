/**
 * Public web search through the seat's own provider, on the owner's key.
 *
 * The Trend agent uses this to look up a brand before it writes the brief.
 * OpenAI runs its web search tool; Claude runs its server-side web search.
 * A local seat has neither, so the call is skipped and the brief says so.
 */
import type { BillingContext } from "@/lib/billing/meter";
import { holdCredits, releaseHold, settleHold } from "@/lib/billing/meter";
import { getLlmOrDefault } from "./catalog";
import { llmCostUsd, worstCaseUsd } from "./estimate";
import { anthropicBase, openaiBase } from "./adapters";
export type WebCitation = { title: string; url: string; snippet: string };

export type WebSearchResult = {
  status: "ok" | "empty" | "skipped" | "error";
  summary: string;
  text: string;
  citations: WebCitation[];
  costUsd: number;
  modelName: string;
};

function clean(message: string) {
  return message.replace(/https?:\/\/\S+/g, "<url>").replace(/(sk-|AIza)[\w-]{8,}/g, "<redacted>").slice(0, 300);
}

function citationsFromUnknown(value: unknown, into: WebCitation[]) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) citationsFromUnknown(item, into);
    return;
  }
  const row = value as Record<string, unknown>;
  const url = typeof row.url === "string" ? row.url : typeof row.FirstURL === "string" ? row.FirstURL : "";
  const title = typeof row.title === "string" ? row.title : typeof row.heading === "string" ? row.heading : "";
  const snippet = typeof row.snippet === "string" ? row.snippet : typeof row.cited_text === "string" ? row.cited_text : typeof row.text === "string" ? row.text : "";
  if (url.startsWith("http")) into.push({ title: title.slice(0, 180) || url, url, snippet: snippet.slice(0, 400) });
  for (const child of Object.values(row)) citationsFromUnknown(child, into);
}

function uniqueCitations(items: WebCitation[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  }).slice(0, 8);
}

async function post(url: string, headers: Record<string, string>, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(90_000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${clean(raw)}`);
  return JSON.parse(raw) as Record<string, unknown>;
}

async function openaiSearch(apiModel: string, query: string) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OpenAI is not set up on this server.");
  const body = { model: apiModel, tools: [{ type: "web_search" }], input: query, max_output_tokens: 900 };
  let json: Record<string, unknown>;
  try {
    json = await post(`${openaiBase()}/responses`, { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/web_search/.test(message)) throw error;
    json = await post(`${openaiBase()}/responses`, { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, { ...body, tools: [{ type: "web_search_preview" }] });
  }
  const citations: WebCitation[] = [];
  citationsFromUnknown(json.output, citations);
  const texts: string[] = [];
  const output = Array.isArray(json.output) ? json.output : [];
  for (const item of output) {
    const content = (item as { content?: { text?: string }[] }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) if (part.text) texts.push(part.text);
  }
  const usage = json.usage as { input_tokens?: number; output_tokens?: number } | undefined;
  return { text: texts.join("\n").slice(0, 2000), citations: uniqueCitations(citations), inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens };
}

async function anthropicSearch(apiModel: string, query: string) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Claude is not set up on this server.");
  const json = await post(`${anthropicBase()}/messages`, {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  }, {
    model: apiModel,
    max_tokens: 1500,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    messages: [{ role: "user", content: query }],
  });
  const citations: WebCitation[] = [];
  citationsFromUnknown(json.content, citations);
  const texts: string[] = [];
  const content = Array.isArray(json.content) ? json.content : [];
  for (const part of content) {
    const text = (part as { text?: string }).text;
    if (text) texts.push(text);
  }
  const usage = json.usage as { input_tokens?: number; output_tokens?: number } | undefined;
  return { text: texts.join("\n").slice(0, 2000), citations: uniqueCitations(citations), inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens };
}

/** One billed web search on the model assigned to the Trend seat. */
export async function searchWithModel(modelId: string, query: string, billing: BillingContext | undefined): Promise<WebSearchResult> {
  const model = getLlmOrDefault(modelId);
  const skipped = (summary: string): WebSearchResult => ({ status: "skipped", summary, text: "", citations: [], costUsd: 0, modelName: model.name });
  if (model.providerId === "local") return skipped("The Trend seat is local, so it cannot run a provider web search.");
  if (!billing) return skipped("Web search was not sent because no account is paying for this call.");
  const hold = await holdCredits(billing, worstCaseUsd(model, { prompt: query }));
  if (!hold) return skipped(`${model.name} web search was skipped: not enough credits.`);
  try {
    const found = model.providerId === "openai" ? await openaiSearch(model.apiModel, query) : await anthropicSearch(model.apiModel, query);
    const costUsd = found.inputTokens != null && found.outputTokens != null ? llmCostUsd(model, found.inputTokens, found.outputTokens) : worstCaseUsd(model, { prompt: query });
    await settleHold(hold, costUsd, { modelId: model.id, note: "Trend web search" });
    const citations = found.citations;
    if (!found.text && citations.length === 0) {
      return { status: "empty", summary: `${model.name} searched and returned no pages.`, text: "", citations: [], costUsd, modelName: model.name };
    }
    return {
      status: "ok",
      summary: `${model.name} searched the public web and cited ${citations.length} page(s).`,
      text: found.text,
      citations,
      costUsd,
      modelName: model.name,
    };
  } catch (error) {
    await releaseHold(hold);
    return { status: "error", summary: clean(error instanceof Error ? error.message : "Web search failed."), text: "", citations: [], costUsd: 0, modelName: model.name };
  }
}
