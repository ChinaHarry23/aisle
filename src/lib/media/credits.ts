/**
 * Credits for a render on the owner's provider key: hold the worst case first,
 * then settle what the provider billed. A key typed in the browser pays the
 * provider directly and never comes here.
 */
import { holdCredits, releaseHold, settleHold, type BillingContext, type Hold } from "@/lib/billing/meter";
import { mediaHoldUsd } from "./estimate";
import { ProviderError } from "./providers/http";
import type { GenerateRequest, MediaModel } from "./types";

export type MediaHold = { hold: Hold; quoteUsd: number; model: MediaModel; label: string };

/** Reserve credits for one render, or say why it cannot go out on the owner's key. */
export async function holdMediaCredits(
  billing: BillingContext | undefined,
  model: MediaModel,
  req: GenerateRequest,
  label: string,
): Promise<MediaHold | { refused: string }> {
  const quoteUsd = mediaHoldUsd(model, req);
  // A malformed request must never quote to nothing and render for free.
  if (!Number.isFinite(quoteUsd) || quoteUsd <= 0) return { refused: "This render could not be priced, so it was skipped." };
  let hold: Hold | null;
  try {
    hold = await holdCredits(billing, quoteUsd);
  } catch (err) {
    // The ledger is unreachable: fail closed rather than render unmetered.
    console.error("[credits] media hold failed", err);
    return { refused: "Credits could not be checked, so the render was skipped." };
  }
  if (!hold) {
    return {
      refused: billing ? "Out of credits — subscribe on Billing to render on Aisle's key." : "No account to bill, so the render was skipped.",
    };
  }
  return { hold, quoteUsd, model, label };
}

/** Charge what the provider billed and return the rest of the hold. */
export async function settleMediaCredits(held: MediaHold, costUsd: number) {
  await settleHold(held.hold, costUsd, { modelId: held.model.id, note: `${held.model.name} · ${held.label}` }).catch((err) =>
    console.error("[credits] media settle failed", err),
  );
}

/**
 * The render failed. When the provider had already billed it (a billable
 * ProviderError), the quote is charged; otherwise the whole hold goes back.
 */
export async function failMediaCredits(held: MediaHold, error: unknown) {
  if (error instanceof ProviderError && error.billable) return settleMediaCredits(held, held.quoteUsd);
  await releaseHold(held.hold).catch((err) => console.error("[credits] media release failed", err));
}
