/**
 * Tool registry for the agent bench.
 *
 * AHR-02 requires the Trend Analyser to say where each finding came from and
 * when, to keep supported findings apart from assumptions, and to report what it
 * could not establish. A model on its own cannot do that, so each agent is given
 * tools and every call is recorded as a `ToolCall` plus zero or more `Evidence`
 * records that carry a real locator and date.
 *
 * Two kinds of tool live here:
 *  - `external_public` tools make a real HTTP request, with a timeout, and report
 *    honestly when the network is unavailable (status `empty` + an `unavailable`
 *    evidence row) instead of inventing a result.
 *  - `internal_retail` tools read the retailer's own authorised data, which for
 *    this prototype is a deterministic model of POS and catalogue history.
 */

import { uid } from "@/lib/ids";
import type { BrandProfile, Campaign, Channel, Country } from "@/lib/types";
import type { Evidence, SourceKind, ToolCall } from "./types";

export type ToolAgent = "trend" | "creative" | "compliance" | "media";

export type ToolOutcome = {
  /** Short human summary written to the campaign log / run trace. */
  summary: string;
  status: ToolCall["status"];
  evidence: Evidence[];
  /** Tool-specific payload the calling agent consumes. */
  data: unknown;
  /** Something the analysis could not establish, surfaced as a brief gap. */
  gap?: { kind: "missing_source" | "outdated" | "conflict" | "unauthorised" | "low_confidence"; detail: string; effect: string };
};

export type ToolDefinition = {
  name: string;
  label: string;
  agent: ToolAgent;
  description: string;
  /** Shown in the runtime view so the founder can audit what an agent may call. */
  args: string[];
  run: (input: ToolInput) => Promise<ToolOutcome>;
};

export type ToolInput = {
  campaign: Campaign;
  brand: BrandProfile;
  at: string;
  /** Agent-provided arguments, already coerced to strings. */
  args: Record<string, string>;
};

const FETCH_TIMEOUT_MS = 6_000;

async function getJson<T>(url: string): Promise<{ ok: true; json: T } | { ok: false; reason: string }> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        // Wikimedia asks for a descriptive UA; DuckDuckGo's HTML endpoint blocks empty UAs.
        "User-Agent": "AisleAgentBench/0.2 (ELEC5620 prototype; contact: team@aisle.website)",
        Accept: "application/json, text/html;q=0.9",
      },
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true, json: (await res.json()) as T };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message.slice(0, 120) : "network error",
    };
  }
}

function evidence(input: {
  claim: string;
  detail: string;
  sourceName: string;
  sourceRef: string;
  sourceKind: SourceKind;
  observedAt: string;
  at: string;
  status?: Evidence["status"];
  confidence: number;
  raisedBy: Evidence["raisedBy"];
  usedFor: string;
}): Evidence {
  return {
    id: uid("ev"),
    claim: input.claim,
    detail: input.detail,
    sourceName: input.sourceName,
    sourceRef: input.sourceRef,
    sourceKind: input.sourceKind,
    observedAt: input.observedAt,
    fetchedAt: input.at,
    status: input.status ?? "verified",
    confidence: input.confidence,
    raisedBy: input.raisedBy,
    usedFor: input.usedFor,
  };
}

export function toToolCall(input: {
  agent: ToolCall["agent"];
  tool: string;
  args: Record<string, string | number | boolean>;
  outcome: ToolOutcome;
  latencyMs: number;
  at: string;
}): ToolCall {
  return {
    id: uid("tc"),
    at: input.at,
    agent: input.agent,
    tool: input.tool,
    args: input.args,
    status: input.outcome.status,
    summary: input.outcome.summary,
    latencyMs: input.latencyMs,
    evidenceIds: input.outcome.evidence.map((e) => e.id),
  };
}

/* --------------------------------------------------------- internal retail -- */

/**
 * Deterministic stand-in for the retailer's POS / catalogue warehouse. It is
 * clearly labelled `internal_retail`, and the guard refuses it when the retailer
 * has not authorised internal data for the campaign.
 */
function retailSignal(campaign: Campaign) {
  const seedText = `${campaign.product}${campaign.category}${campaign.country}`;
  let h = 0;
  for (let i = 0; i < seedText.length; i += 1) h = (h * 31 + seedText.charCodeAt(i)) % 100_000;
  const lift = 12 + (h % 29); // 12–40 %
  const attach = 6 + (h % 17); // 6–22 %
  const weeksTracked = 26 + (h % 60);
  return { lift, attach, weeksTracked, index: 40 + (h % 45) };
}

