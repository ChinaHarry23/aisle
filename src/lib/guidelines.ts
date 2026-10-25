import type { BrandProfile } from "./types";

/** Shared across all documents in one agent prompt. */
const PROMPT_BUDGET_CHARS = 12_000;

/** Guideline text as a prompt section, or "" when nothing was uploaded. */
export function guidelinesPrompt(brand: BrandProfile): string {
  const docs = brand.guidelines ?? [];
  if (docs.length === 0) return "";
  const each = Math.floor(PROMPT_BUDGET_CHARS / docs.length);
  const body = docs
    .map((d) => `--- ${d.name} ---\n${d.text.slice(0, each)}${d.text.length > each ? "\n[…cut]" : ""}`)
    .join("\n\n");
  return `Advertising-law and regulation documents uploaded on Brand. Flag poster words only when a passage here gives a reason:\n${body}`;
}
