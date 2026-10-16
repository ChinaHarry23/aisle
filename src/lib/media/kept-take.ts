/**
 * A cloud take that finished (and was charged) but could not be attached to
 * its campaign: the draft was approved meanwhile, or its source poster changed.
 *
 * The charge stands and nothing is refunded. The provider was paid, and the
 * take stays downloadable from the owner-checked download route, so a refund
 * here would make every render free (start a video, change the poster, download
 * the take anyway). The user keeps both the charge and the take.
 */
import { isUnlimited, type BillingContext } from "@/lib/billing/meter";
import { milliForCost, MILLI } from "@/lib/billing/plan";
import { isStoredMediaUrl, STORED_PREFIX } from "./store";
import type { GenerateResult, MediaKind } from "./pr2-types";

/** Credits (milli) a finished take charged this context: nothing for local, dev or unmetered runs. */
export function chargedMilliFor(billing: BillingContext | undefined, generation: GenerateResult): number {
  if (billing?.kind !== "user" || isUnlimited(billing)) return 0;
  if (generation.status !== "ok" || generation.provider === "ComfyUI" || !(generation.usage.costUsd > 0)) return 0;
  return milliForCost(generation.usage.costUsd);
}

/** The app's own download link for a stored take (the route checks the owner), or undefined. */
export function keptTakeUrl(generation: GenerateResult, kind: MediaKind): string | undefined {
  return isStoredMediaUrl(generation.url)
    ? `/api/studio/download?media=${generation.url.slice(STORED_PREFIX.length)}&kind=${kind}`
    : undefined;
}

/** What the Studio tells the user about a take it could not attach, and where to download it. */
export function keptTake(
  billing: BillingContext | undefined,
  generation: GenerateResult,
  kind: MediaKind,
  reason: string,
): { message: string; chargedCredits: number; downloadUrl?: string } {
  const chargedCredits = chargedMilliFor(billing, generation) / MILLI;
  const downloadUrl = keptTakeUrl(generation, kind);
  const why = reason.trim().replace(/[.\s]+$/, "") || "saving failed";
  // "Media can only…" reads as "because media can only…"; an acronym ("ComfyUI …") keeps its case.
  const because = /^[A-Z][a-z]*(?![A-Za-z])/.test(why) ? `${why.charAt(0).toLowerCase()}${why.slice(1)}` : why;
  const charged = chargedCredits
    ? `Charged ${chargedCredits.toLocaleString("en-US", { maximumFractionDigits: 1 })} credits. `
    : "";
  const message = `${charged}The take could not be attached because ${because}${downloadUrl ? "; download it here." : "."}`;
  return { message, chargedCredits, ...(downloadUrl ? { downloadUrl } : {}) };
}
