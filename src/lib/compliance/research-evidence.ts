import type { Campaign } from '@/lib/types';
import { strategyFindings } from '@/lib/trend/strategy';
import { evidenceExcerpt } from '@/lib/trend/retrieval-context';

const normalized = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** Reuse the research already paid for when reviewing product claims. These are
 * source observations and qualifications, not an approved-claims list or law. */
export function complianceResearchEvidence(c: Campaign, copy: string) {
  const terms = [...new Set(normalized(copy).match(/[\p{L}\p{N}]{4,}/gu) ?? [])];
  const reviewed = strategyFindings(c);
  const ranked = reviewed.map(finding => ({ finding, score:
    (finding.category === 'RISK' ? 40 : finding.category === 'MARKET' ? 20 : 0)
    + terms.filter(term => normalized(finding.claim).includes(term)).length,
  })).sort((a, b) => b.score - a.score);
  const sources = new Map<string, Campaign['evidence'][number]>();
  const findings = ranked.slice(0, 6).flatMap(({ finding }) => {
    // Check retained quotes against the current ledger as well as its review.
    // A later source edit must not turn an old finding into substantiation.
    const supports = finding.supports.filter(support => {
      const source = c.evidence.find(e => e.id === support.evidenceId);
      return source && finding.usableEvidenceIds.includes(source.id)
        && source.origin !== 'synthetic' && source.research?.quality !== 'snippet'
        && (source.status === 'verified' || source.status === 'conflicting')
        && normalized(source.detail).includes(normalized(support.quote));
    });
    if (!supports.length) return [];
    const selected = supports.slice(0, 3);
    for (const support of selected) sources.set(support.evidenceId, c.evidence.find(e => e.id === support.evidenceId)!);
    return [{
      id: finding.id, category: finding.category, observation: finding.claim,
      relevance: finding.relevance, limitation: finding.limitation,
      conflict: finding.conflict, supports: selected,
      omittedSupports: supports.length - selected.length,
    }];
  });
  return {
    product: c.product, country: c.country,
    campaignPeriod: { start: c.startDate, end: c.endDate },
    reviewVersion: findings.length ? c.trendQuality!.version : null,
    assessedAt: findings.length ? c.trendQuality!.assessedAt : null,
    findings,
    sources: [...sources.values()].map(source => ({
      id: source.id, name: source.sourceName, url: source.sourceRef,
      informationDate: source.observedAt, dateBasis: source.dateBasis ?? 'unknown',
      fetchedAt: source.fetchedAt, coverage: source.coverage,
      geography: source.research?.geography, sourceKind: source.sourceKind,
      excerpt: evidenceExcerpt(source, c, 700),
    })),
    omittedFindings: reviewed.length - findings.length,
  };
}
