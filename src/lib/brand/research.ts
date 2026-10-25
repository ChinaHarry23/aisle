import type { BrandProfile } from "@/lib/types";
import type { CompleteRequest, CompleteResult } from "@/lib/llm/types";
import { fetchPublicText } from "@/lib/net/public-fetch";

type BrandResearch = {
  about: string;
  tagline: string;
  logoUrl: string;
  tone: string;
  visualStyle: string;
  colors: BrandProfile["colors"];
  /** Where the suggestion came from, so the founder can judge it. */
  sourceNote: string;
};

const EMPTY_COLORS: BrandProfile["colors"] = {
  ink: "#1c1917",
  paper: "#ffffff",
  signal: "#111111",
  accent: "#e5e5e5",
  deep: "#111111",
};

function hex6<T extends string | undefined>(value: unknown, fallback: T): string | T {
  return /^#[0-9a-fA-F]{6}$/.test(String(value ?? "")) ? (value as string) : fallback;
}

function assertPublicSite(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Enter a full website address, including https://.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("The website must start with http:// or https://.");
  const host = url.hostname.toLowerCase();
  // A quick, friendly refusal for the obvious cases. fetchPublicText checks
  // every resolved address and redirect when it connects.
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Use the public website, not a local address.");
  }
  return url;
}

function abs(base: URL, value: string | undefined): string {
  if (!value) return "";
  try {
    return new URL(value, base).href;
  } catch {
    return "";
  }
}

function meta(html: string, key: string): string {
  const pattern = new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${key}["']`, "i");
  const match = html.match(pattern);
  return (match?.[1] || match?.[2] || "").replace(/\s+/g, " ").trim();
}

function link(html: string, rel: string): string {
  const pattern = new RegExp(`<link[^>]+rel=["'][^"']*${rel}[^"']*["'][^>]+href=["']([^"']+)["']|<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*${rel}[^"']*["']`, "i");
  const match = html.match(pattern);
  return match?.[1] || match?.[2] || "";
}

function colorsFrom(html: string, theme: string): string[] {
  const found = new Map<string, number>();
  const add = (hex: string) => {
    const value = hex.toLowerCase();
    if (value === "#fff" || value === "#ffffff" || value === "#000" || value === "#000000") return;
    found.set(value, (found.get(value) ?? 0) + 1);
  };
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(theme)) add(theme);
  for (const match of html.matchAll(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) add(match[0].length === 4 ? `#${match[0][1]}${match[0][1]}${match[0][2]}${match[0][2]}${match[0][3]}${match[0][3]}` : match[0]);
  return [...found.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([hex]) => hex);
}

function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
}

async function readSite(url: URL): Promise<{ html: string; finalUrl: URL }> {
  const page = await fetchPublicText(url, {
    timeoutMs: 12_000,
    maxBytes: 1_500_000,
    headers: { Accept: "text/html", "User-Agent": "AisleBrandResearch/1.0 (course project)" },
  });
  if (page.status < 200 || page.status >= 300) throw new Error(`The website returned HTTP ${page.status}.`);
  return { html: page.text, finalUrl: page.url };
}

function scraped(name: string, site: URL, html: string) {
  const description = meta(html, "og:description") || meta(html, "description");
  const title = meta(html, "og:title") || (html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "").trim();
  const theme = meta(html, "theme-color");
  const logo = abs(site, meta(html, "og:image") || link(html, "apple-touch-icon") || link(html, "icon"));
  const swatches = colorsFrom(html, theme);
  return {
    about: description || (title ? `${name} — ${title}` : ""),
    tagline: title && title.toLowerCase() !== name.toLowerCase() ? title.slice(0, 140) : "",
    logoUrl: logo,
    colors: {
      signal: swatches[0] ?? EMPTY_COLORS.signal,
      accent: swatches[1] ?? swatches[0] ?? EMPTY_COLORS.accent,
      deep: swatches[2] ?? swatches[0] ?? EMPTY_COLORS.deep,
      ink: EMPTY_COLORS.ink,
      paper: EMPTY_COLORS.paper,
    } satisfies BrandProfile["colors"],
    pageText: textOf(html),
  };
}

function parseSuggestion(text: string | null): Partial<BrandResearch> | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Partial<BrandResearch>;
  } catch {
    return null;
  }
}

/** Read the public site, then ask the model to suggest tone and visual style. */
export async function researchBrand(input: {
  name: string;
  website: string;
  complete: (req: CompleteRequest) => Promise<CompleteResult>;
  modelId: string;
}): Promise<BrandResearch> {
  const name = input.name.trim();
  if (!name) throw new Error("Enter the brand name first.");
  const site = assertPublicSite(input.website);
  const { html, finalUrl } = await readSite(site);
  assertPublicSite(finalUrl.href);
  const found = scraped(name, finalUrl, html);
  const draft: BrandResearch = {
    about: found.about,
    tagline: found.tagline,
    logoUrl: found.logoUrl,
    tone: "",
    visualStyle: "",
    colors: found.colors,
    sourceNote: `Read ${finalUrl.hostname}. The model did not return a tone or a visual style, so those fields were left as they were.`,
  };
  let result: CompleteResult;
  try {
    result = await input.complete({
    agent: "trend",
    modelId: input.modelId,
    direct: true,
    maxOutputTokens: 400,
    system: "You research a retail brand from the page text supplied. Return JSON only. Do not invent a legal policy or a banned-word list.",
    prompt: [
      `Brand name: ${name}`,
      `Website: ${finalUrl.href}`,
      `Page title: ${found.tagline || "(none)"}`,
      `Meta description: ${found.about || "(none)"}`,
      `Colours seen on the page: ${found.colors.signal}, ${found.colors.accent}, ${found.colors.deep}`,
      "",
      "Page text:",
      found.pageText || "(no readable text)",
      "",
      "From this page, suggest a tone of voice and a visual style the founder can edit. Keep about to what the page actually says.",
      'Reply with JSON only: {"about":"","tagline":"","tone":"","visualStyle":"","colors":{"signal":"#000000","accent":"#000000","deep":"#000000","ink":"#1c1917","paper":"#ffffff"}}',
    ].join("\n"),
    });
  } catch (error) {
    return { ...draft, sourceNote: `Read ${finalUrl.hostname}. ${error instanceof Error ? error.message : "The model did not answer."}` };
  }
  const suggestion = result.status === "ok" ? parseSuggestion(result.text) : null;
  if (!suggestion) return { ...draft, sourceNote: `Read ${finalUrl.hostname}. ${result.note || draft.sourceNote}` };
  const colors = suggestion.colors;
  return {
    about: typeof suggestion.about === "string" && suggestion.about.trim() ? suggestion.about.trim().slice(0, 1200) : draft.about,
    tagline: typeof suggestion.tagline === "string" && suggestion.tagline.trim() ? suggestion.tagline.trim().slice(0, 180) : draft.tagline,
    logoUrl: draft.logoUrl,
    tone: typeof suggestion.tone === "string" ? suggestion.tone.trim().slice(0, 800) : "",
    visualStyle: typeof suggestion.visualStyle === "string" ? suggestion.visualStyle.trim().slice(0, 800) : "",
    colors: {
      signal: hex6(colors?.signal, draft.colors.signal),
      accent: hex6(colors?.accent, draft.colors.accent),
      deep: hex6(colors?.deep, draft.colors.deep),
      ink: EMPTY_COLORS.ink,
      paper: EMPTY_COLORS.paper,
    },
    sourceNote: `Suggested from ${finalUrl.hostname}. Edit any line you disagree with.`,
  };
}
