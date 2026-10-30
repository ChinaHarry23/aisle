/** Offline regression of the campaign's actual copy → image and research →
 * compliance requests. Fixtures are not live provider evidence. */
import assert from 'node:assert/strict';
import { briefFixture, fixtureAt } from './trend-brief-fixtures';
import { coverageFor } from '../src/lib/trend/contracts';
import { evaluateQuality } from '../src/lib/trend/quality';
import type { QualityAssessment } from '../src/lib/trend/quality-contracts';
import { complianceResearchEvidence } from '../src/lib/compliance/research-evidence';
import { decideCopy, decideCompliance, type CopyVariant } from '../src/lib/runtime/decide';
import { buildCreatives } from '../src/lib/runtime/steps';
import { posterRequest } from '../src/lib/media/prompts';
import { defaultBrand } from '../src/lib/seed';
import { defaultSettings } from '../src/lib/settings';
import { stubComplete } from '../src/lib/llm/stub';
import type { CompleteRequest } from '../src/lib/llm/types';

const { c } = briefFixture();
c.product = 'Coles RSPCA Approved Chicken Breast Fillet';
const productQuote = 'OFFLINE FIXTURE: Coles RSPCA Approved Chicken Breast Fillets Large Pack Approx. 1.4kg. Australian Chicken.';
const variantQuote = 'OFFLINE FIXTURE: Free Range is a separate product variant; this large pack is not labelled free range.';
const original = c.evidence.find(e => e.id === 'current_market')!;
c.evidence = [{ ...original, id: 'product-source', detail: `${productQuote}\n${variantQuote}`,
  sourceName: 'Firecrawl Scrape', sourceRef: 'https://www.coles.com.au/product/offline-fixture-chicken-1.4kg',
  observedAt: null, dateBasis: 'unknown', sourceNote: 'Offline test fixture only.' }];
c.researchAttempts = [{ category: 'current_market', tool: 'web.scrape_page', phase: 'mandatory', status: 'ok', summary: 'Offline source fixture', evidenceIds: ['product-source'] }];
c.researchCoverage = coverageFor(c, c.evidence);
const assessment: QualityAssessment = {
  evidence: [{ id: 'product-source', sensitive: false, relevant: true, geography: 'matches', temporal: 'unknown', reliability: 'primary', constructive: false, originEvidenceId: null, reason: 'Offline original-page fixture.' }],
  areas: [{ category: 'current_market', channel: null, summary: 'Offline product identity fixture.', supports: [{ evidenceId: 'product-source', quote: productQuote }], limitation: 'Different weights must be checked.' }],
  findings: [
    { id: 'product-identity', category: 'MARKET', claim: 'The listing identifies the named chicken product and Australian origin.', main: true, confidence: 'high', supports: [{ evidenceId: 'product-source', quote: productQuote }], relevance: 'Verify the visible product wording.', conflict: null, limitation: 'The source is a 1.4kg pack; verify the depicted pack. No future price or nutrition claim established.', material: true },
    { id: 'variant-boundary', category: 'RISK', claim: 'Do not transfer Free Range wording from another variant.', main: true, confidence: 'high', supports: [{ evidenceId: 'product-source', quote: variantQuote }], relevance: 'Keep variant qualifications in the review.', conflict: null, limitation: 'RSPCA Approved does not itself establish a free-range claim.', material: true },
    { id: 'unsupported-health', category: 'CUSTOMER', claim: 'This product guarantees better health.', main: true, confidence: 'low', supports: [], relevance: 'Unsupported fixture.', conflict: null, limitation: 'No support.', material: true },
  ],
};
c.trendQuality = evaluateQuality(c, assessment, fixtureAt, 'OFFLINE MOCK');

const fullScene = [
  'Create a meal-led composition with the supplied chicken pack visible beside a cooked chicken-and-vegetable dinner.',
  'Place the plate in the foreground, with generous breathing room for the product headline and call to action.',
  'Use soft natural side lighting and an ordinary home dining table, with recognisable vegetables and a modest serving.',
  'Keep the supplied packaging shape, weight label and product name accurate and legible at a realistic scale.',
  'Make the finished meal the main subject; the pack is a secondary anchor that connects the serving idea to the exact product.',
  'Use a coherent perspective, natural shadows and a restrained colour palette so the meal remains appetising and believable.',
  'FINAL QUALIFICATION: Do not add a free-range seal, a health promise, raw chicken beside the cooked meal, or a future price.',
].join(' ');
assert.ok(fullScene.length > 600);
const variants: CopyVariant[] = ['A', 'B'].map(variant => ({ variant: variant as 'A' | 'B', kicker: '', headline: c.product, subhead: 'Dinner starts here', cta: 'Explore', caption: 'An everyday dinner idea.', prompt: fullScene }));
const copied = await decideCopy({ campaign: c, brand: defaultBrand, settings: defaultSettings(), version: 1, complianceNotes: [], fallback: variants,
  llm: { request: async req => ({ ...stubComplete(req, 'Offline mock'), status: 'ok', text: JSON.stringify({ variants }) }) } });
