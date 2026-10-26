process.env.TREND_PUBLIC_CACHE_TTL_MS = '0';
import assert from 'node:assert/strict';
import { briefFixture, fixtureAt, fixtureCandidate, fixtureAudit } from './trend-brief-fixtures';
import { createCampaignStrategy } from '../src/lib/agents/trend-strategy';
import { currentStrategy, fallbackStrategy, strategyDraftSchema, strategyFindings, validateStrategy, type StrategyDraft } from '../src/lib/trend/strategy';
import { evaluateQuality, recordStoredTrend } from '../src/lib/trend/quality';
import { assembleBrief } from '../src/lib/trend/brief';
import { defaultBrand } from '../src/lib/seed';
import { defaultSettings } from '../src/lib/settings';
import { stubComplete } from '../src/lib/llm/stub';
import { runEngine } from '../src/lib/runtime/engine';
import { buildCreatives, runCreativeGeneration, type Work } from '../src/lib/runtime/steps';
import { WorkflowRepository } from '../services/workflow/repository';
import type { ResearchInput } from '../src/lib/trend/contracts';
import type { Campaign } from '../src/lib/types';
import type { CompleteRequest } from '../src/lib/llm/types';

delete process.env.LANGSMITH_TRACING;
delete process.env.LANGCHAIN_TRACING_V2;
const settings = defaultSettings();
settings.agents.trend = { provider: 'local', modelId: 'local:custom' };
const oldFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error('This suite must not call live APIs.'); };
let count = 0;
const pass = (label: string) => { count++; console.log('PASS ' + label); };
const inputFor = (c: Campaign): ResearchInput => ({ campaign: c, brand: defaultBrand, settings, at: fixtureAt,
  allowed: async () => true, execute: async () => { throw Error('Strategy must reuse its retained research.'); },
  onFailedUsage: cost => { c.spend.inferenceUsd += cost; } });
function draftFor(c: Campaign): StrategyDraft {
  const { audienceMotivation, keyMessage, visualDirection, alternativeConcept, insights, channels, concepts, limitations } = fallbackStrategy(c, fixtureAt, 'SYNTHETIC');
  return strategyDraftSchema.parse({ recommendedAngle: `SYNTHETIC useful angle for ${c.product}`, audienceMotivation, keyMessage, visualDirection, alternativeConcept,
    insights: insights.map(({ id, title, implication, application, findingIds, basis, limitation }) => ({ id, title, implication, application, findingIds, basis, limitation })), channels, concepts, limitations });
}
const response = (req: CompleteRequest, value: unknown, cost = 0.002) => ({ ...stubComplete(req, 'SYNTHETIC ONLY'), status: 'ok' as const, text: JSON.stringify(value),
  usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300, costUsd: cost, billedAs: 'SYNTHETIC', estimate: false, latencyMs: 0 } });

