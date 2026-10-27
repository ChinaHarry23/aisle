/**
 * Brand inputs for the Content Generation agent.
 *
 * Reads the three brand assets the agent must honour, from `BrandProfile`:
 * `logoUrl`, `colors` and `visualStyle`. Each is validated on its own and a
 * problem is returned as a gap the caller can show; nothing is replaced with a
 * guess, and no logo is ever invented.
 */
import { lookup } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import sharp from "sharp";
import { isPublicAddress } from "@/lib/net/public-fetch";
import type { BrandProfile } from "@/lib/types";

export const LOGO_MAX_BYTES = 4 * 1024 * 1024;
export const LOGO_MIN_WIDTH = 64;
export const STYLE_MAX_CHARS = 600;
const LOGO_TIMEOUT_MS = 8_000;

export type BrandGap = {
  kind:
    | "logo_missing"
    | "logo_unfetchable"
    | "logo_unreadable"
    | "logo_too_small"
    | "palette_invalid"
    | "palette_low_contrast";
  reason: string;
};

export type LogoAsset = {
  bytes: Buffer;
  mime: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  source: string;
};

export type PaletteRole = "background" | "text" | "accent" | "highlight" | "deep";
export type PaletteEntry = { role: PaletteRole; hex: string; lab: [number, number, number] };
export type BrandPalette = { entries: PaletteEntry[]; textOnBackground: number | null };
export type BrandStyle = { visualStyle: string; tone: string };

export type BrandInputs = {
  logo: LogoAsset | null;
  palette: BrandPalette;
  style: BrandStyle;
  gaps: BrandGap[];
};

/* -- colour maths ------------------------------------------------------ */

const HEX6 = /^#[0-9a-f]{6}$/i;

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];
}

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG contrast ratio between two hex colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = channels(hex).map(linear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** CIE Lab (D65) for an sRGB triple. */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const [lr, lg, lb] = [r, g, b].map(linear);
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function hexToLab(hex: string): [number, number, number] {
  return rgbToLab(...channels(hex));
}

/** CIE76 colour difference. Around 10 or less reads as the same colour family. */
export function deltaE(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/* -- palette ----------------------------------------------------------- */

const ROLES: [keyof BrandProfile["colors"], PaletteRole][] = [
  ["paper", "background"],
  ["ink", "text"],
  ["signal", "accent"],
  ["accent", "highlight"],
  ["deep", "deep"],
];

export function ingestPalette(colors: BrandProfile["colors"] | undefined): { palette: BrandPalette; gaps: BrandGap[] } {
  const gaps: BrandGap[] = [];
  const entries: PaletteEntry[] = [];
  for (const [field, role] of ROLES) {
    const value = colors?.[field];
    if (value === undefined || value === "") {
      if (field === "ink" || field === "paper" || field === "signal") {
        gaps.push({ kind: "palette_invalid", reason: `Brand colour "${field}" is not set.` });
      }
      continue;
    }
    if (!HEX6.test(value)) {
      gaps.push({ kind: "palette_invalid", reason: `Brand colour "${field}" (${value}) is not a 6-digit hex value, so it is left out.` });
      continue;
    }
    const hex = value.toLowerCase();
    entries.push({ role, hex, lab: hexToLab(hex) });
  }
  const colour = (role: PaletteRole) => entries.find((entry) => entry.role === role)?.hex;
  const background = colour("background");
  const text = colour("text");
  const textOnBackground = background && text ? contrastRatio(text, background) : null;
  if (textOnBackground !== null && textOnBackground < 4.5) {
    gaps.push({ kind: "palette_low_contrast", reason: `Brand text on background contrast is ${textOnBackground.toFixed(1)}:1, below 4.5:1, so headlines may be hard to read.` });
  }
  const accent = colour("accent");
  if (accent && background && contrastRatio(accent, background) < 3) {
    gaps.push({ kind: "palette_low_contrast", reason: `Brand accent on background contrast is ${contrastRatio(accent, background).toFixed(1)}:1, below 3:1.` });
  }
  return { palette: { entries, textOnBackground }, gaps };
}

/* -- visual style ------------------------------------------------------ */

/** Trimmed and length-capped so brand copy cannot flood the prompt. Banned wording is Compliance's check, not this agent's. */
export function ingestStyle(brand: Pick<BrandProfile, "visualStyle" | "tone">): BrandStyle {
  const clean = (value: string | undefined) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, STYLE_MAX_CHARS).trim();
  return { visualStyle: clean(brand.visualStyle), tone: clean(brand.tone) };
}

/* -- logo -------------------------------------------------------------- */

export type LogoOptions = {
  /** Read an `aisle-media:` url for the owner. Injected so this module holds no database code. */
  readStored?: (url: string) => Promise<{ bytes: Buffer; mime: string }>;
  /** Fetch a remote logo. Defaults to a guarded public fetch. */
  fetchRemote?: (url: URL) => Promise<Buffer>;
  publicDir?: string;
};

/** Fetch https/http bytes from a public address only, with no redirects, a timeout and a size cap. */
async function fetchRemoteLogo(url: URL): Promise<Buffer> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The logo address must start with http:// or https://.");
  if (url.username || url.password) throw new Error("The logo address must not contain a user name or password.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address);
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) {
    throw new Error("The logo address points at a private network address.");
  }
  // Redirects are refused: a public host could otherwise bounce the request inward.
  const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(LOGO_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`The logo address answered ${res.status}.`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > LOGO_MAX_BYTES) throw new Error("The logo file is larger than 4 MB.");
  const reader = res.body?.getReader();
  if (!reader) throw new Error("The logo address returned no content.");
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > LOGO_MAX_BYTES) {
      await reader.cancel();
      throw new Error("The logo file is larger than 4 MB.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function loadLogoBytes(raw: string, options: LogoOptions): Promise<Buffer> {
  if (raw.startsWith("data:image/")) {
    const comma = raw.indexOf(",");
    const body = comma < 0 ? "" : raw.slice(comma + 1);
    return /;base64$/i.test(raw.slice(0, comma)) ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body));
  }
  if (raw.startsWith("aisle-media:")) {
    if (!options.readStored) throw new Error("A stored logo cannot be read here.");
    return (await options.readStored(raw)).bytes;
  }
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    const root = path.resolve(options.publicDir ?? path.join(process.cwd(), "public"));
    const file = path.resolve(root, `.${decodeURIComponent(raw.split(/[?#]/)[0])}`);
    if (file !== root && !file.startsWith(root + path.sep)) throw new Error("The logo path leaves the public folder.");
    return readFile(file);
  }
  return (options.fetchRemote ?? fetchRemoteLogo)(new URL(raw));
}

