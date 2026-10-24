import type { BrandProfile, Campaign } from '@/lib/types';
import type { WorkspaceSettings } from '@/lib/settings';
import type { ToolOutcome } from '@/lib/runtime/tools';
import type { DecisionTrace, TrendDecision } from '@/lib/runtime/decide';
export const RESEARCH_CATEGORIES = ['current_market', 'historical_market', 'customer_interest', 'purchase_preference', 'seasonal', 'cultural', 'channel', 'competitor'] as const;
export type ResearchCategory = typeof RESEARCH_CATEGORIES[number];
export type ResearchAnalysis = {category: ResearchCategory; channel?: string; summary: string; evidenceIds: string[]; limitation: string};
export type ResearchModelTurn = {turn:number; phase:'collection'|'assessment'|'quality'|'brief'; offeredTools:string[]; selectedTools:string[]; invalidTools?:string[]; status:string; modelId:string; tokens:number};
export type ResearchAttempt = { category: ResearchCategory; channel?: string; tool: string; phase?: 'mandatory' | 'agent' | 'quality'; status: ToolOutcome['status']; summary: string; evidenceIds: string[] };
export type ResearchCoverage = { category: ResearchCategory; channel?: string; evidenceIds: string[]; status: 'retrieved' | 'missing'; attempts: ResearchAttempt[]; analysis?: ResearchAnalysis; limitation: string };
export type ResearchInput = {
  campaign: Campaign; brand: BrandProfile; settings: WorkspaceSettings; at: string;
  allowed: () => Promise<boolean>;
  execute: (name: string, args: Record<string, string>, override?: ToolOutcome) => Promise<ToolOutcome>;
  onFailedUsage: (cost: number) => void;
};
export type ResearchRunner = (input: ResearchInput) => Promise<{ decision: TrendDecision; trace: DecisionTrace } | null>;
export function unavailable(detail: string, status: ToolOutcome['status'] = 'empty'): ToolOutcome {
  return { status, summary: detail, evidence: [], data: null,
    gap: { kind: status === 'skipped' ? 'unauthorised' : 'missing_source', detail, effect: 'No fact inferred. Use another authorised source for the same category or request review.' } };
}
export function sourcePermitted(campaign: Campaign, name: string, defaults: readonly string[]): boolean {
  const allowed = campaign.dataAccessPolicy === undefined ? defaults : campaign.dataAccessPolicy?.externalSources;
  return Array.isArray(allowed) && allowed.includes(name);
}
export function coverageFor(campaign: Campaign, evidence: Campaign['evidence']): ResearchCoverage[] {
  return RESEARCH_CATEGORIES.flatMap(category => (category === 'channel' ? campaign.channels : [undefined]).map(channel => {
    const items = evidence.filter(e => e.status === 'verified' && e.research?.category === category && (!channel || e.research.channel === channel));
    return { category, ...(channel ? {channel} : {}), evidenceIds: items.map(e => e.id), status: items.length ? 'retrieved' as const : 'missing' as const,
      attempts: (campaign.researchAttempts ?? []).filter(a => a.category === category && a.channel === channel),
      limitation: items.length ? 'Retrieved material; relevance, currency and claim support still require assessment.' : 'No source returned for this required research area.' };
  }));
}

/** Every required category gets an independently scoped tool request, including each selected channel. */
export function requiredResearchPlan(campaign: Campaign): {category: ResearchCategory; channel?: string; tool: string; args: Record<string,string>}[] {
  return RESEARCH_CATEGORIES.flatMap(category => (category === 'channel' ? campaign.channels : [undefined]).map(channel => ({
    category, ...(channel ? {channel} : {}),
    tool: category === 'historical_market' || category === 'customer_interest' ? 'web.search_trends' : 'web.search',
    args: (category === 'historical_market' ? {kind:'TIMESERIES'} : category === 'customer_interest' ? {kind:'RELATED_QUERIES'} : {category, ...(channel ? {channel} : {})}) as Record<string,string>,
  })));
}

/** Reject unknown/cross-category citations. Model prose is a draft, never a sufficiency certificate. */
export function attachResearchAnalysis(coverage: ResearchCoverage[], analyses: ResearchAnalysis[] = []): void {
  for (const area of coverage) {
    // Channels distinguish channel-behaviour assessments only. A model may echo
    // the selected campaign channel alongside a general market assessment.
    const matches = analyses.filter(a => a.category === area.category && (area.category !== 'channel' || a.channel === area.channel));
    const candidate = matches.length === 1 ? matches[0] : undefined;
    delete area.analysis;
    if (candidate?.summary.trim() && (candidate.evidenceIds.length || candidate.limitation.trim()) && candidate.evidenceIds.every(id => area.evidenceIds.includes(id))) {
      // A no-citation assessment is a recorded evidence gap, never support.
      area.analysis = {...candidate,channel:area.channel};
    } else {
      area.limitation += ' No uniquely identified, source-cited analysis was returned for this area.';
    }
  }
}
