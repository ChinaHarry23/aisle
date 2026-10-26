import type { Campaign } from '@/lib/types';
import type { Evidence } from '@/lib/runtime/types';
import type { ResearchCategory } from './contracts';

/** These questions describe decisions, not facts about an audience. */
export function campaignResearchQuestions(c: Campaign) {
  return [
    `Which need or use occasion gives ${c.product} a useful message for ${c.targetAudience}?`,
    `Which exact-product attributes can support ${c.objective}, and which belong to another variant?`,
    `How do comparable products position themselves in ${c.country}, and what distinction is defensible?`,
    `What should change between ${c.channels.join(', ')} in message, format and call to action?`,
    `Does ${c.startDate} to ${c.endDate} create a relevant seasonal or regional occasion?`,
  ];
}

const stopWords = new Set('the a an of to for in and or on is are this that with from by at as what which how should can do does campaign research evidence product audience'.split(' '));
const words = (value: string) => [...new Set(value.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter(word => !stopWords.has(word));
const categoryTerms: Record<ResearchCategory, string> = {
  current_market: 'product ingredients features origin specification approval',
  historical_market: 'market demand trend historical growth measurement period',
  customer_interest: 'consumer audience needs interests use occasion survey sample',
  purchase_preference: 'purchase choice preference convenience price value quality survey sample',
  seasonal: 'season seasonal occasion weather demand period month',
  cultural: 'cultural regional event holiday location date',
  channel: 'audience format engagement content email instagram web click reach',
  competitor: 'competitor comparable retailer positioning price offer pack unit date',
};

/** Select complete, contiguous source passages rather than always the page prefix.
 * Scoring only chooses excerpts; it never changes their wording or establishes support. */
export function relevantExcerpt(text: string, question: string, maximum = 2400): string {
  if (text.length <= maximum) return text;
  const terms = words(question);
  const blocks: { text: string; start: number; score: number }[] = [];
  const blockSize = Math.min(650, Math.max(200, Math.floor(maximum / 2)));
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + blockSize);
    if (end < text.length) {
      const boundary = text.lastIndexOf(' ', end);
      if (boundary > start + blockSize / 2) end = boundary;
    }
    const passage = text.slice(start, end);
    const lower = passage.toLowerCase();
    const score = terms.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0)
      + (/\b(survey|sample|respondents|methodology|participants)\b/i.test(passage) ? 1 : 0)
      - (/skip to|cookie|sign in|add to trolley|customers also purchased/i.test(passage) ? 3 : 0);
    blocks.push({ text: passage, start, score });
    start = end;
  }
  const ranked = [...blocks].sort((a, b) => b.score - a.score || a.start - b.start);
  const selected: typeof blocks = [];
  let size = 0;
  for (const block of ranked) {
    const next = size + block.text.length + (selected.length ? 5 : 0);
    if (next > maximum) continue;
    selected.push(block);
    size = next;
  }
  const ordered = selected.sort((a, b) => a.start - b.start);
  return ordered.map((block, index) => {
    const previous = ordered[index - 1];
    return (previous && previous.start + previous.text.length !== block.start ? '\n[…]\n' : '') + block.text;
  }).join('');
}

export function evidenceExcerpt(e: Evidence, c?: Campaign, maximum = 1100): string {
  // A measured summary loses its meaning when prose passage selection splits its
  // JSON. Keep the compact deterministic Trends summary intact in every stage.
  if (e.sourceName === 'SerpApi Google Trends' && e.detail.length <= 3000) {
    try {
      const data = JSON.parse(e.detail);
      if (data.summary || data.relatedQueries) return e.detail;
    } catch { /* Older saved evidence may contain truncated provider JSON. */ }
  }
  const category = e.research?.category ?? 'current_market';
  return relevantExcerpt(e.detail, [c?.product, c?.category, categoryTerms[category], e.research?.channel, e.research?.queryScope].filter(Boolean).join(' '), maximum);
}