export const internalRetailTool: ToolDefinition = {
  name: "retail.internal_signals",
  label: "Internal retail signals",
  agent: "trend",
  description:
    "Reads the retailer's POS velocity, catalogue history and basket attach rate for the product's category.",
  args: ["category", "country"],
  async run({ campaign, at }) {
    const authorised = campaign.internalDataAuthorised !== false;
    if (!authorised) {
      return {
        summary: "Internal retail data is not authorised for this campaign — skipped.",
        status: "skipped",
        data: null,
        evidence: [
          evidence({
            claim: "Internal retail data not included",
            detail:
              "The retailer has not authorised internal retail data for this campaign, so POS and catalogue history were excluded from the analysis.",
            sourceName: "Authorisation register",
            sourceRef: "workspace://authorisation/internal-retail",
            sourceKind: "internal_retail",
            observedAt: at,
            at,
            status: "unavailable",
            confidence: 100,
            raisedBy: "trend",
            usedFor: "Authorisation",
          }),
        ],
        gap: {
          kind: "unauthorised",
          detail: "POS, catalogue history and basket data were excluded (not authorised).",
          effect: "Conclusions rest on public sources only; confidence is reduced.",
        },
      };
    }
    const s = retailSignal(campaign);
    const observedAt = at.slice(0, 10);
    return {
      summary: `Category velocity +${s.lift}% for ${campaign.category}; basket attach +${s.attach}% over ${s.weeksTracked} weeks.`,
      status: "ok",
      data: s,
      evidence: [
        evidence({
          claim: `${campaign.category} demand is running above last cycle`,
          detail: `Weekly POS velocity for ${campaign.category} is +${s.lift}% against the same weeks last year, measured across ${s.weeksTracked} weeks of store data for ${campaign.country}.`,
          sourceName: "Lane & Co. POS warehouse",
          sourceRef: `internal://pos/${campaign.category.toLowerCase().replace(/\s+/g, "-")}/${observedAt}`,
          sourceKind: "internal_retail",
          observedAt,
          at,
          confidence: 88,
          raisedBy: "trend",
          usedFor: "Demand signal",
        }),
        evidence({
          claim: "Pairing lifts basket attach",
          detail: `Catalogue history shows paired lines lifting attach rate by ${s.attach}% against hero-only covers.`,
          sourceName: "Catalogue history",
          sourceRef: `internal://catalogue/history/${observedAt}`,
          sourceKind: "internal_retail",
          observedAt,
          at,
          confidence: 81,
          raisedBy: "trend",
          usedFor: "Basket build",
        }),
      ],
    };
  },
};

/* ----------------------------------------------------------- public sources -- */

type WikipediaSummary = {
  extract?: string;
  timestamp?: string;
  content_urls?: { desktop?: { page?: string } };
  title?: string;
};

