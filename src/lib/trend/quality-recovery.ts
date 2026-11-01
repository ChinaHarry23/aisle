import { FINDING_CATEGORIES, qualityAssessmentSchema, type FindingCategory, type QualityAssessment } from './quality-contracts';

type Section = keyof QualityAssessment;
export type InvalidQualityItem = { section: Section; index: number; value: unknown; errors: string[] };
export type QualityRecovery = {
  assessment: QualityAssessment | null;
  issues: string[];
  invalidItems: InvalidQualityItem[];
};

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const schemas = {
  evidence: qualityAssessmentSchema.shape.evidence.element,
  areas: qualityAssessmentSchema.shape.areas.element,
  findings: qualityAssessmentSchema.shape.findings.element,
};
const limits = { evidence: 100, areas: 32, findings: 30 };
const sections: Section[] = ['evidence', 'areas', 'findings'];
const CATEGORY_ALIASES: Record<string, FindingCategory> = {
  TRENDS: 'TREND', HISTORICAL: 'TREND', HISTORICAL_MARKET: 'TREND', HISTORICAL_TRENDS: 'TREND',
  CUSTOMER_INTEREST: 'CUSTOMER', PURCHASE: 'CUSTOMER', PURCHASE_PREFERENCE: 'CUSTOMER', PURCHASING_PREFERENCES: 'CUSTOMER', AUDIENCE: 'CUSTOMER',
  SEASONAL: 'SEASONAL_CULTURAL', CULTURAL: 'SEASONAL_CULTURAL', SEASONALITY: 'SEASONAL_CULTURAL', SEASONAL_AND_CULTURAL: 'SEASONAL_CULTURAL',
  COMPETITORS: 'COMPETITOR', COMPETITOR_ACTIVITY: 'COMPETITOR',
  OPPORTUNITIES: 'OPPORTUNITY', RECOMMENDATION: 'OPPORTUNITY', CREATIVE: 'OPPORTUNITY',
  CHANNEL: 'OPPORTUNITY', CHANNELS: 'OPPORTUNITY', CHANNEL_BEHAVIOUR: 'OPPORTUNITY',
  RISKS: 'RISK',
};

/** File a model category under the seven report categories. Unknown labels stay blank. */
function findingCategory(value: unknown, claim: string): FindingCategory | null {
  const token = String(value ?? '').trim().toUpperCase().replace(/[\s/-]+/g, '_');
  if ((FINDING_CATEGORIES as readonly string[]).includes(token)) return token as FindingCategory;
  if (CATEGORY_ALIASES[token]) return CATEGORY_ALIASES[token];
  if (/SEASON|CULTUR|HOLIDAY/.test(token)) return 'SEASONAL_CULTURAL';
  if (/COMPET/.test(token)) return 'COMPETITOR';
  if (/CUSTOM|AUDIENCE|PURCHASE|PREFERENCE/.test(token)) return 'CUSTOMER';
  if (/TREND|HISTOR/.test(token)) return 'TREND';
  if (/MARKET/.test(token)) return 'MARKET';
  if (/RISK|LIMIT|WEAK/.test(token)) return 'RISK';
  if (/CHANNEL|CREATIVE|MESSAGE|RECOMMEND|OPPORTUN/.test(token)) return /GAP|NO USABLE|MISSING|UNPROVEN|NOT /.test(claim.toUpperCase()) ? 'RISK' : 'OPPORTUNITY';
  return null;
}

function citationList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  const row = object(value);
  return row ? [row] : null;
}

/** Correct the two reply mistakes that otherwise delete a whole finding. */
function normalizeFinding(value: unknown): unknown {
  const item = object(value);
  if (!item) return value;
  const support = citationList(item.support);
  const supports = citationList(item.supports);
  if ((!supports || supports.length === 0) && support?.length) item.supports = support;
  delete item.support;
  const claim = typeof item.claim === 'string' ? item.claim : '';
  const category = findingCategory(item.category, claim);
  if (category && category !== item.category) {
    const original = String(item.category ?? '').trim();
    item.category = category;
    if (original) {
      const prior = typeof item.limitation === 'string' ? item.limitation : '';
      item.limitation = `Filed from category "${original}". ${prior}`.trim().slice(0, 800);
    }
  }
  return item;
}