/** One URL may be relevant to several areas, but repeating its text adds no evidence. */
export function researchEvidenceContext(evidence: Evidence[], c: Campaign) {
  const byUrl = new Map<string, Evidence[]>();
  for (const e of evidence) {
    if (!e.research) continue;
    const key = e.sourceRef || e.id;
    const rows = byUrl.get(key) ?? [];
    if (!rows.some(row => row.id === e.id)) rows.push(e);
    byUrl.set(key, rows);
  }
  const groups = [...byUrl.values()].sort((a, b) => Number(a.every(e => e.research?.quality === 'snippet')) - Number(b.every(e => e.research?.quality === 'snippet')));
  const selected: Evidence[][] = [];
  const covered = new Set<string>();
  const area = (e: Evidence) => `${e.research?.category}:${e.research?.channel ?? ''}`;
  // Search order must not let five early market results crowd later channels out.
  for (const rows of groups) {
    if (rows.every(e => covered.has(area(e)))) continue;
    selected.push(rows);
    rows.forEach(e => covered.add(area(e)));
  }
  for (const rows of groups) if (selected.length < 18 && !selected.includes(rows)) selected.push(rows);
  return selected.slice(0, 18).map(rows => {
    const best = [...rows].sort((a, b) => Number(a.research?.quality === 'snippet') - Number(b.research?.quality === 'snippet') || b.detail.length - a.detail.length)[0];
    return { id: best.id, source: best.sourceRef, date: best.observedAt, quality: best.research?.quality,
      areas: rows.map(e => ({ evidenceId: e.id, category: e.research?.category, channel: e.research?.channel })),
      excerpt: evidenceExcerpt(best, c, 1000) };
  });
}

export function unreadResearchSources(evidence: Evidence[], c: Campaign) {
  const read = new Set(evidence.filter(e => e.research && e.research.quality !== 'snippet').map(e => e.sourceRef));
  const unique = new Map<string, Evidence>();
  for (const e of evidence) {
    if (e.research?.quality !== 'snippet' || read.has(e.sourceRef)) continue;
    const previous = unique.get(e.sourceRef);
    if (!previous || e.detail.length > previous.detail.length) unique.set(e.sourceRef, e);
  }
  return [...unique.values()].sort((a, b) => {
    const relevance = (e: Evidence) => words(`${c.product} ${categoryTerms[e.research!.category]}`).filter(word => e.detail.toLowerCase().includes(word)).length;
    return relevance(b) - relevance(a);
  }).slice(0, 10).map(e => ({ category: e.research!.category, channel: e.research!.channel, url: e.sourceRef, evidenceId: e.id,
    preview: evidenceExcerpt(e, c, 300) }));
}

type TrendRow = { date?: unknown; timestamp?: unknown; values?: unknown; isPartial?: unknown; is_partial?: unknown };
type TrendPeriod = { start: string; end: string };
const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function calendarDate(year: number, month: number, day: number) {
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
  return date === `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` ? date : null;
}
/** Provider timestamps identify period starts, not ends. Read the displayed
 * interval before deciding whether a weekly/monthly observation is complete. */
function trendPeriod(label: string): TrendPeriod | null {
  const text = label.replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s+/g, ' ').trim();
  const interval = text.match(/^(\d{4}-\d{2}-\d{2})\s+-\s+(\d{4}-\d{2}-\d{2})$/);
  if (interval) {
    const start = trendPeriod(interval[1])?.start, end = trendPeriod(interval[2])?.end;
    return start && end && start <= end ? { start, end } : null;
  }
  const iso = text.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (iso) {
    const year = Number(iso[1]), month = Number(iso[2] ?? 1), day = Number(iso[3] ?? 1);
    const start = calendarDate(year, month, day);
    if (!start) return null;
    const end = iso[3] ? start : new Date(Date.UTC(year, iso[2] ? month : 12, 0)).toISOString().slice(0, 10);
    return { start, end };
  }
  const range = text.match(/^([A-Za-z]+) (\d{1,2})(?:,? (\d{4}))?\s*-\s*(?:([A-Za-z]+) )?(\d{1,2}),? (\d{4})$/);
  if (range) {
    const startMonth = months.indexOf(range[1].slice(0, 3).toLowerCase()) + 1;
    const endMonth = range[4] ? months.indexOf(range[4].slice(0, 3).toLowerCase()) + 1 : startMonth;
    const endYear = Number(range[6]);
    const startYear = range[3] ? Number(range[3]) : endYear - Number(startMonth > endMonth);
    const start = calendarDate(startYear, startMonth, Number(range[2]));
    const end = calendarDate(endYear, endMonth, Number(range[5]));
    return start && end && start <= end ? { start, end } : null;
  }
  const named = text.match(/^([A-Za-z]+)(?: (\d{1,2}),?)? (\d{4})$/);
  if (!named) return null;
  const month = months.indexOf(named[1].slice(0, 3).toLowerCase()) + 1, year = Number(named[3]);
  const start = calendarDate(year, month, Number(named[2] ?? 1));
  return start ? { start, end: named[2] ? start : new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) } : null;
}

