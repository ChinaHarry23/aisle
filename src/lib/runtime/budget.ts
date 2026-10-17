import type { Campaign } from "../types";

export function defaultSpendCap(campaign: Pick<Campaign, "budget" | "spendCapUsd">) {
  if (typeof campaign.spendCapUsd === "number" && campaign.spendCapUsd > 0) {
    return campaign.spendCapUsd;
  }
  return Math.max(5, Math.min(50, Math.round(campaign.budget * 0.002 * 100) / 100));
}
