import { qualityAssessmentSchema, type QualityAssessment } from './quality-contracts';

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
  const parsed = qualityAssessmentSchema.safeParse(raw);
  if (parsed.success) return { assessment: parsed.data, issues: [], invalidItems: [] };
  const issues = parsed.error.issues.map(issue => `${issue.path.join('.') || 'response'}: ${issue.message}`);
  const candidate = object(raw);
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
