import { z } from 'zod';
import type { Campaign } from '@/lib/types';

/** Marker so a seasonality call is distinct from a tool-using research turn. */
export const SEASONALITY_TASK = 'Product seasonality judgement';

export const seasonalityJudgementSchema = z.object({
  seasonal: z.boolean(),
  reason: z.string().trim().min(12).max(500),
});
export type SeasonalityJudgement = z.infer<typeof seasonalityJudgementSchema>;

export function readSeasonalityJudgement(text: string | null | undefined): SeasonalityJudgement | null {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = seasonalityJudgementSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function seasonalityPrompt(c: Pick<Campaign, 'product' | 'category' | 'targetAudience' | 'country' | 'startDate' | 'endDate'>): { system: string; prompt: string } {
  return {
    system: 'You judge whether a retail product has a seasonal demand or use pattern worth researching. seasonal is true only when shopper demand, availability, or the normal use occasion changes meaningfully by season. Year-round staples such as fresh chicken breast, milk, eggs, bread and rice are seasonal false. Harvest foods, holiday goods, weather-dependent apparel and products whose main occasion is a season are seasonal true. Campaign dates alone do not make a staple seasonal. reason is one or two sentences a founder can read, naming the product. Do not invent sales, prices or sources. Return only a JSON object {"seasonal":boolean,"reason":string}.',
    prompt: `${SEASONALITY_TASK}\nProduct: ${c.product}\nCategory: ${c.category}\nAudience: ${c.targetAudience}\nCountry: ${c.country}\nCampaign window: ${c.startDate} to ${c.endDate}`,
  };
}

/** Keep the founder's explanation when seasonal research was intentionally not run. */
export function applySeasonalityWaiver(c: Campaign): void {
  const judgement = c.seasonalityJudgement;
  if (!judgement || judgement.seasonal || judgement.reason.trim().length < 12) return;
  const reason = judgement.reason.trim();
  for (const area of c.researchCoverage ?? []) {
    if (area.category !== 'seasonal') continue;
    area.limitation = reason;
    area.analysis = {
      category: 'seasonal',
      summary: reason,
      evidenceIds: [],
      limitation: 'Seasonal trend research was not run because this product has no meaningful seasonal pattern.',
    };
  }
}
