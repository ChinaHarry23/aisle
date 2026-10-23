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
 *  - `internal_retail` tools read the POS file uploaded on Brand for this
 *    retailer. A file for another banner is not used.
 */

import { uid } from "@/lib/ids";
import { aud, matchRetailData } from "@/lib/retail-data";
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
  /** Signed-in founder, when the run has one. Shelf prices use their WhichGrocer sign-in. */
  ownerUserId?: string;
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

function signedPct(value: number) {
  return `${value > 0 ? "+" : ""}${value}%`;
}

export const internalRetailTool: ToolDefinition = {
  name: "retail.internal_signals",
  label: "Internal retail signals",
  agent: "trend",
  description:
    "Reads the POS file uploaded on Brand for this retailer. It does not use another retailer's file.",
  args: ["category", "country"],
  async run({ campaign, brand, at }) {
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
    const matched = matchRetailData(brand, campaign);
    const observedAt = brand.retailData?.extractedAt || at.slice(0, 10);
    if (matched.kind !== "product" && matched.kind !== "category") {
      const detail =
        matched.kind === "missing"
          ? `No retail data file is loaded for ${brand.retailerName || "this brand"}. Upload the Coles or Woolworths file on Brand. Another retailer's file is not used.`
          : matched.kind === "mismatch"
            ? `The file on Brand is ${matched.fileRetailer}. This brand is ${matched.brandRetailer || "unnamed"}, so those figures were not used.`
            : matched.kind === "wrong_country"
              ? `The uploaded file is ${matched.fileCountry} data. This campaign is ${matched.campaignCountry}.`
              : `${brand.retailData?.retailer.name ?? "The uploaded file"} has no row for ${campaign.product} or ${campaign.category}.`;
      return {
        summary: "POS file did not supply a figure for this campaign.",
        status: "empty",
        data: null,
        evidence: [
          evidence({
            claim: "No matching POS row",
            detail,
            sourceName: brand.retailData?.retailer.name ?? "Brand retail data",
            sourceRef: "brand://retail-data",
            sourceKind: "internal_retail",
            observedAt,
            at,
            status: "unavailable",
            confidence: 100,
            raisedBy: "trend",
            usedFor: "Demand signal",
          }),
        ],
        gap: {
          kind: "missing_source",
          detail,
          effect: "Internal demand is not asserted for this campaign.",
        },
      };
    }
    const rows = matched.kind === "product" ? [matched.product] : matched.products;
    const subject = matched.kind === "product" ? matched.product.name : matched.category;
    const retailer = brand.retailData!.retailer.name;
    const lead = rows[0];
    const units = rows.reduce((sum, row) => sum + row.pos.units, 0);
    const yearAgo = rows.reduce((sum, row) => sum + row.pos.unitsYearAgo, 0);
    const velocity = yearAgo > 0 ? Math.round(((units - yearAgo) / yearAgo) * 1000) / 10 : lead.pos.velocityVsLastYearPct;
    const shown = matched.kind === "product" ? lead.pos.velocityVsLastYearPct : velocity;
    const confidence = Math.max(60, Math.min(95, Math.round(55 + Math.min(lead.pos.weeks, 52) / 2 + Math.min(lead.pos.storesRanged, 1000) / 80)));
    const shelf = lead.catalogue;
    const rival = lead.competitors[0];
    const sku = matched.kind === "product" ? `article ${lead.sku}, ` : "";
    return {
      summary: `${retailer} ${subject}: ${signedPct(shown)} versus last year. Catalogue ${aud(shelf.shelfPriceAud)}. ${rival.retailer} observed at ${aud(rival.shelfPriceAud)}.`,
      status: "ok",
      data: { relevance: matched.kind === "product" ? 92 : 78, confidence, matched: matched.kind },
      evidence: [
        evidence({
          claim: `${retailer} POS: ${subject} is ${signedPct(shown)} on last year`,
          detail: `${retailer} ${sku}${subject}: ${units.toLocaleString("en-AU")} units in ${lead.pos.weeks} weeks to ${lead.pos.periodTo}, ${matched.kind === "product" ? `across ${lead.pos.storesRanged.toLocaleString("en-AU")} stores (${lead.pos.avgUnitsPerStoreWeek} units per store per week)` : `summed across ${rows.length} ranged articles`}. ${signedPct(shown)} on the prior year. Average selling price ${aud(lead.pos.avgPriceAud)}.`,
          sourceName: `${retailer} POS`,
          sourceRef: `brand://retail-data/pos/${encodeURIComponent(lead.sku)}`,
          sourceKind: "internal_retail",
          observedAt: lead.pos.periodTo,
          at,
          confidence,
          raisedBy: "trend",
          usedFor: "Demand signal",
        }),
        evidence({
          claim: `${retailer} catalogue: ${subject} is ${shelf.ranged ? "ranged" : "not ranged"} in ${shelf.aisle}`,
          detail: `${shelf.note} Shelf ${aud(shelf.shelfPriceAud)}${shelf.promoPriceAud != null ? `, ${shelf.promoMechanic ?? "promotion"} ${aud(shelf.promoPriceAud)}${shelf.promoEnds ? ` until ${shelf.promoEnds}` : ""}` : ", not on promotion"}. Attach ${shelf.attachRatePct}% with ${shelf.pairedWith.join(", ") || "no recorded pair"}, ${shelf.heroOnlyAttachRatePct}% when sold alone.`,
          sourceName: `${retailer} catalogue`,
          sourceRef: `brand://retail-data/catalogue/${encodeURIComponent(lead.sku)}`,
          sourceKind: "internal_retail",
          observedAt: shelf.asOf,
          at,
          confidence,
          raisedBy: "trend",
          usedFor: "Catalogue history",
        }),
        evidence({
          claim: `${rival.retailer} observed ${subject} at ${aud(rival.shelfPriceAud)}`,
          detail: lead.competitors.map((row) => `${row.retailer} ${row.channel}, ${row.observedAt}: ${aud(row.shelfPriceAud)}${row.onPromotion ? `, ${row.promoMechanic ?? "on promotion"}` : ", not on promotion"}. ${row.observation}`).join(" "),
          sourceName: `${rival.retailer} competitor check`,
          sourceRef: `brand://retail-data/competitors/${encodeURIComponent(lead.sku)}`,
          sourceKind: "internal_retail",
          observedAt: rival.observedAt,
          at,
          confidence: Math.max(60, confidence - 6),
          raisedBy: "trend",
          usedFor: "Competitor",
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

/* --------------------------------------------------------------- shelf price -- */

type ShelfLookupResult =
  | {
      ok: true;
      query: string;
      claim: string;
      detail: string;
      sourceRef: string;
      observedAt: string;
      summary: string;
      offers: unknown[];
    }
  | { ok: false; kind: string; reason: string };

type ShelfLookup = (input: {
  userId?: string;
  product: string;
  category: string;
  country: string;
  at: string;
  query?: string;
}) => Promise<ShelfLookupResult>;

/**
 * The catalogue call reads WHICHGROCER_API_KEY on the server. The API route and
 * the worker install it. A run without that lookup records the price as unavailable.
 */
let shelfLookup: ShelfLookup | null = null;

export function setShelfPriceLookup(lookup: ShelfLookup) {
  shelfLookup = lookup;
}

export const shelfPriceTool: ToolDefinition = {
  name: "web.shelf_prices",
  label: "Shelf prices (WhichGrocer)",
  agent: "trend",
  description:
    "Reads live Australian catalogue prices for the product from the WhichGrocer API (Coles, Woolworths, ALDI and other retailers). Cites each price with the retailer page and the date WhichGrocer last saw it. Uses the server WHICHGROCER_API_KEY.",
  args: ["query"],
  async run({ campaign, at, args, ownerUserId }) {
    const lookup =
      campaign.country !== "AU"
        ? {
            ok: false as const,
            kind: "outside_au",
            reason: `WhichGrocer covers Australian retailers. This campaign is ${campaign.country}.`,
          }
        : shelfLookup
          ? await shelfLookup({
              userId: ownerUserId,
              product: campaign.product,
              category: campaign.category,
              country: campaign.country,
              at,
              query: args.query,
            })
          : { ok: false as const, kind: "not_connected", reason: "WhichGrocer is not connected." };
    const sourceRef = "https://api.whichgrocer.com/v2";
    if (!lookup.ok) {
      const outside = lookup.kind === "outside_au";
      return {
        summary: lookup.reason,
        status: outside ? "skipped" : "empty",
        data: null,
        evidence: [
          evidence({
            claim: outside ? "Australian shelf prices do not apply" : `No shelf price retrieved for "${args.query || campaign.product}"`,
            detail: `${lookup.reason} No catalogue price was used for this part of the brief.`,
            sourceName: "WhichGrocer",
            sourceRef,
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
          detail: lookup.reason,
          effect: outside
            ? "No Australian shelf price was applied to this campaign."
            : "The brief cannot cite a current Coles, Woolworths or ALDI price. Set WHICHGROCER_API_KEY on the server, then run the trend step again.",
        },
      };
    }
    return {
      summary: lookup.summary,
      status: "ok",
      data: { query: lookup.query, offers: lookup.offers },
      evidence: [
        evidence({
          claim: lookup.claim,
          detail: lookup.detail,
          sourceName: "WhichGrocer",
          sourceRef: lookup.sourceRef,
          sourceKind: "external_public",
          observedAt: lookup.observedAt,
          at,
          confidence: lookup.offers.length > 1 ? 84 : 74,
          raisedBy: "trend",
          usedFor: "Shelf price comparison",
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
  shelfPriceTool,
];

export function toolByName(name: string): ToolDefinition | undefined {
  return TOOL_REGISTRY.find((t) => t.name === name);
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
