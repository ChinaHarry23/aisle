import assert from 'node:assert/strict';
import { briefFixture, fixtureAt, fixtureAudit, fixtureCandidate } from './trend-brief-fixtures';
import { assembleBrief, briefMatches } from '../src/lib/trend/brief';
import { assembleStrategyReport } from '../src/lib/trend/strategy-report';
import { fallbackStrategy } from '../src/lib/trend/strategy';
import { evaluateQuality } from '../src/lib/trend/quality';

let count = 0;
const pass = (message:string) => { count++; console.log('PASS '+message); };
const fixture = () => {
  const {c} = briefFixture();
  c.strategy = fallbackStrategy(c, fixtureAt, 'SYNTHETIC offline strategy');
  return c;
};
{
  const c = fixture(), report = assembleStrategyReport(c, fixtureAt);
  assert.equal(report.format, 'strategy-v1');
  assert.equal(report.validation, 'passed');
  assert.equal(report.status, 'COMPLETE');
  assert.equal(report.audit, null);
  assert.equal(briefMatches(c, report), true);
  assert.equal(report.candidate!.sections.length, 12);
  assert.deepEqual(report.findings, c.trendQuality!.findings);
  for (const citation of report.candidate!.substantiation) {
    const finding = c.trendQuality!.findings.find(f => f.id === citation.findingId)!;
    assert.ok(finding.supports.some(s => s.evidenceId === citation.evidenceId && s.quote === citation.quote));
    assert.ok(c.evidence.find(e => e.id === citation.evidenceId)!.detail.includes(citation.quote));
  }
  pass('current strategy yields a valid deterministic report with exact reviewed findings, source excerpts and no invented audit');
}
{
  const {c, assessment} = briefFixture();
  assessment.findings[0].supports[0].quote = assessment.findings[0].supports[0].quote.toLowerCase().replaceAll(' ', '\n  ');
  const quote = assessment.findings[0].supports[0].quote;
  c.trendQuality = evaluateQuality(c, assessment, fixtureAt, 'SYNTHETIC normalized quote');
  assert.equal(c.trendQuality.findings[0].supported, true);
  c.strategy = fallbackStrategy(c, fixtureAt, 'SYNTHETIC offline strategy');
  const report = assembleStrategyReport(c, fixtureAt);
  assert.equal(report.validation, 'passed');
  assert.equal(briefMatches(c, report), true);
  assert.equal(report.candidate!.substantiation.find(s => s.findingId === assessment.findings[0].id)!.quote, quote);
  pass('whitespace and case normalization match the source review while preserving the original reviewed quote');
}
{
  const c = fixture();
  c.strategy!.insights.find(i => i.basis === 'hypothesis')!.application = 'SYNTHETIC HYPOTHESIS MUST STAY IN STRATEGY';
  const report = assembleStrategyReport(c, fixtureAt);
  assert.equal(report.validation, 'passed');
  assert.ok(!JSON.stringify(report.candidate).includes('SYNTHETIC HYPOTHESIS MUST STAY IN STRATEGY'));
  assert.equal(report.candidate!.visualDirections.length, 0);
  assert.ok(report.candidate!.themes.every(p => p.basedOnFindingIds.every(id => c.trendQuality!.findings.some(f => f.id === id && f.supported))));
  pass('hypotheses and mixed concept visuals remain in labelled strategy rather than becoming report facts or grounded proposals');
}
{
  const c = fixture();
  c.trendQuality!.status = 'INCOMPLETE';
  c.trendQuality!.researchAreas.find(a => a.category === 'historical_market')!.supported = false;
  const report = assembleStrategyReport(c, fixtureAt);
  assert.equal(report.status, 'INCOMPLETE');
  assert.equal(report.validation, 'passed');
  assert.equal(briefMatches(c, report), true);
  assert.ok(report.candidate!.sections.find(s => s.key === 'historical_trends')!.unavailableReason);
  assert.ok(report.candidate!.themes.length > 0);
  pass('incomplete coverage still renders the useful reviewed research and strategy applications');
}
for (const change of ['source', 'scope', 'run', 'quality-version', 'strategy-version', 'strategy-wording', 'candidate', 'finding', 'audit'] as const) {
  const c = fixture(), report = assembleStrategyReport(c, fixtureAt);
  if (change === 'source') c.evidence[0].detail += ' Changed source';
  if (change === 'scope') c.product = 'Different product';
  if (change === 'run') c.run!.id = 'new-run';
  if (change === 'quality-version') c.trendQuality!.version++;
  if (change === 'strategy-version') c.strategy!.version++;
  if (change === 'strategy-wording') c.strategy!.insights[0].application = 'Changed strategic application';
  if (change === 'candidate') report.candidate!.themes[0].text = 'Changed without strategy regeneration';
  if (change === 'finding') report.findings[0].claim = 'Rewritten fact';
  if (change === 'audit') report.audit = {findings:[], proposals:[]};
  assert.equal(briefMatches(c, report), false, change);
}
pass('source, scope, run, quality, strategy and report mutations invalidate only the changed report snapshot');
{
  const c = fixture(), candidate = fixtureCandidate(c);
  const legacy = assembleBrief(c, candidate, fixtureAudit(c, candidate), fixtureAt, 'SYNTHETIC legacy');
  assert.equal(legacy.format, undefined);
  assert.equal(briefMatches(c, legacy), true);
  legacy.audit = null;
  assert.equal(briefMatches(c, legacy), false);
  pass('legacy report support-audit semantics remain unchanged');
}
console.log(`\n${count} strategy report groups passed. All fixtures are SYNTHETIC; no API calls.`);
