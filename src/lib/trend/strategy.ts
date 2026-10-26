/** Campaign-facing strategy. Pure data helpers: safe to use in the report UI. */
import { z } from 'zod';
import type { Campaign, Channel } from '@/lib/types';
import { contextVersion } from './quality-contracts';

const text = z.string().trim().min(1).max(700);
const ids = z.array(z.string().min(1).max(100)).max(6);
export const strategyDraftSchema = z.object({
  recommendedAngle: text,
  audienceMotivation: text,
  keyMessage: text,
  visualDirection: text,
  alternativeConcept: text,
  insights: z.array(z.object({
    id: z.string().min(1).max(100), title: text, implication: text, application: text,
    findingIds: ids, basis: z.enum(['research', 'hypothesis', 'constraint']),
    limitation: z.string().max(700),
  }).strict()).min(1).max(5),
  channels: z.array(z.object({
    channel: z.enum(['instagram', 'web', 'email', 'print', 'digital_signage']),
    approach: text, format: text, cta: text, insightIds: ids,
  }).strict()).max(5),
  concepts: z.array(z.object({
    id: z.string().min(1).max(100), name: text, angle: text,
    headlineDirection: text, visualDirection: text, insightIds: ids,
  }).strict()).min(2).max(2),
  limitations: z.array(text).max(8),
}).strict();

export type StrategyDraft = z.infer<typeof strategyDraftSchema>;
export type StrategyInsight = StrategyDraft['insights'][number] & {
  observation: string;
  evidenceIds: string[];
  confidence: 'high' | 'moderate' | 'exploratory';
};
export type CampaignStrategy = Omit<StrategyDraft, 'insights' | 'channels'> & {
  version: number;
  contextVersion: string;
  runId: string;
  generatedAt: string;
  status: 'research_led' | 'mixed' | 'product_led';
  insights: StrategyInsight[];
  channels: (Omit<StrategyDraft['channels'][number], 'channel'> & { channel: Channel })[];
  modelStatus: string;
  sourceFingerprint: string;
};

