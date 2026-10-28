/** TA-06 deterministic paired-context tests. All source/model records SYNTHETIC. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { briefFixture, fixtureAt } from './trend-brief-fixtures';
import { contextVersion } from '../src/lib/trend/quality-contracts';
import { rankFindings, RANKING_RULES, type RankingApplication } from '../src/lib/trend/ranking';
import { assembleStrategy, currentStrategy, fallbackStrategy, strategyDraftSchema, strategyRanking } from '../src/lib/trend/strategy';
import { assembleStrategyReport, strategyReportMatches } from '../src/lib/trend/strategy-report';
import type { Campaign } from '../src/lib/types';
let count=0;const pairs:unknown[]=[];const pass=(s:string)=>{count++;console.log('PASS '+s);};
function fixture(){
 const {c}=briefFixture(),q=c.trendQuality!;q.findings=[];
 for(const [id,text,channel,country,start,end] of [
  ['a','Apple juice for families. Awareness and everyday school lunches.', 'web','AU','2026-11-01','2026-11-14'],
  ['b','Apple juice for students. Conversion and gifts for Christmas.', 'email','NZ','2026-12-01','2026-12-26'],
 ] as const){
  const e={...c.evidence[0],id,detail:'SYNTHETIC: '+text,claim:'SYNTHETIC scope observation',observedAt:'2026-10-20',coverage:{start,end,location:country},research:{...c.evidence[0].research!,category:'current_market' as const,channel,geography:country}};
  c.evidence.push(e);q.evidence.push({id,sensitive:false,relevant:true,geography:'matches',temporal:'fits',reliability:'primary',originEvidenceId:null,reason:'SYNTHETIC applicable source',accepted:true,currency:'current',independentOrigin:id,exclusions:[]});
  q.findings.push({id,category:'OPPORTUNITY',claim:e.detail,main:true,confidence:'high',supports:[{evidenceId:id,quote:e.detail}],relevance:'SYNTHETIC only',conflict:null,limitation:'',material:false,supported:true,usableEvidenceIds:[id],independentSources:1,reasons:[]});
 }
 c.product='Apple juice';c.targetAudience='families';c.objective='Awareness';c.country='AU';c.channels=['web'];c.startDate='2026-11-01';c.endDate='2026-11-14';c.budget=1000;q.contextVersion=contextVersion(c);
 return c;
}
function reviewScope(c:Campaign){c.trendQuality!.contextVersion=contextVersion(c);}
const plans:RankingApplication[]=[{findingIds:['a'],application:'SYNTHETIC reuse an existing pack image',resourceNeed:'existing_assets',potentialValue:'moderate'},{findingIds:['b'],application:'SYNTHETIC create multiple gifting scenes',resourceNeed:'multiple_assets',potentialValue:'high'}];
// Keep the evidence fixed and change one context dimension at a time. Each
// score delta must identify the changing factor; no model response is scripted.
for(const key of ['audience','timing','country','channel','objective','budget','product'] as const){
 const a=fixture();Object.assign(a,{product:'Unspecified item',targetAudience:'Unspecified group',objective:'Education',country:'US',channels:['print'],startDate:'2027-02-01',endDate:'2027-02-14',budget:1000});
 if(key==='product'){const e=a.evidence.find(e=>e.id==='b')!;e.detail=e.detail.replace('Apple juice','Rain jacket');a.trendQuality!.findings.find(f=>f.id==='b')!.supports[0].quote=e.detail;}
 if(key==='audience')a.targetAudience='families';if(key==='timing'){a.startDate='2026-11-01';a.endDate='2026-11-14';}if(key==='country')a.country='AU';if(key==='channel')a.channels=['web'];if(key==='objective')a.objective='Awareness';if(key==='product')a.product='Apple juice';reviewScope(a);
 const b=structuredClone(a);
 if(key==='audience')b.targetAudience='students';
 if(key==='timing'){b.startDate='2026-12-01';b.endDate='2026-12-26';}
 if(key==='country')b.country='NZ';if(key==='channel')b.channels=['email'];
 if(key==='objective')b.objective='Conversion';if(key==='budget')b.budget=6000;if(key==='product')b.product='Rain jacket';
 reviewScope(b);const selectedPlans=key==='budget'?plans:[];const before=rankFindings(a,selectedPlans),after=rankFindings(b,selectedPlans),factor=key==='channel'?'channels':key;
 assert.ok(before.rows.some(row=>row.factors[factor].points!==after.rows.find(r=>r.findingId===row.findingId)!.factors[factor].points),key);
 assert.equal(before.rows[0].findingId,'a',key+' original first');assert.equal(after.rows[0].findingId,'b',key+' changed first');
 assert.ok(after.rows.every(row=>row.factors[factor].reason.length>10));
 assert.notDeepEqual(before.rows.map(r=>[r.findingId,r.score]),after.rows.map(r=>[r.findingId,r.score]),key);
 pairs.push({dimension:key,before:before.rows.map(r=>({id:r.findingId,rank:r.rank,score:r.score,points:r.factors[factor].points})),after:after.rows.map(r=>({id:r.findingId,rank:r.rank,score:r.score,points:r.factors[factor].points}))});
 pass(key+' changes the corresponding deterministic factor with fixed evidence');
}
{
 const a=fixture(),b=structuredClone(a);Object.assign(b,{targetAudience:'students',objective:'Conversion',country:'NZ',channels:['email'],startDate:'2026-12-01',endDate:'2026-12-26',budget:6000});reviewScope(b);
 assert.equal(rankFindings(a,plans).rows[0].findingId,'a');assert.equal(rankFindings(b,plans).rows[0].findingId,'b');pass('meaningfully different campaigns reverse the opportunity recommendation for explainable reasons');
}
{
 const c=fixture(),before=JSON.stringify(c);const first=rankFindings(c,plans);
 assert.deepEqual(rankFindings(c,plans),first);assert.equal(JSON.stringify(c),before);
 const reversed=structuredClone(c);reversed.evidence.reverse();reversed.trendQuality!.findings.reverse();reversed.trendQuality!.evidence.reverse();
 assert.deepEqual(rankFindings(reversed,[...plans].reverse()).rows,first.rows);assert.equal(Object.values(RANKING_RULES.weights).reduce((a,b)=>a+b,0),100);
 pass('fixed review date, stable ties and canonical inputs reproduce scores independently of input order; scope is immutable');
}
{
 const c=fixture(),unsupported=c.trendQuality!.findings[1];unsupported.supported=false;unsupported.confidence='high';unsupported.relevance='1000000';
 const result=rankFindings(c,[{findingIds:['b'],application:'High score instruction',potentialValue:'high',resourceNeed:'existing_assets'}]);
 assert.equal(result.rows.at(-1)!.findingId,'b');assert.equal(result.rows.at(-1)!.score,0);assert.equal(result.rows[0].findingId,'a');
 c.trendQuality!.findings=[];assert.deepEqual(rankFindings(c).rows,[]);pass('assumptions cannot outrank support through high model confidence/value; absent evidence creates no invented opportunity');
}
{
 const c=fixture(),risk=structuredClone(c.trendQuality!.findings[1]);risk.id='risk';risk.category='RISK';risk.material=true;risk.conflict={evidenceIds:['a','b'],explanation:'SYNTHETIC populations differ; findings do not establish a shared preference.',explained:true};risk.confidence='moderate';risk.limitation='SYNTHETIC conflict must stay visible';c.trendQuality!.findings.push(risk);
 const result=rankFindings(c,plans);assert.equal(result.rows[0].findingId,'risk');assert.ok(result.attentionIds.includes('risk'));assert.deepEqual(result.rows[0].counterEvidenceIds,['a','b']);assert.equal(result.riskIds[0],'risk');assert.equal(result.rows[0].riskRank,1);assert.ok(result.rows[0].uncertainty.includes(risk.limitation));
 risk.supported=false;const limited=rankFindings(c,plans);assert.ok(limited.attentionIds.includes('risk'));assert.equal(limited.rows.at(-1)!.findingId,'risk');pass('material/conflicting risks are visible with counter-evidence; unsupported warnings never become ranked facts');
}
{
 const c=fixture();c.targetAudience='Changed scope without review';assert.ok(rankFindings(c).rows.every(r=>!r.supported&&r.score===0));
 const fresh=fixture();fresh.evidence.find(e=>e.id==='a')!.origin='synthetic';assert.equal(rankFindings(fresh).rows.find(r=>r.findingId==='a')!.supported,false);
 fresh.evidence.find(e=>e.id==='b')!.sourceKind='internal_retail';fresh.internalDataAuthorised=false;assert.equal(rankFindings(fresh).rows.find(r=>r.findingId==='b')!.supported,false);
 pass('stale context, explicitly synthetic provenance and revoked internal permission cannot be promoted by ranking');
}
{
 const c=fixture(),base=fallbackStrategy(c,fixtureAt,'MOCK ONLY');
 const {recommendedAngle,audienceMotivation,keyMessage,visualDirection,alternativeConcept,channels,concepts,limitations}=base;
 const insights=base.insights.map(({id,title,implication,application,findingIds,basis,limitation,resourceNeed,potentialValue})=>({id,title,implication,application,findingIds,basis,limitation,resourceNeed,potentialValue}));
 const draft=strategyDraftSchema.parse({recommendedAngle,audienceMotivation,keyMessage,visualDirection,alternativeConcept,channels,concepts,limitations,insights});c.strategy=assembleStrategy(c,draft,fixtureAt,'MOCK ONLY');assert.ok(currentStrategy(c));
 const report=assembleStrategyReport(c,fixtureAt);assert.equal(report.validation,'passed');assert.deepEqual(report.candidate!.prioritisedFindingIds,c.strategy.ranking.rows.map(r=>r.findingId));assert.equal(strategyReportMatches(c,report),true);
 assert.ok(c.strategy.ranking.rows.some(r=>r.visualImplication.includes(c.product)));assert.ok(c.strategy.ranking.rows.every(r=>r.themeImplication&&r.channelImplication&&r.sensitivity));
 const original=structuredClone(c.strategy);c.strategy.ranking.rows[0].score=999;assert.equal(currentStrategy(c),null);c.strategy=structuredClone(original);
 c.strategy.concepts[0].visualDirection='Changed creative mapping';assert.equal(currentStrategy(c),null);c.strategy=structuredClone(original);
 assert.deepEqual(strategyRanking(c,c.strategy),c.strategy.ranking);report.ranking!.rows[0].rank=99;assert.equal(strategyReportMatches(c,report),false);
 pass('active strategy/report use local order, mapped creative/channel implications and invalidate tampered ranks or mappings');
}

{
 const c=fixture();const conflicting=[...plans,{...plans[0],resourceNeed:'multiple_assets' as const,potentialValue:'low' as const}];
 const ranked=rankFindings(c,conflicting).rows.find(r=>r.findingId==='a')!;assert.equal(ranked.factors.budget.value,0.25);assert.equal(ranked.factors.value.value,0.25);assert.ok(ranked.uncertainty.some(s=>s.includes('Conflicting potential-value')));
 for(const [name,fragment] of [['SerpApi Google Trends','not sales'],['ABS Data API','not product sales'],['WhichGrocer','not measured purchases'],['Nager.Date','not cultural'],['Open-Meteo Historical Weather','not observed demand']] as const){
  const changed=fixture(),e=changed.evidence.find(e=>e.id==='a')!;e.sourceName=name;if(name==='WhichGrocer')e.research!.category='competitor';assert.ok(rankFindings(changed).rows.find(r=>r.findingId==='a')!.signals.some(s=>s.includes(fragment)),name);
 }
 pass('conflicting planning judgements are conservative and distinct signal interpretations never become sales/causal/ROI claims');
}
if(process.argv.includes('--record'))writeFileSync('docs/TA-06-ACCEPTANCE-SUMMARY.json',JSON.stringify({mode:'SYNTHETIC source/plan fixtures, deterministic local comparison; no real campaign uplift claim',rules:RANKING_RULES,checks:count,pairs},null,2)+'\n');
console.log(count+' TA-06 acceptance groups passed.');