function normalizeQualityReply(raw: unknown): unknown {
  const root = object(raw);
  if (!root || !Array.isArray(root.findings)) return raw;
  return { ...root, findings: root.findings.map(normalizeFinding) };
}

const itemKey = (section: Section, value: unknown): string | null => {
  const item = object(value);
  if (!item) return null;
  if (section === 'areas') return typeof item.category === 'string' ? `${item.category}:${item.channel ?? ''}` : null;
  return typeof item.id === 'string' ? item.id : null;
};

/** Keep independently valid work when one structured item needs another turn.
 * Invalid support is removed, never padded or manufactured. Its original finding
 * can remain as an explicitly unsupported proposal until a repair succeeds. */
export function recoverQualityAssessment(raw: unknown): QualityRecovery {
  const normalized = normalizeQualityReply(raw);
  const parsed = qualityAssessmentSchema.safeParse(normalized);
  if (parsed.success) return { assessment: parsed.data, issues: [], invalidItems: [] };
  const issues = parsed.error.issues.map(issue => `${issue.path.join('.') || 'response'}: ${issue.message}`);
  const candidate = object(normalized);
  if (!candidate) return { assessment: null, issues, invalidItems: [] };
  const retained: Record<Section, unknown[]> = { evidence: [], areas: [], findings: [] };
  const invalidItems: InvalidQualityItem[] = [];
  for (const section of sections) {
    const rows = candidate[section];
    if (!Array.isArray(rows)) continue;
    rows.slice(0, limits[section]).forEach((value, index) => {
      const checked = schemas[section].safeParse(value);
      if (checked.success) { retained[section].push(checked.data); return; }
      const errors = checked.error.issues.map(issue => `${section}.${index}.${issue.path.join('.')}: ${issue.message}`);
      invalidItems.push({ section, index, value, errors });
      const item = object(value);
      if (!item || section === 'evidence') return;
      const limitation = [typeof item.limitation === 'string' ? item.limitation : '', 'This item needs response recovery; its support has not been accepted.'].filter(Boolean).join(' ').slice(0, section === 'areas' ? 650 : 800);
      const fallback = schemas[section].safeParse({ ...item, supports: [], limitation,
        ...(section === 'findings' ? { confidence: 'low', material: true } : {}),
      });
      if (fallback.success) retained[section].push(fallback.data);
    });
  }
  const recovered = qualityAssessmentSchema.safeParse(retained);
  const hasWork = Object.values(retained).some(items => items.length > 0);
  return { assessment: recovered.success && hasWork ? recovered.data : null, issues, invalidItems };
}

/** Only the requested malformed items may change during a targeted repair.
 * Valid observations and findings from the paid first response remain intact. */
export function mergeQualityRepair(before: QualityRecovery, repair: QualityAssessment | null, invalidRepairItems: InvalidQualityItem[] = []): QualityRecovery {
  if (!before.assessment || !repair) return before;
  const combined: QualityAssessment = structuredClone(before.assessment);
  const unresolved: InvalidQualityItem[] = [];
  for (const invalid of before.invalidItems) {
    const key = itemKey(invalid.section, invalid.value);
    if (invalidRepairItems.some(item => item.section === invalid.section && itemKey(item.section, item.value) === key)) {
      unresolved.push(invalid); continue;
    }
    const candidates = repair[invalid.section].filter(item => key !== null && itemKey(invalid.section, item) === key);
    const replacement = candidates.length === 1 ? candidates[0] : null;
    const original = object(invalid.value);
    // Repair syntax/substantiation, not the meaning of an already proposed finding.
    if (!replacement || invalid.section === 'findings' &&
      (object(replacement)?.claim !== original?.claim || object(replacement)?.category !== original?.category)) {
      unresolved.push(invalid); continue;
    }
    const rows: unknown[] = combined[invalid.section];
    const index = rows.findIndex(item => itemKey(invalid.section, item) === key);
    if (index < 0) rows.push(replacement); else rows[index] = replacement;
  }
  const parsed = qualityAssessmentSchema.safeParse(combined);
  if (!parsed.success) return before;
  const outerIssues = before.issues.filter(issue => !before.invalidItems.some(item => issue.startsWith(`${item.section}.${item.index}:`) || issue.startsWith(`${item.section}.${item.index}.`)));
  return { assessment: parsed.data, invalidItems: unresolved, issues: [...outerIssues, ...unresolved.flatMap(item => item.errors)] };
}
