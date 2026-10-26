/** Offline recovery regressions for the 26 October campaign. Every source and
 * model response here is a synthetic fixture; no provider or billing I/O. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTrendQuality } from '../src/lib/agents/trend-quality';
import { evaluateQuality, evidenceCurrency, specialistSource } from '../src/lib/trend/quality';
import { recoverQualityAssessment, mergeQualityRepair } from '../src/lib/trend/quality-recovery';
import { coverageFor } from '../src/lib/trend/contracts';
import { qualityAssessmentSchema, type QualityAssessment } from '../src/lib/trend/quality-contracts';
import { internalRetailTool } from '../src/lib/runtime/tools';
import { parseRetailUpload } from '../src/lib/retail-data';
import { defaultBrand } from '../src/lib/seed';
import { defaultSettings } from '../src/lib/settings';
import { stubComplete } from '../src/lib/llm/stub';
import { briefFixture, fixtureAt } from './trend-brief-fixtures';
import type { ResearchInput } from '../src/lib/trend/contracts';

let checks = 0;
const pass = (label: string) => { checks++; console.log('PASS ' + label); };
const fixture = () => {
  const value = briefFixture();
  const invalid = structuredClone(value.assessment);
  invalid.findings[2].supports[1].quote = 'too short';
  return { ...value, invalid };
};
const input = (c: ReturnType<typeof briefFixture>['c']): ResearchInput => ({
  campaign: c, brand: defaultBrand, settings: defaultSettings(), at: fixtureAt,
  allowed: async () => true, onFailedUsage: () => {},
  execute: async () => { throw Error('Response recovery must reuse existing sources, not repeat retrieval.'); },
});

{
  const { c, assessment, invalid } = fixture();
  let calls = 0;
  const runner = createTrendQuality(undefined, { mode: 'mock', complete: async request => {
    calls++;
    let answer: QualityAssessment = invalid;
    if (calls === 2) {
      assert.match(request.prompt, /findings\.2\.supports\.1\.quote/);
      assert.match(request.prompt, /too short/);
      assert.match(request.prompt, /purchase_preference/);
      assert.match(request.system ?? '', /never pad or invent a quote/);
      const task = JSON.parse(request.prompt);
      assert.equal(task.repair.mode, 'correct_only_listed_items');
      assert.equal(task.repair.items.length, 1);
      assert.deepEqual(new Set(task.evidence.map((e: { id: string }) => e.id)), new Set(['customer_interest', 'purchase_preference']));
      answer = { evidence: [], areas: [], findings: [assessment.findings[2]] };
    }
    return { ...stubComplete(request, 'SYNTHETIC response recovery'), status: 'ok', text: JSON.stringify(answer) };
  } });
  const result = await runner(input(c));
  assert.equal(calls, 2);
  assert.equal(result.replacementAttempts, 0);
  assert.match(result.modelStatus, /repaired/);
  assert.deepEqual(result.assessment, assessment);
  assert.equal(evaluateQuality(c, result.assessment, fixtureAt, result.modelStatus).status, 'COMPLETE');
}
pass('one short quote receives a targeted second turn with its exact error and original passages; unrelated paid work is unchanged');

{
  const { c, assessment, invalid } = fixture();
  let calls = 0;
  const runner = createTrendQuality(undefined, { mode: 'mock', complete: async request => {
    calls++;
    return { ...stubComplete(request, 'SYNTHETIC malformed repair'), status: 'ok', text: JSON.stringify(invalid) };
  } });
  const result = await runner(input(c));
  assert.equal(calls, 2);
  assert.match(result.modelStatus, /partial_recovery/);
  assert.deepEqual(result.assessment!.evidence, assessment.evidence);
  const quality = evaluateQuality(c, result.assessment, fixtureAt, result.modelStatus);
  assert.equal(quality.status, 'INCOMPLETE');
  assert.equal(quality.evidence.filter(e => e.accepted).length, assessment.evidence.length);
  assert.equal(quality.findings.filter(f => f.supported).length, assessment.findings.length - 1);
  assert.equal(quality.findings[2].supported, false);
  assert.deepEqual(quality.findings[2].supports, []);
  assert.equal(quality.findings[2].claim, assessment.findings[2].claim);
}
pass('an unsuccessful repair retains valid findings and source reviews while the affected finding remains explicitly unsupported');

{
  const { c, assessment, invalid } = fixture();
  let calls = 0;
  const runner = createTrendQuality(undefined, { mode: 'mock', complete: async request => {
    calls++;
    if (calls === 2) throw Error('SYNTHETIC provider interruption');
    return { ...stubComplete(request, 'SYNTHETIC first response'), status: 'ok', text: JSON.stringify(invalid) };
  } });
  const result = await runner(input(c));
  assert.equal(calls, 2);
  assert.deepEqual(result.assessment!.evidence, assessment.evidence);
  assert.match(result.modelStatus, /partial_recovery/);
}
pass('a failed recovery request cannot erase the valid first response');

{
  const { c, assessment } = briefFixture();
  let calls = 0;
  const runner = createTrendQuality(undefined, { mode: 'mock', complete: async request => {
    calls++;
    if (calls === 2) return stubComplete(request, 'SYNTHETIC unavailable recovery', 'unconfigured');
    return { ...stubComplete(request, 'SYNTHETIC extra field'), status: 'ok', text: JSON.stringify({ ...assessment, unexpected: true }) };
  } });
  const result = await runner(input(c));
  assert.equal(calls, 2);
  assert.deepEqual(result.assessment, assessment);
  assert.match(result.modelStatus, /partial_recovery/);
}
pass('an unavailable envelope repair retains validated items without claiming recovery succeeded');

{
  const { assessment, invalid } = fixture();
  const before = recoverQualityAssessment(invalid);
  const altered = structuredClone(assessment.findings[2]);
  altered.claim = 'An unrelated invented campaign conclusion';
  const repaired = mergeQualityRepair(before, { evidence: [], areas: [], findings: [altered, { ...assessment.findings[0], id: 'injected' }] });
  assert.equal(repaired.invalidItems.length, 1);
  assert.equal(repaired.assessment!.findings.some(f => f.id === 'injected'), false);
  assert.equal(repaired.assessment!.findings[2].claim, assessment.findings[2].claim);
  assert.equal(qualityAssessmentSchema.safeParse(repaired.assessment).success, true);
}
pass('targeted repair cannot overwrite valid items, change the finding claim, or insert unrelated findings');

{
  const { c, assessment } = briefFixture();
  let calls = 0;
  const runner = createTrendQuality(undefined, { mode: 'mock', complete: async request => {
    calls++;
    return { ...stubComplete(request, 'SYNTHETIC JSON recovery'), status: 'ok', text: calls === 1 ? '{malformed' : JSON.stringify(assessment) };
  } });
  const result = await runner(input(c));
  assert.equal(calls, 2);
  assert.deepEqual(result.assessment, assessment);
  assert.match(result.modelStatus, /repaired/);
}
pass('a malformed response envelope can be rebuilt once from the same saved evidence');

{
  const parsed = parseRetailUpload(JSON.parse(readFileSync(new URL('../src/data/retail/coles.json', import.meta.url), 'utf8')), 'coles.json');
  if (!parsed.ok) throw Error(parsed.error);
  const { c } = briefFixture();
  c.product = 'Coles RSPCA Approved Chicken Breast Fillet';
  c.category = 'Poultry';
  const brand = { ...defaultBrand, retailerName: 'Coles', retailData: parsed.dataset };
  const result = await internalRetailTool.run({ campaign: c, brand, at: fixtureAt, args: {} });
  assert.equal(result.evidence.length, 3);
  assert.match(result.summary, /demo|fabricated/i);
  for (const record of result.evidence) {
    assert.equal(record.origin, 'synthetic');
    assert.match(record.sourceNote ?? '', /fabricated/);
    assert.equal(record.status, 'assumed');
    assert.ok(record.research?.category);
  }
  c.evidence = result.evidence;
  assert.equal(coverageFor(c, c.evidence).flatMap(a => a.evidenceIds).length, 0);
  // Even an otherwise favourable semantic review cannot promote a demo record.
  c.evidence = [{ ...result.evidence[0], status: 'verified' }];
  c.researchCoverage = coverageFor(c, c.evidence);
  const reviewed: QualityAssessment = { evidence: [{ id: c.evidence[0].id, sensitive: false, relevant: true, geography: 'matches', temporal: 'fits', reliability: 'primary', originEvidenceId: null, reason: 'SYNTHETIC favourable model response.' }], areas: [], findings: [] };
  assert.match(evaluateQuality(c, reviewed, fixtureAt, 'MOCK').evidence[0].exclusions.join(' '), /Synthetic demonstration/);
}
pass('the bundled Coles dataset retains its demo provenance and never substantiates a live campaign');

{
  const {c, assessment} = briefFixture();
  const calendar = c.evidence.find(e => e.research?.category === 'cultural')!;
  Object.assign(calendar, {sourceName:'Nager.Date', sourceRef:'https://nagerholidays.com/api/v3/publicholidays/2026/AU', observedAt:null,
    coverage:{start:c.startDate, end:c.endDate, location:'AU'}});
  const abs = c.evidence.find(e => e.research?.category === 'historical_market')!;
  Object.assign(abs, {sourceName:'ABS Data API', sourceRef:'https://data.api.abs.gov.au/rest/data/ABS,HOUSEHOLD_SPENDING,1.0.0/A.AU.FOOD?lastNObservations=12&dimension_at_observation=AllDimensions', observedAt:'2026-09-01',
    coverage:{start:'2025-10-01', end:'2026-09-30', location:'AU'}});
  const weather = c.evidence.find(e => e.research?.category === 'seasonal')!;
  Object.assign(weather, {sourceName:'Open-Meteo Historical Weather', sourceRef:'https://archive-api.open-meteo.com/v1/archive?latitude=-33.87&longitude=151.21&start_date=2025-11-01&end_date=2025-11-14&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto', observedAt:null,
    coverage:{start:'2025-11-01', end:'2025-11-14', location:'Sydney'}});
  const quality = evaluateQuality(c, assessment, fixtureAt, 'SYNTHETIC specialist reviews');
  for (const e of [calendar, abs, weather]) assert.equal(quality.evidence.find(r => r.id === e.id)!.accepted, true, e.sourceName);
  assert.equal(evidenceCurrency(calendar, fixtureAt), 'current');
  assert.equal(evidenceCurrency(weather, fixtureAt), 'historical');
  assert.equal(evidenceCurrency({...calendar, coverage:undefined}, fixtureAt), 'unknown');
  assert.equal(specialistSource({...abs, sourceRef:abs.sourceRef+'&token=extra'}), null);
  assert.equal(specialistSource({...weather, sourceRef:weather.sourceRef.replace('archive-api.open-meteo.com', 'unknown.example')}), null);
  assert.equal(specialistSource({...weather, coverage:{...weather.coverage!, start:'2025-10-01'}}), null);
  const wrongPeriod = structuredClone(assessment);
  wrongPeriod.evidence.find(e => e.id === calendar.id)!.temporal = 'unknown';
  wrongPeriod.evidence.find(e => e.id === weather.id)!.geography = 'mismatch';
  const rejected = evaluateQuality(c, wrongPeriod, fixtureAt, 'SYNTHETIC scope mismatch');
  assert.equal(rejected.evidence.find(e => e.id === calendar.id)!.accepted, false);
  assert.equal(rejected.evidence.find(e => e.id === weather.id)!.accepted, false);
}
pass('typed calendar, ABS and weather records retain bounded endpoint and time coverage provenance while semantic timing/geography still apply');

console.log(`${checks} offline quality recovery groups passed. All model/data fixtures are synthetic; no API calls.`);
