import type { Campaign } from '@/lib/types';
import { briefCandidateSchema, type BriefCandidate, type StructuredTrendBrief } from './brief-contracts';
import { requiredBriefSections, sectionCategories, sectionResearch } from './brief-sections';
import { contextVersion } from './quality-contracts';
import { rankFindings } from './ranking';
import { currentStrategy } from './strategy';

const bounded = (value:string) => value.slice(0, 800);
const normalized = (value:string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
const containsQuote = (detail:string, quote:string) => normalized(detail).includes(normalized(quote));
const fingerprint = (value:unknown) => {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
};

/** The detailed report is a projection of the reviewed ledger and current
 * strategy. It needs no second model to rewrite facts or invent an audit. */
export function assembleStrategyReport(c:Campaign, at:string):StructuredTrendBrief {
  const q = c.trendQuality, strategy = currentStrategy(c), errors:string[] = [];
  if (!strategy) errors.push('Campaign strategy does not match the current research and campaign context.');
  if (!q || q.contextVersion !== contextVersion(c) || q.runId !== (c.run?.id ?? 'unlaunched')) errors.push('Quality review does not match the current campaign context and run.');
  const findings = structuredClone(q?.findings ?? []);
  const accepted = new Set(q?.evidence.filter(r => r.accepted && c.evidence.some(e => e.id === r.id && e.origin !== 'synthetic')).map(r => r.id) ?? []);
  const supports = findings.filter(f => f.supported).flatMap(f => f.supports.filter(s => accepted.has(s.evidenceId)
    && f.usableEvidenceIds.includes(s.evidenceId)
    && c.evidence.some(e => e.id === s.evidenceId && containsQuote(e.detail, s.quote)))
    .map(s => ({findingId:f.id, ...s})));
  // Retain at least one exact citation for every supported finding before
  // filling the remaining schema space with corroborating excerpts.
  const firstSupports = findings.flatMap(f => supports.find(s => s.findingId === f.id) ?? []);
  const firstKeys = new Set(firstSupports.map(s => JSON.stringify(s)));
  const substantiation = [...firstSupports, ...supports.filter(s => !firstKeys.has(JSON.stringify(s)))].slice(0, 100);
  for (const f of findings.filter(f => f.supported)) if (!substantiation.some(s => s.findingId === f.id)) errors.push(`Reviewed finding has no available exact source excerpt: ${f.id}.`);
  const supportedIds = new Set(findings.filter(f => f.supported && substantiation.some(s => s.findingId === f.id)).map(f => f.id));
  const insights = strategy?.insights.filter(i => i.basis !== 'hypothesis' && i.findingIds.length > 0 && i.findingIds.every(id => supportedIds.has(id))) ?? [];
  const ranking=strategy?.ranking??rankFindings(c);
  const prioritisedFindingIds = ranking.rows.map(r=>r.findingId);
  const related = (id:string, area:string, channel:string|null) => findings.find(f => f.id === id)?.supports.some(s =>
    c.evidence.some(e => e.id === s.evidenceId && e.research?.category === area && (!channel || e.research.channel === channel)));
  const direction = (prefix:string, insight:typeof insights[number], text:string) => ({
    id:`strategy-${prefix}-${insight.id}`, text:bounded(text), basedOnFindingIds:insight.findingIds,
    rationale:bounded([insight.implication, insight.limitation].filter(Boolean).join(' ')),
  });
  const candidate:BriefCandidate|null = !strategy || !q ? null : {
    sections:requiredBriefSections(c).map(section => {
      const area = sectionResearch[section.key];
      const findingIds = prioritisedFindingIds.filter(id => {
        const f = findings.find(f => f.id === id)!;
        return sectionCategories[section.key].includes(f.category) && (!area || related(id, area, section.channel));
      });
      const areaReview = q.researchAreas.find(a => a.category === area && (!section.channel || a.channel === section.channel));
      const available = area ? Boolean(areaReview?.supported) : findingIds.some(id => supportedIds.has(id));
      return {...section, findingIds, unavailableReason:available ? '' : bounded(areaReview?.reason ?? 'No supported observation was established for this subject. The available findings still inform the campaign direction.')};
    }),
    prioritisedFindingIds, substantiation,
    relevance:findings.map(f => ({findingId:f.id,
      product:bounded(`Campaign product: ${c.product}. ${f.relevance}`),
      audience:bounded(`Campaign audience: ${c.targetAudience}. Source findings retain their stated population and scope.`),
      objective:bounded(`Campaign objective: ${c.objective}. This observation is context for creative choices, not a promised campaign result.`),
      timing:bounded(`Campaign window: ${c.startDate} to ${c.endDate}. Source observation dates are retained with each citation.`),
      country:bounded(`Campaign market: ${c.country}. ${f.limitation || 'Apply the finding within the geography assessed in the source review.'}`),
      channels:bounded(`Selected channels: ${c.channels.join(', ')}. Channel-specific observations are listed in the matching section.`),
      budget:bounded(`Campaign budget: ${c.budget}. This report does not infer advertising performance or change the budget.`),
      priorityReason:bounded((ranking.rows.find(r=>r.findingId===f.id)?.reason??'')+' '+insights.filter(i => i.findingIds.includes(f.id)).map(i => i.application).join(' ') || (f.supported ? f.relevance : f.reasons.join(' ') || 'Retained for transparency; not used as an established fact.')),
    })),
    inferences:insights.map(i => direction('inference', i, i.implication)),
    themes:insights.map(i => direction('theme', i, i.application)),
    visualDirections:strategy.concepts.flatMap(concept => {
      const bases = concept.insightIds.map(id => insights.find(i => i.id === id));
      // A mixed research/hypothesis concept stays in the strategy view, where
      // its basis is labelled. Do not relabel its visual as a research result.
      if (!bases.length || bases.some(i => !i)) return [];
      return [{id:`strategy-visual-${concept.id}`, text:bounded(concept.visualDirection),
        basedOnFindingIds:[...new Set(bases.flatMap(i => i!.findingIds))].slice(0, 10),
        rationale:bounded(`Creative application of the cited observations: ${concept.angle}`)}];
    }),
    limitations:[...new Set([...q.limitations, ...strategy.limitations])].map(bounded).filter(Boolean).slice(0, 40),
  };
  const checked = briefCandidateSchema.safeParse(candidate);
  if (!checked.success) errors.push('Deterministic report could not represent the reviewed research: '+checked.error.issues.map(i => i.path.join('.')+': '+i.message).join('; '));
  const cited = new Set([...substantiation.map(s => s.evidenceId), ...(q?.assessment?.areas.filter(a => q.researchAreas.some(r => r.category === a.category && (a.category !== 'channel' || r.channel === a.channel) && r.supported)).flatMap(a => a.supports.filter(s => c.evidence.some(e => e.id === s.evidenceId && containsQuote(e.detail, s.quote))).map(s => s.evidenceId)) ?? [])]);
  const sources = c.evidence.filter(e => cited.has(e.id) && accepted.has(e.id)).map(e => ({evidenceId:e.id, name:e.sourceName, ref:e.sourceRef, informationDate:e.observedAt, retrievedAt:e.fetchedAt}));
  const limitations = [...new Set([...(q?.limitations ?? []), ...(strategy?.limitations ?? []), ...errors])];
  const previousAdvice = c.sharedContext.previousAdvice ?? null;
  return {
    format:'strategy-v1', ranking, strategyVersion:strategy?.version, sourceFingerprint:strategy?.sourceFingerprint,
    briefId:c.id+':'+(c.run?.id ?? 'unlaunched')+':brief', campaignId:c.id, runId:c.run?.id ?? 'unlaunched',
    contextVersion:contextVersion(c), version:q?.version ?? 0, qualityVersion:q?.version ?? 0, generatedAt:at,
    status:!errors.length && q?.status === 'COMPLETE' ? 'COMPLETE' : 'INCOMPLETE',
    validation:errors.length ? 'failed' : 'passed', errors,
    modelStatus:'Deterministic projection of reviewed research and campaign strategy; no additional model or independent semantic audit.',
    candidate, audit:null, findings, sources, limitations, previousAdvice,
    supportReviewFingerprint:fingerprint([strategy, q?.version, candidate, findings, sources, limitations, previousAdvice]),
  };
}

export function strategyReportMatches(c:Campaign, report:StructuredTrendBrief):boolean {
  if (report.format !== 'strategy-v1' || report.validation !== 'passed' || !currentStrategy(c)) return false;
  const expected = assembleStrategyReport(c, report.generatedAt);
  return expected.validation === 'passed' && JSON.stringify(report) === JSON.stringify(expected);
}
