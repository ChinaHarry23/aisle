import type { Campaign } from "./types";

/** A campaign the founder has moved to the trash. */
export function isArchived(campaign: { archivedAt?: string | null }): boolean {
  return typeof campaign.archivedAt === "string" && campaign.archivedAt.length > 0;
}

/**
 * Keep founder trash and permanent deletes when another copy of the campaign arrives.
 *
 * `authority` is the founder's copy. A string `archivedAt` sticks. An explicit
 * `null` is a restore. Campaigns in `retired` are gone and are not re-added.
 */
export function retainCampaignLifecycle(
  authority: Campaign[],
  retired: readonly string[],
  incoming: Campaign[],
): Campaign[] {
  const gone = new Set(retired);
  const authorityById = new Map(authority.map((campaign) => [campaign.id, campaign]));
  const seen = new Set<string>();
  const kept: Campaign[] = [];
  for (const campaign of incoming) {
    if (gone.has(campaign.id) || seen.has(campaign.id)) continue;
    seen.add(campaign.id);
    const prior = authorityById.get(campaign.id);
    if (prior?.archivedAt === null) {
      kept.push({ ...campaign, archivedAt: null });
      continue;
    }
    if (isArchived(prior ?? {})) {
      kept.push({ ...campaign, archivedAt: prior!.archivedAt, running: false });
      continue;
    }
    kept.push(campaign);
  }
  return kept;
}
