/**
 * Deciding whether a saved campaign still has agent work to do.
 *
 * Launch finishes the trend brief and returns. The browser is supposed to send
 * the next command immediately. If that request fails, or the page is left
 * before it is saved, the campaign stays `running` on the trend hand-off and
 * nothing on the server keeps going. These helpers let the desk pick that work
 * up again without mistaking a founder gate for a stall.
 */

import { isArchived } from "@/lib/campaign-lifecycle";
import type { Campaign } from "@/lib/types";
import { FOUNDER_WAIT_STEPS } from "./types";

export function campaignCanAdvance(campaign: Campaign): boolean {
  if (isArchived(campaign)) return false;
  const run = campaign.run;
  if (!run || run.status !== "running") return false;
  return !FOUNDER_WAIT_STEPS.has(run.step);
}

function timestamp(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Fold a workspace read into the campaigns already on screen.
 *
 * A campaign the desk is currently sending, or one edited more recently than
 * the copy just fetched, is kept. An idle local campaign the server does not
 * have is dropped, so a delete on another tab stays deleted. Campaigns the
 * server has not seen yet stay only while a command is in flight for them.
 */
export function mergeCampaignLists(
  local: Campaign[],
  remote: Campaign[],
  busy: Record<string, boolean> = {},
): Campaign[] {
  const localById = new Map(local.map((campaign) => [campaign.id, campaign]));
  const seen = new Set<string>();
  const merged: Campaign[] = [];

  for (const incoming of remote) {
    seen.add(incoming.id);
    const here = localById.get(incoming.id);
    if (!here) {
      merged.push(incoming);
      continue;
    }
    const keepLocal = Boolean(busy[incoming.id]) || timestamp(here.updatedAt) > timestamp(incoming.updatedAt);
    merged.push(keepLocal ? here : incoming);
  }

  for (const here of local) {
    if (seen.has(here.id) || !busy[here.id]) continue;
    merged.unshift(here);
  }

  return merged;
}
