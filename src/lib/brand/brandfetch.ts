/**
 * Brandfetch Brand API. A listed domain supplies the logo, colours and
 * description. A missing profile returns null so the caller can read the site.
 */

export type BrandfetchProfile = {
  about: string;
  tagline: string;
  logoUrl: string;
  colors: { ink: string; paper: string; signal: string; accent: string; deep: string };
  sourceNote: string;
};

export type BrandfetchMiss = "not_configured" | "not_found" | "unavailable";

const ASSET_HOSTS = new Set(["asset.brandfetch.io", "cdn.brandfetch.io"]);
const HEX6 = /^#[0-9a-fA-F]{6}$/;

type LogoFormat = { src?: string; format?: string; background?: string | null };
type Logo = { type?: string; theme?: string | null; formats?: LogoFormat[] };
type Swatch = { hex?: string; type?: string };
type BrandPayload = {
  name?: string;
  domain?: string;
  description?: string | null;
  longDescription?: string | null;
  logos?: Logo[];
  colors?: Swatch[];
};

function hex(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (HEX6.test(text)) return text.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(text)) {
    return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`.toLowerCase();
  }
  return null;
}

function swatch(colors: Swatch[], type: string): string | null {
  for (const color of colors) {
    if (color.type === type) {
      const value = hex(color.hex);
      if (value) return value;
    }
  }
  return null;
}

/** The hostname Brandfetch indexes. `www` is dropped; anything else is refused. */
export function brandfetchDomain(website: string): string {
  const host = new URL(website).hostname.toLowerCase().replace(/^www\./, "");
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes(".") || host.startsWith(".") || host.endsWith(".")) {
    throw new Error("Enter a public website address.");
  }
  return host;
}

function logoUrl(logos: Logo[]): string {
  const ranked = [...logos].sort((a, b) => scoreLogo(b) - scoreLogo(a));
  for (const logo of ranked) {
    const formats = [...(logo.formats ?? [])].sort((a, b) => scoreFormat(b) - scoreFormat(a));
    for (const format of formats) {
      const src = format.src?.trim();
      if (!src) continue;
      try {
        const url = new URL(src);
        if (url.protocol === "https:" && ASSET_HOSTS.has(url.hostname)) return url.href;
      } catch {
        // Ignore a format whose address is not a Brandfetch asset.
      }
    }
  }
  return "";
}

function scoreLogo(logo: Logo): number {
  const type = logo.type === "logo" ? 4 : logo.type === "symbol" ? 2 : logo.type === "icon" ? 1 : 0;
  const theme = logo.theme === "light" ? 2 : logo.theme === "dark" ? 1 : 0;
  return type * 10 + theme;
}

function scoreFormat(format: LogoFormat): number {
  const kind = format.format === "png" ? 3 : format.format === "svg" ? 2 : format.format === "webp" ? 1 : 0;
  const clear = format.background === "transparent" ? 1 : 0;
  return kind * 10 + clear;
}

/** Turn one Brand API body into the fields the brand page can save. */
export function profileFromBrandfetch(domain: string, body: unknown): BrandfetchProfile | null {
  if (!body || typeof body !== "object") return null;
  const brand = body as BrandPayload;
  const colors = brand.colors ?? [];
  const signal = swatch(colors, "brand") ?? swatch(colors, "accent");
  const accent = swatch(colors, "accent") ?? signal;
  const deep = swatch(colors, "dark") ?? signal;
  const paper = swatch(colors, "light") ?? "#ffffff";
  const logo = logoUrl(brand.logos ?? []);
  const about = (brand.longDescription || brand.description || "").replace(/\s+/g, " ").trim();
  const tagline = (brand.description || "").replace(/\s+/g, " ").trim();
  if (!signal && !logo && !about) return null;
  const listed = brand.domain?.trim() || domain;
  return {
    about: about.slice(0, 1200),
    tagline: tagline.slice(0, 180),
    logoUrl: logo,
    colors: {
      signal: signal ?? "#111111",
      accent: accent && accent !== signal ? accent : (signal ?? "#111111"),
      deep: deep ?? signal ?? "#111111",
      ink: "#1c1917",
      paper,
    },
    sourceNote: `Logo, colours and description for ${listed} came from Brandfetch. Tone and visual style were left as they were.`,
  };
}

/** Look up a domain. `not_found` is a real miss; the other misses are temporary. */
export async function lookupBrandfetch(
  domain: string,
  options: { apiKey?: string; fetch?: typeof fetch } = {},
): Promise<{ profile: BrandfetchProfile } | { miss: BrandfetchMiss }> {
  const apiKey = (options.apiKey ?? process.env.BRANDFETCH_API_KEY)?.trim();
  if (!apiKey) return { miss: "not_configured" };
  const fetchImpl = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`https://api.brandfetch.io/v2/brands/domain/${encodeURIComponent(domain)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return { miss: "unavailable" };
  }
  if (response.status === 404) return { miss: "not_found" };
  if (!response.ok) return { miss: "unavailable" };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { miss: "unavailable" };
  }
  const profile = profileFromBrandfetch(domain, body);
  return profile ? { profile } : { miss: "not_found" };
}