/** Changes to reviewed sources or campaign scope invalidate reuse, not API retries. */
export function strategyFingerprint(c: Campaign): string {
  const input = JSON.stringify([
    contextVersion(c), c.run?.id, c.notes, c.sharedContext.brandTone,
    c.trendQuality?.findings, c.trendQuality?.evidence,
    c.evidence.map(e => [e.id, e.detail, e.observedAt, e.sourceRef, e.origin]),
    c.sharedContext.previousAdvice, c.sharedContext.founderNotes,
  ]);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

export function currentStrategy(c: Campaign): CampaignStrategy | null {
  const strategy = c.strategy;
  return strategy && strategy.contextVersion === contextVersion(c) && strategy.runId === (c.run?.id ?? 'unlaunched')
    && strategy.sourceFingerprint === strategyFingerprint(c) ? strategy : null;
}

/** Findings available for strategic interpretation; source facts retain their original wording. */
export function strategyFindings(c: Campaign) {
  if (c.trendQuality?.contextVersion !== contextVersion(c) || c.trendQuality.runId !== (c.run?.id ?? 'unlaunched')) return [];
  return (c.trendQuality?.findings ?? []).filter(f => f.supported && f.usableEvidenceIds.length > 0
    && f.usableEvidenceIds.every(id => c.trendQuality!.evidence.some(e => e.id === id && e.accepted)
      && c.evidence.some(e => e.id === id && e.origin !== 'synthetic')));
}

export function validateStrategy(c: Campaign, draft: StrategyDraft): string[] {
  const errors: string[] = [];
  const findings = new Set(strategyFindings(c).map(f => f.id));
  const insightIds = new Set(draft.insights.map(i => i.id));
  if (findings.size && !draft.insights.some(i => i.findingIds.length)) errors.push('Apply at least one useful reviewed finding to the campaign direction.');
  if (insightIds.size !== draft.insights.length) errors.push('Each insight needs a unique id.');
  for (const insight of draft.insights) {
    if (insight.findingIds.some(id => !findings.has(id))) errors.push(`Insight ${insight.id} cites an unavailable finding.`);
    if (insight.basis === 'research' && !insight.findingIds.length) errors.push(`Insight ${insight.id} needs a finding, or must be a creative hypothesis.`);
    if (insight.basis === 'hypothesis' && insight.findingIds.length) errors.push(`Insight ${insight.id} must distinguish observed research from a hypothesis.`);
  }
  for (const channel of c.channels) if (draft.channels.filter(row => row.channel === channel).length !== 1) errors.push(`Include exactly one approach for ${channel}.`);
  if (draft.channels.some(row => !c.channels.includes(row.channel))) errors.push('Only include the selected channels.');
  for (const row of [...draft.channels, ...draft.concepts]) if (row.insightIds.some(id => !insightIds.has(id))) errors.push('Concepts and channel approaches must reference supplied insights.');
  if (new Set(draft.concepts.map(row => row.id)).size !== 2 || draft.concepts[0].angle.toLowerCase() === draft.concepts[1].angle.toLowerCase()) errors.push('Create two distinct campaign concepts.');
  return errors;
}

export function assembleStrategy(c: Campaign, draft: StrategyDraft, at: string, modelStatus: string): CampaignStrategy {
  const findings = strategyFindings(c);
  const insights: StrategyInsight[] = draft.insights.map(insight => {
    const selected = findings.filter(f => insight.findingIds.includes(f.id));
    return {
      ...insight,
      observation: selected.length ? selected.map(f => f.claim).join(' ') : 'Creative proposal based on your campaign brief.',
      evidenceIds: [...new Set(selected.flatMap(f => f.usableEvidenceIds))],
      confidence: selected.length ? selected.every(f => f.confidence === 'high') ? 'high' : 'moderate' : 'exploratory',
      limitation: [...new Set([insight.limitation, ...selected.map(f => f.limitation)].filter(Boolean))].join(' '),
    };
  });
  const researched = insights.filter(i => i.evidenceIds.length).length;
  return {
    ...draft, insights, version: (c.strategy?.version ?? 0) + 1,
    contextVersion: contextVersion(c), runId: c.run?.id ?? 'unlaunched', generatedAt: at,
    status: researched === 0 ? 'product_led' : insights.some(i => i.basis === 'hypothesis') ? 'mixed' : 'research_led',
    modelStatus, sourceFingerprint: strategyFingerprint(c),
  };
}

/** A useful continuation even when a provider is unavailable; never pretends to be market research. */
export function fallbackStrategy(c: Campaign, at: string, modelStatus: string): CampaignStrategy {
  const supported = strategyFindings(c).slice(0, 3);
  const insights: StrategyDraft['insights'] = supported.map((f, i) => ({
    id: `insight-${i + 1}`, title: f.category === 'RISK' ? 'Keep this distinction clear' : 'A finding to build on',
    implication: f.relevance, application: f.category === 'RISK' ? `Account for this limitation in the wording and scene: ${f.claim}` : `Use this finding as context when developing the message for ${c.targetAudience}: ${f.claim}`,
    findingIds: [f.id], basis: f.category === 'RISK' ? 'constraint' : 'research', limitation: f.limitation,
  }));
  insights.push({ id: 'product-story', title: 'Show a relevant use occasion', implication: `Help ${c.targetAudience} picture where ${c.product} fits into their day.`, application: `Make the product recognisable in one concrete use occasion. Test this concept rather than presenting it as an observed audience preference.`, findingIds: [], basis: 'hypothesis', limitation: 'This creative hypothesis comes from the campaign brief.' });
  const visual = `Keep the exact ${c.product} recognisable. Show one clear use occasion for ${c.targetAudience}, with room for a short headline and call to action.`;
  const allIds = insights.map(i => i.id);
  return assembleStrategy(c, {
    recommendedAngle: `${c.product} in an everyday use occasion`,
    audienceMotivation: `Make the relevance of ${c.product} clear to ${c.targetAudience}; the use occasion is a creative hypothesis to test.`,
    keyMessage: `Discover how ${c.product} could fit into your day.`, visualDirection: visual,
    alternativeConcept: `A product-focused introduction to ${c.product}, using only supplied product details.`,
    insights,
    channels: c.channels.map(channel => ({ channel,
      format: channel === 'instagram' ? 'A visual use occasion with a short caption' : channel === 'email' ? 'One idea, a concise subject and one link' : channel === 'web' ? 'A clear product introduction and detail link' : 'One readable headline and product image',
      approach: channel === 'instagram' ? `Show ${c.product} in the chosen use occasion; let the image carry the idea.` : channel === 'email' ? `Introduce one reason to explore ${c.product}, then link to the product details.` : `Explain what ${c.product} is and give the audience a clear next step.`,
      cta: 'Explore the product', insightIds: allIds,
    })),
    concepts: [
      { id: 'concept-a', name: 'In your day', angle: `${c.product} in use`, headlineDirection: 'Lead with the use occasion rather than an unsupported product benefit.', visualDirection: visual, insightIds: allIds },
      { id: 'concept-b', name: 'Meet the product', angle: `A closer look at ${c.product}`, headlineDirection: 'Lead with a clear introduction to the exact product.', visualDirection: `Use a close product composition with its real packaging or supplied reference. Make the product name easy to read.`, insightIds: allIds },
    ],
    limitations: ['Creative proposals are available; the research details show which observations were established.'],
  }, at, modelStatus);
}