export async function ingestLogo(logoUrl: string | undefined, options: LogoOptions = {}): Promise<{ logo: LogoAsset | null; gaps: BrandGap[] }> {
  const raw = logoUrl?.trim();
  if (!raw) return { logo: null, gaps: [{ kind: "logo_missing", reason: "The brand has no logo address, so no logo is added to the image." }] };
  let bytes: Buffer;
  try {
    bytes = await loadLogoBytes(raw, options);
  } catch (error) {
    return { logo: null, gaps: [{ kind: "logo_unfetchable", reason: `The brand logo could not be loaded: ${error instanceof Error ? error.message : "unknown error"}` }] };
  }
  if (bytes.length > LOGO_MAX_BYTES) {
    return { logo: null, gaps: [{ kind: "logo_unfetchable", reason: "The brand logo file is larger than 4 MB." }] };
  }
  try {
    const meta = await sharp(bytes, { density: 300 }).metadata();
    const format = meta.format;
    if (!format || !["png", "jpeg", "webp", "gif", "svg"].includes(format) || !meta.width || !meta.height) {
      return { logo: null, gaps: [{ kind: "logo_unreadable", reason: "The brand logo is not a PNG, JPEG, WebP, GIF or SVG image." }] };
    }
    if (meta.width < LOGO_MIN_WIDTH) {
      return { logo: null, gaps: [{ kind: "logo_too_small", reason: `The brand logo is ${meta.width}px wide; at least ${LOGO_MIN_WIDTH}px is needed.` }] };
    }
    return {
      logo: { bytes, mime: `image/${format === "jpeg" ? "jpeg" : format === "svg" ? "svg+xml" : format}`, width: meta.width, height: meta.height, hasAlpha: Boolean(meta.hasAlpha), source: raw },
      gaps: [],
    };
  } catch {
    return { logo: null, gaps: [{ kind: "logo_unreadable", reason: "The brand logo could not be decoded as an image." }] };
  }
}

/* -- all together ------------------------------------------------------ */

export async function ingestBrandInputs(brand: BrandProfile, options: LogoOptions = {}): Promise<BrandInputs> {
  const { logo, gaps: logoGaps } = await ingestLogo(brand.logoUrl, options);
  const { palette, gaps: paletteGaps } = ingestPalette(brand.colors);
  return { logo, palette, style: ingestStyle(brand), gaps: [...logoGaps, ...paletteGaps] };
}