const creatives = buildCreatives(c, copied.variants, 1);
assert.equal(copied.variants[0].prompt, fullScene);
assert.equal(creatives[0].prompt, fullScene);
assert.ok(posterRequest(c, creatives[0], 'offline-image').prompt.includes(fullScene));
console.log('PASS complete scene and final qualifications survive model response, saved creative and actual image request');

const packet = complianceResearchEvidence(c, c.product);
assert.equal(packet.findings.length, 2);
assert.equal(packet.sources.length, 1, 'the shared source is not repeated for each finding');
assert.equal(packet.sources[0].informationDate, null, 'fetch time must not become a publication date');
assert.equal(packet.sources[0].fetchedAt, fixtureAt);
assert.equal(packet.sources[0].dateBasis, 'unknown');
assert.equal(packet.findings.find(f => f.id === 'product-identity')!.supports[0].quote, productQuote);
assert.match(JSON.stringify(packet), /1\.4kg pack|free-range claim/);
assert.doesNotMatch(JSON.stringify(packet), /guarantees better health/);
console.log('PASS reviewed product quotes, exact source, dates and variant limitations survive a compact deduplicated packet');

let request: CompleteRequest | undefined;
let calls = 0;
const result = await decideCompliance({ campaign: c, brand: defaultBrand, settings: defaultSettings(), copy: c.product, attempt: 1,
  images: ['data:image/png;base64,OFFLINE'], passages: 'OFFLINE regulation passage: product representations must be accurate.', fallback: { summary: 'Unavailable' },
  llm: { request: async req => { calls++; request = req; return { ...stubComplete(req, 'Offline mock'), status: 'ok', text: JSON.stringify({ outcome: 'manual_review', issues: [{ category: 'unsupported_claim', basis: 'human_judgement', severity: 'medium', excerpt: 'Free range', explanation: 'The pictured seal differs from the reviewed large-pack variant.', rule: 'Offline regulation passage', recommendedCorrection: 'Remove the mismatched seal.' }], summary: 'A variant mismatch remains.' }) }; } } });
assert.equal(calls, 1, 'research is reused without another model or tool call');
assert.equal(request!.direct, true);
assert.deepEqual(request!.images, ['data:image/png;base64,OFFLINE']);
assert.match(request!.prompt, /OFFLINE regulation passage/);
assert.match(request!.prompt, /original-source quotes/);
assert.ok(request!.prompt.includes(productQuote));
assert.match(request!.prompt, /offline-fixture-chicken-1\.4kg/);
assert.match(request!.prompt, /another pack, or a competitor/);
assert.match(request!.prompt, /No future price or nutrition claim established/);
assert.equal(result.decision.outcome, 'manual_review', 'research does not automatically clear a genuine issue');
assert.equal(result.decision.issues.length, 1);
console.log('PASS actual vision request combines poster, law and retained product evidence without an extra call or automatic approval');

for (const change of [
  (campaign: typeof c) => { campaign.targetAudience = 'A changed audience'; },
  (campaign: typeof c) => { campaign.run!.id = 'another-run'; },
  (campaign: typeof c) => { campaign.evidence[0].origin = 'synthetic'; },
  (campaign: typeof c) => { campaign.trendQuality!.evidence[0].accepted = false; },
  (campaign: typeof c) => { campaign.evidence[0].research!.quality = 'snippet'; },
  (campaign: typeof c) => { campaign.evidence[0].detail = 'The source was replaced after review.'; },
]) {
  const changed = structuredClone(c);
  change(changed);
  assert.equal(complianceResearchEvidence(changed, c.product).findings.length, 0);
  assert.equal(complianceResearchEvidence(changed, c.product).sources.length, 0);
}
console.log('PASS stale scope/run, synthetic, rejected, snippet and changed-source evidence do not reach compliance as substantiation');

const conflict = structuredClone(c);
conflict.trendQuality!.findings[1].conflict = { evidenceIds: ['product-source', 'other-variant'], explanation: 'The other pack has a Free Range label, while the advertised large pack does not.', explained: true };
assert.match(JSON.stringify(complianceResearchEvidence(conflict, c.product)), /other pack has a Free Range label/);
console.log('PASS retained conflict explanations reach the reviewer with variant qualifications');
