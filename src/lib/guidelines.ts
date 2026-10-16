import type { BrandProfile, GuidelineDoc } from "./types";

export const MAX_GUIDELINE_FILES = 8;
export const MAX_GUIDELINE_BYTES = 5 * 1024 * 1024;
/** Stored per document; longer files are cut and flagged. */
export const MAX_GUIDELINE_CHARS = 40_000;
/** Shared across all documents in one agent prompt. */
const PROMPT_BUDGET_CHARS = 12_000;

export const GUIDELINE_ACCEPT = ".pdf,.docx,.txt,.md,.csv,.json";

/** Guideline text as a prompt section, or "" when nothing was uploaded. */
export function guidelinesPrompt(brand: BrandProfile): string {
  const docs = brand.guidelines ?? [];
  if (docs.length === 0) return "";
  const each = Math.floor(PROMPT_BUDGET_CHARS / docs.length);
  const body = docs
    .map((d) => `--- ${d.name} ---\n${d.text.slice(0, each)}${d.text.length > each ? "\n[…cut]" : ""}`)
    .join("\n\n");
  return `Brand guidelines supplied by the retailer. Follow them; flag anything that breaks them as a brand_guideline issue:\n${body}`;
}

export function toGuidelineDoc(name: string, size: number, rawText: string): GuidelineDoc {
  const text = rawText.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return {
    id: `gd_${Math.random().toString(36).slice(2, 10)}`,
    name,
    size,
    uploadedAt: new Date().toISOString(),
    text: text.slice(0, MAX_GUIDELINE_CHARS),
    truncated: text.length > MAX_GUIDELINE_CHARS,
  };
}