/** Compact measurements from dated, completed periods. The current calendar day
 * is unfinished even if the provider omits its partial flag. Unknown intervals
 * are excluded explicitly; a timestamp alone never implies a daily observation. */
export function summarizeTrendSeries(rows: unknown[], asOf: string) {
  const asOfTime = Date.parse(asOf), asOfDate = Number.isFinite(asOfTime) ? new Date(asOfTime).toISOString().slice(0, 10) : null;
  if (!asOfDate) return null;
  const excluded = { partial: 0, incomplete: 0, unknownPeriod: 0, invalid: 0 };
  const partial = (value: unknown) => value === true || value === 'true';
  const points = rows.flatMap(raw => {
    const row = raw as TrendRow;
    if (!row || typeof row !== 'object' || !Array.isArray(row.values)) { excluded.invalid++; return []; }
    const observation = row.values[0] as { extracted_value?: unknown; value?: unknown; isPartial?: unknown; is_partial?: unknown } | undefined;
    if (partial(row.isPartial) || partial(row.is_partial) || partial(observation?.isPartial) || partial(observation?.is_partial)) { excluded.partial++; return []; }
    if (!observation) { excluded.invalid++; return []; }
    const rawValue = observation.extracted_value ?? observation.value;
    if (typeof rawValue !== 'number' && (typeof rawValue !== 'string' || !/^\d+(?:\.\d+)?$/.test(rawValue))) { excluded.invalid++; return []; }
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0 || value > 100) { excluded.invalid++; return []; }
    const period = typeof row.date === 'string' ? trendPeriod(row.date) : null;
    if (!period) { excluded.unknownPeriod++; return []; }
    if (period.end >= asOfDate) { excluded.incomplete++; return []; }
    return [{ period: row.date as string, value, informationDate: period.start, periodEnd: period.end }];
  }).sort((a, b) => a.informationDate.localeCompare(b.informationDate));
  if (!points.length) return null;
  const mean = (items: typeof points) => Math.round(items.reduce((sum, point) => sum + point.value, 0) / items.length * 10) / 10;
  const window = Math.min(4, Math.floor(points.length / 2));
  const recent = window ? mean(points.slice(-window)) : null;
  const previous = window ? mean(points.slice(-window * 2, -window)) : null;
  return {
    periods: points.length, firstPeriod: points[0].period, lastPeriod: points.at(-1)!.period,
    latestInformationDate: points.at(-1)!.informationDate, latestCompletePeriodEnd: points.at(-1)!.periodEnd,
    asOfDate, excludedPeriods: excluded, meanIndex: mean(points),
    nonZeroPeriods: points.filter(point => point.value > 0).length,
    peak: points.reduce((best, point) => point.value > best.value ? point : best),
    comparison: window ? { periodsPerWindow: window, previousMeanIndex: previous, recentMeanIndex: recent, changeInIndexPoints: Math.round((recent! - previous!) * 10) / 10 } : null,
    recentPeriods: points.slice(-8).map(({ period, value }) => ({ period, value })),
    limitation: 'Normalized search interest, not search volume, sales or purchase preference. Zero can mean insufficient interest. Only dated periods ending before the as-of day are included; partial, unfinished and unknown intervals are excluded. Windows describe this series only.',
  };
}