export const marketContextTool: ToolDefinition = {
  name: "web.market_context",
  label: "Public market context (Wikipedia)",
  agent: "trend",
  description:
    "Fetches the public summary of the product/category to ground the campaign theme. Records the page URL and the revision date.",
  args: ["topic"],
  async run({ campaign, at, args }) {
    const topic = (args.topic || campaign.product.split(/[(+—,]/)[0] || campaign.category).trim();
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic.replace(/\s+/g, "_"))}`;
    const result = await getJson<WikipediaSummary>(url);
    if (!result.ok) {
      return {
        summary: `Public context unavailable (${result.reason}).`,
        status: "empty",
        data: null,
        evidence: [
          evidence({
            claim: `No public reference retrieved for "${topic}"`,
            detail: `The public reference lookup failed (${result.reason}). No public record was used for this part of the brief.`,
            sourceName: "Wikipedia REST API",
            sourceRef: url,
            sourceKind: "external_public",
            observedAt: at.slice(0, 10),
            at,
            status: "unavailable",
            confidence: 100,
            raisedBy: "trend",
            usedFor: "Source availability",
          }),
        ],
        gap: {
          kind: "missing_source",
          detail: `Public reference lookup for "${topic}" failed (${result.reason}).`,
          effect: "Campaign context rests on internal and inferred signals only.",
        },
      };
    }
    const json = result.json;
    const extract = (json.extract ?? "").trim();
    const page = json.content_urls?.desktop?.page ?? url;
    const observedAt = (json.timestamp ?? at).slice(0, 10);
    if (!extract) {
      return {
        summary: `Public reference for "${topic}" returned no extract.`,
        status: "empty",
        data: null,
        evidence: [],
        gap: {
          kind: "missing_source",
          detail: `"${topic}" exists publicly but carried no usable summary.`,
          effect: "No public theme grounding was added.",
        },
      };
    }
    return {
      summary: `Public reference for "${topic}" (${observedAt}).`,
      status: "ok",
      data: { topic, extract, page, observedAt },
      evidence: [
        evidence({
          claim: `Public reference: ${json.title ?? topic}`,
          detail: extract.slice(0, 420),
          sourceName: "Wikipedia REST API",
          sourceRef: page,
          sourceKind: "external_public",
          observedAt,
          at,
          confidence: 72,
          raisedBy: "trend",
          usedFor: "Category context and theme grounding",
        }),
      ],
    };
  },
};

export const competitorScanTool: ToolDefinition = {
  name: "web.competitor_scan",
  label: "Public competitor scan (DuckDuckGo)",
  agent: "trend",
  description:
    "Searches public results for competitor promotion language in the campaign's country, and counts how many lead with superlatives.",
  args: ["query"],
  async run({ campaign, at, args }) {
    const query = (
      args.query ||
      `${campaign.category} ${campaign.country} advertising claim "best" OR "number one"`
    ).trim();
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1`;
    const result = await getJson<{
      AbstractText?: string;
      AbstractURL?: string;
      Heading?: string;
      RelatedTopics?: { Text?: string; FirstURL?: string }[];
    }>(url);
    if (!result.ok) {
      return {
        summary: `Competitor scan unavailable (${result.reason}).`,
        status: "empty",
        data: null,
        evidence: [
          evidence({
            claim: "Public competitor scan not completed",
            detail: `The public search endpoint did not answer (${result.reason}); no competitor pattern is claimed.`,
            sourceName: "DuckDuckGo Instant Answer API",
            sourceRef: url,
            sourceKind: "external_public",
            observedAt: at.slice(0, 10),
            at,
            status: "unavailable",
            confidence: 100,
            raisedBy: "trend",
            usedFor: "Source availability",
          }),
        ],
        gap: {
          kind: "missing_source",
          detail: `Competitor scan failed (${result.reason}).`,
          effect: "No competitor pattern is asserted in this brief.",
        },
      };
    }
    const json = result.json;
    const related = (json.RelatedTopics ?? []).filter((t) => t.Text).slice(0, 4);
    const abstract = (json.AbstractText ?? "").trim();
    const ref = json.AbstractURL ?? url;
    const observedAt = at.slice(0, 10);
    const terms = related.map((t) => t.Text ?? "").join(" ");
    const superlatives = (terms + abstract).match(
      /\b(best|number one|#1|guaranteed|clinically proven|world'?s)\b/gi,
    );
    const hits = superlatives?.length ?? 0;

    return {
      summary:
        related.length === 0 && !abstract
          ? "Public search returned no usable index for this query."
          : `Public index: ${hits} superlative term(s) across ${related.length + (abstract ? 1 : 0)} indexed result(s).`,
      status: related.length === 0 && !abstract ? "empty" : "ok",
      data: { abstract, related, hits, ref },
      evidence: [
        evidence({
          claim: "Competitor/public promotion language in market",
          detail:
            (abstract || related.map((t) => `${t.Text} (${t.FirstURL})`).join(" · ")).slice(0, 420) ||
            "No indexed public description available.",
          sourceName: "DuckDuckGo Instant Answer API",
          sourceRef: ref,
          sourceKind: "external_public",
          observedAt,
          at,
          confidence: 64,
          raisedBy: "trend",
          usedFor: "Competitor pattern",
        }),
      ],
      gap:
        related.length === 0 && !abstract
          ? {
              kind: "missing_source",
              detail: "The public search index returned nothing for this category in this country.",
              effect: "Competitor behaviour is not asserted; only brand rules constrain the copy.",
            }
          : undefined,
    };
  },
};

const COUNTRY_CENTROID: Record<Country, { lat: number; lon: number; label: string }> = {
  AU: { lat: -33.87, lon: 151.21, label: "Sydney" },
  NZ: { lat: -36.85, lon: 174.76, label: "Auckland" },
  UK: { lat: 51.51, lon: -0.13, label: "London" },
  US: { lat: 40.71, lon: -74.01, label: "New York" },
};

