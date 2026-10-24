import type { Campaign } from "@/lib/types";

type Advertisement = { creativeId: string; headline: string };

export function advertisementLabel(index: number, headline: string) {
  let ordinal = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    ordinal = String.fromCharCode(65 + (n - 1) % 26) + ordinal;
  }
  return `Advertisement ${ordinal}${headline.trim() ? ` — ${headline.trim()}` : ""}`;
}

/** Resolve against the reviewed snapshot, never against a newer draft. */
export function reviewedAdvertisements(campaign: Campaign, version: number): Advertisement[] {
  const run = [...(campaign.complianceReviewRuns ?? [])].reverse()
    .find(item => item.submission.version === version);
  return run?.submission.content ?? campaign.creatives
    .filter(item => item.version === version)
    .map(item => ({ creativeId: item.id, headline: item.headline }));
}

/** Legacy findings encode the reference as either an ID or "ID: quoted text". */
export function excerptFormatter(advertisements: readonly Advertisement[]) {
  const labels = new Map(advertisements.map((ad, index) =>
    [ad.creativeId, advertisementLabel(index, ad.headline)]));
  return (excerpt: string): string => {
    const value = excerpt.trim();
    const exact = labels.get(value);
    if (exact) return exact;
    for (const [id, label] of labels) {
      if (!id || !value.startsWith(id)) continue;
      const suffix = value.slice(id.length);
      if (/^\s*[:：]/u.test(suffix)) return `${label}${suffix}`;
    }
    // Deleted legacy creatives may no longer have a saved snapshot. Do not
    // invent a title or borrow one from the current version.
    const missingReference = /^cr_[a-zA-Z0-9_-]+(?=\s*[:：]|$)/u;
    if (missingReference.test(value)) {
      return value.replace(missingReference, "Advertisement (reviewed content unavailable)");
    }
    return excerpt;
  };
}