try {
  {
    const { c } = briefFixture(); let calls = 0;
    const runner = createCampaignStrategy(undefined, { mode: 'mock', complete: async req => {
      calls++; assert.ok(req.tools?.every(tool => !/^(web|retail|stats|calendar)\./.test(tool.name)) ?? true); assert.ok(Buffer.byteLength(req.prompt) < 60000);
      return response(req, draftFor(c));
    } });
    const first = await runner(inputFor(c));
    assert.equal(calls, 1); assert.equal(first.validation, 'passed'); assert.ok(currentStrategy(c));
    assert.equal(c.trendRequestBudget!.calls, 1); assert.equal(c.trendBriefBudget!.calls, 1);
    assert.equal(c.trendRequestBudget!.tokens, 300); assert.equal(c.spend.inferenceUsd, 0.002);
    assert.equal(c.strategy!.status, 'mixed'); assert.equal(c.strategy!.concepts.length, 2); assert.equal(c.strategy!.modelStatus, 'MOCK ONLY');
    const version = c.strategy!.version;
    await runner(inputFor(c)); assert.equal(calls, 1); assert.equal(c.strategy!.version, version);
    pass('one compact synthesis uses retained findings, meters one call and reuses unchanged strategy without another call');
  }
  {
    const { c } = briefFixture(); let calls = 0; const bad = draftFor(c);
    bad.insights[0].findingIds = ['missing-finding'];
    const runner = createCampaignStrategy(undefined, { mode: 'mock', complete: async req => {
      calls++;
      if (calls === 2) { assert.match(req.prompt, /cites an unavailable finding/); assert.match(req.prompt, /missing-finding/); }
      return response(req, calls === 1 ? bad : draftFor(c));
    } });
    const report = await runner(inputFor(c));
    assert.equal(calls, 2); assert.equal(report.validation, 'passed'); assert.ok(currentStrategy(c));
    assert.equal(c.spend.inferenceUsd, 0.004); assert.equal(c.trendRequestBudget!.tokens, 600);
    pass('invalid reference receives one exact-error repair and both consumed model calls are metered once');
  }
  {
    const { c } = briefFixture(); let calls = 0;
    const runner = createCampaignStrategy(undefined, { mode: 'mock', complete: async req => {
      calls++;
      if (calls === 2) assert.match(req.prompt, /repair/);
      return calls === 1 ? { ...response(req, null), text: 'malformed JSON' } : response(req, draftFor(c));
    } });
    await runner(inputFor(c)); assert.equal(calls, 2); assert.ok(currentStrategy(c));
    pass('malformed model JSON repairs through the same bounded shared transport');
  }
  {
    const { c, assessment } = briefFixture(); assessment.findings = assessment.findings.slice(0, 1);
    c.trendQuality = evaluateQuality(c, assessment, fixtureAt, 'SYNTHETIC partial');
    const runner = createCampaignStrategy(undefined, { mode: 'mock', complete: async req => response(req, draftFor(c)) });
    const report = await runner(inputFor(c));
    assert.equal(c.trendQuality.status, 'INCOMPLETE'); assert.equal(report.validation, 'passed');
    assert.equal(c.strategy!.status, 'mixed');
    assert.ok(c.strategy!.insights.some(i => i.basis === 'research' && i.evidenceIds.length));
    assert.ok(c.strategy!.insights.some(i => i.basis === 'hypothesis' && i.evidenceIds.length === 0));
    const source = c.evidence.find(e => e.id === strategyFindings(c)[0].usableEvidenceIds[0])!;
    source.origin = 'synthetic'; assert.equal(strategyFindings(c).length, 0);
    assert.equal(validateStrategy(c, draftFor(c)).length, 0);
    pass('partial reviewed support still produces concepts with explicit hypotheses and synthetic sources never become research-backed insights');
  }
  {
    const { c } = briefFixture(); const findings = strategyFindings(c);
    assert.ok(findings.length);
    const oldContext = structuredClone(c); oldContext.targetAudience = 'A different audience'; assert.deepEqual(strategyFindings(oldContext), []);
    const oldRun = structuredClone(c); oldRun.run!.id = 'a-new-run'; assert.deepEqual(strategyFindings(oldRun), []);
    const withdrawn = structuredClone(c); const finding = findings[0];
    withdrawn.trendQuality!.evidence.find(e => e.id === finding.usableEvidenceIds[0])!.accepted = false;
    assert.equal(strategyFindings(withdrawn).some(f => f.id === finding.id), false);
    pass('strategy uses only current-context, current-run findings whose evidence remains accepted');
  }
  {
    const { c } = briefFixture(); c.channels = ['digital_signage']; let calls = 0;
    const runner = createCampaignStrategy(undefined, { mode: 'mock', complete: async req => {
      calls++; if (calls === 2) assert.match(req.prompt, /Focus on breakfast/);
      return response(req, draftFor(c));
    } });
    await runner(inputFor(c)); assert.deepEqual(c.strategy!.channels.map(row => row.channel), ['digital_signage']);
    c.sharedContext.founderNotes.push('Focus on breakfast'); assert.equal(currentStrategy(c), null);
    await runner(inputFor(c)); assert.equal(calls, 2); assert.equal(c.strategy!.version, 2);
    assert.ok(currentStrategy(c));
    pass('digital signage receives its own approach and founder refinement invalidates synthesis without rerunning research');
  }
  {
    const { c } = briefFixture(); let calls = 0;
    const runner = createCampaignStrategy(undefined, { mode: 'mock', complete: async req => { calls++; return { ...response(req, null), status: 'error' as const }; } });
    await runner(inputFor(c)); assert.equal(calls, 1); assert.equal(c.spend.inferenceUsd, 0.002);
    assert.ok(currentStrategy(c)); assert.ok(c.strategy!.insights.some(i => i.basis === 'hypothesis'));
    pass('provider failure retains useful product-led continuation and accounts for returned usage exactly once');
  }
  {
    const { c, assessment } = briefFixture(); assessment.findings = assessment.findings.slice(0, 1); let calls = 0;
    const runner = async (input: ResearchInput) => createCampaignStrategy(undefined, { mode: 'mock', complete: async req => { calls++; return response(req, draftFor(input.campaign)); } })(input);
    const result = await runEngine({ campaigns: [c], now: fixtureAt }, c, { type: 'ADVANCE', actor: 'system' }, settings, defaultBrand, {
      maxSteps: 1, llm: { quality: async () => ({ assessment, modelStatus: 'SYNTHETIC', replacementAttempts: 0 }), brief: runner, request: async () => { throw Error('No copy model needed at quality handoff.'); } },
    });
    const saved = result.campaign;
    assert.equal(calls, 1); assert.equal(saved.trendQuality!.status, 'INCOMPLETE');
    assert.equal(saved.run!.step, 'trend.handoff'); assert.equal(saved.run!.awaiting, null);
    assert.equal(saved.brief!.angle, saved.strategy!.recommendedAngle);
    assert.equal(saved.brief!.visualDirection, saved.strategy!.visualDirection);
    recordStoredTrend(saved);
    const handoff = await runEngine({ campaigns: [saved], now: fixtureAt }, saved, { type: 'ADVANCE', actor: 'system' }, settings, defaultBrand, { maxSteps: 1 });
    assert.equal(handoff.campaign.run!.step, 'creative.receive');
    const repo = new WorkflowRepository(':memory:');
    const original = briefFixture().c; original.id = saved.id; original.run = null; original.status = 'draft';
    repo.enqueue('founder', 'strategy-save', { campaign: original, campaigns: [original], settings, brand: defaultBrand, command: { type: 'START', actor: 'founder' } });
    const job = repo.claim('test-worker')!;
    repo.checkpoint(job, { ...handoff, canAdvance: false }, true);
    const persisted = repo.campaign('founder', saved.id)!;
    assert.equal(persisted.strategy!.sourceFingerprint, saved.strategy!.sourceFingerprint);
    assert.equal(persisted.brief!.angle, saved.strategy!.recommendedAngle);
    repo.close();
    pass('quality-to-strategy handoff preserves useful direction under partial research and persists it with the campaign');
  }
  for (const existingStrategy of [true, false]) {
    const { c } = briefFixture(); let strategyCalls = 0, copyCalls = 0, images = 0;
    const runner = async (input: ResearchInput) => createCampaignStrategy(undefined, { mode: 'mock', complete: async req => {
      strategyCalls++; const draft = draftFor(input.campaign);
      if (input.campaign.sharedContext.founderNotes.length) draft.recommendedAngle = 'SYNTHETIC breakfast occasion after founder refinement';
      return response(req, draft);
    } })(input);
    if (existingStrategy) c.structuredTrendBrief = await runner(inputFor(c));
    else { const candidate = fixtureCandidate(c); c.structuredTrendBrief = assembleBrief(c, candidate, fixtureAudit(c, candidate), fixtureAt, 'SYNTHETIC historical report'); }
    c.trendBriefRequired = true; recordStoredTrend(c);
    c.creatives = buildCreatives(c, ['A', 'B'].map(variant => ({ variant: variant as 'A' | 'B', kicker: 'SYNTHETIC', headline: 'Prior creative', subhead: c.product, cta: 'Explore', caption: 'Prior synthetic caption', prompt: 'Prior product composition' })), 1);
    c.trendQuality!.handedOffAt = fixtureAt; c.run!.step = 'creative.revise'; c.spend.capUsd = 100;
    const sourcesBefore = JSON.stringify(c.evidence);
    c.sharedContext.founderNotes.push('Focus on breakfast'); assert.equal(currentStrategy(c), null);
    const work: Work = { campaign: c, run: c.run, steps: [], policy: [], toolCalls: [], events: [], now: fixtureAt };
    const revised = await runCreativeGeneration(work, { now: fixtureAt, settings, brand: defaultBrand, allCampaigns: [c],
      llm: { brief: runner, research: async () => { throw Error('Refinement must not retrieve new evidence.'); }, request: async req => {
        copyCalls++; assert.match(req.prompt, /breakfast occasion after founder refinement/);
        const insightId = c.strategy!.insights[0].id;
        return response(req, { variants: ['A', 'B'].map(variant => ({ variant, kicker: 'SYNTHETIC', headline: variant === 'A' ? 'Breakfast begins here' : 'Meet the breakfast pack',
          subhead: c.product, cta: 'Explore', caption: 'SYNTHETIC breakfast idea', prompt: 'The product pack on a breakfast table',
          insightUses: [{ insightId, application: 'visual', rationale: 'The breakfast table demonstrates the revised use occasion.' }], unusedInsightIds: [] })) }, 0);
      } },
      renderPoster: async ({ modelId }) => { images++; return { kind: 'image', modelId, provider: 'SYNTHETIC', modelName: 'SYNTHETIC', status: 'stubbed', note: 'Offline fixture only', at: fixtureAt,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, units: 0, unitLabel: 'images', costUsd: 0, billedAs: 'not called', latencyMs: 0, estimate: true } }; },
    }, 2);
    const expectedVersion = existingStrategy ? 2 : 1;
    assert.equal(revised.blocked, false); assert.equal(strategyCalls, expectedVersion); assert.equal(copyCalls, 1); assert.equal(images, 2);
    assert.equal(JSON.stringify(c.evidence), sourcesBefore); assert.equal(work.toolCalls.length, 0);
    assert.equal(c.strategy!.version, expectedVersion); assert.equal(c.brief!.angle, c.strategy!.recommendedAngle);
    assert.equal(c.creatives.length, 2); assert.ok(c.creatives.every(row => row.strategyVersion === expectedVersion && row.insightUses?.length === 1));
    assert.equal(c.run!.step, 'compliance.receive');
    pass(`${existingStrategy ? 'Existing strategy' : 'Historical campaign without strategy'} refinement reuses research in the real creative step and persists insight use on both variants`);
  }
  console.log(`\n${count} strategy groups passed. All evidence, model replies and usage in this suite are SYNTHETIC.`);
} finally { globalThis.fetch = oldFetch; }
