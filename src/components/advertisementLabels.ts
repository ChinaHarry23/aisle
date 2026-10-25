export const advertisementLetter = (index: number) => String.fromCharCode(65 + index);

export function excerptExplainer(ads: { creativeId: string; headline: string }[]) {
  const labels = new Map(ads.map((ad, i) => [ad.creativeId, `Advertisement ${advertisementLetter(i)} — ${ad.headline}`]));
  return (excerpt: string) => labels.get(excerpt) ?? excerpt;
}