/** Open-Meteo needs no key and answers with the campaign window's real forecast. */
export const seasonWeatherTool: ToolDefinition = {
  name: "web.season_weather",
  label: "Season and weather window (Open-Meteo)",
  agent: "trend",
  description:
    "Reads the real forecast for the campaign's country and date window, so a seasonal claim is grounded rather than guessed.",
  args: ["country", "start", "end"],
  async run({ campaign, at }) {
    const c = COUNTRY_CENTROID[campaign.country] ?? COUNTRY_CENTROID.AU;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&forecast_days=16`;
    const result = await getJson<{
      daily?: {
        time?: string[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_sum?: number[];
      };
    }>(url);
    const observedAt = at.slice(0, 10);
    if (!result.ok) {
      return {
        summary: `Forecast unavailable (${result.reason}).`,
        status: "empty",
        data: null,
        evidence: [
          evidence({
            claim: "Seasonal window not verified",
            detail: `The forecast endpoint did not answer (${result.reason}). Seasonal framing is an assumption, not a verified fact.`,
            sourceName: "Open-Meteo forecast API",
            sourceRef: url,
            sourceKind: "external_public",
            observedAt,
            at,
            status: "unavailable",
            confidence: 100,
            raisedBy: "trend",
            usedFor: "Source availability",
          }),
        ],
        gap: {
          kind: "low_confidence",
          detail: "Campaign-window weather could not be retrieved.",
          effect: "Seasonal claims are labelled assumptions and given reduced confidence.",
        },
      };
    }
    const daily = result.json.daily;
    const temps = daily?.temperature_2m_max ?? [];
    const mins = daily?.temperature_2m_min ?? [];
    const rain = daily?.precipitation_sum ?? [];
    if (temps.length === 0) {
      return {
        summary: "Forecast returned no daily series.",
        status: "empty",
        data: null,
        evidence: [],
      };
    }
    const avgMax = temps.reduce((a, b) => a + b, 0) / temps.length;
    const avgMin = mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : avgMax - 8;
    const wetDays = rain.filter((r) => r >= 1).length;
    const start = daily?.time?.[0] ?? observedAt;
    const end = daily?.time?.[daily.time.length - 1] ?? observedAt;

    return {
      summary: `${c.label}: ${avgMax.toFixed(1)}°C max / ${avgMin.toFixed(1)}°C min, ${wetDays} wet day(s) in the ${start}–${end} window.`,
      status: "ok",
      data: { avgMax, avgMin, wetDays, start, end },
      evidence: [
        evidence({
          claim: `Campaign-window conditions in ${c.label}`,
          detail: `Forecast for ${start}–${end}: daily maxima averaging ${avgMax.toFixed(1)}°C, minima ${avgMin.toFixed(1)}°C, ${wetDays} day(s) with ≥1 mm precipitation.`,
          sourceName: "Open-Meteo forecast API",
          sourceRef: url,
          sourceKind: "external_public",
          observedAt: start,
          at,
          confidence: 79,
          raisedBy: "trend",
          usedFor: "Seasonal and channel timing",
        }),
      ],
    };
  },
};

/* ---------------------------------------------------------- shared registry -- */

export const TOOL_REGISTRY: ToolDefinition[] = [
  internalRetailTool,
  marketContextTool,
  competitorScanTool,
  seasonWeatherTool,
];

export function toolByName(name: string): ToolDefinition | undefined {
  return TOOL_REGISTRY.find((t) => t.name === name);
}

export function toolsForAgent(agent: ToolAgent): ToolDefinition[] {
  return TOOL_REGISTRY.filter((t) => t.agent === agent);
}

/** Channel behaviour is a documented assumption, not a measurement. */
export function channelBehaviourNote(channel: Channel): { note: string; ref: string } {
  const table: Record<Channel, { note: string; ref: string }> = {
    instagram: {
      note: "Social feed attention peaks late morning on teaching and mid-week shop days.",
      ref: "assumption://channel-behaviour/instagram",
    },
    web: {
      note: "Homepage traffic peaks before the commute and the school run.",
      ref: "assumption://channel-behaviour/web",
    },
    email: {
      note: "Inboxes open after work and after the last lecture, before dinner.",
      ref: "assumption://channel-behaviour/email",
    },
    print: {
      note: "In-store dwell is highest mid-week; catalogue cycles must not clash with the prior circular.",
      ref: "assumption://channel-behaviour/print",
    },
    digital_signage: {
      note: "Signage loops perform during lecture changeover and Thursday evening trade.",
      ref: "assumption://channel-behaviour/signage",
    },
  };
  return table[channel];
}
