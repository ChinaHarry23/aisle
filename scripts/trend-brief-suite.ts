process.env.TREND_PUBLIC_CACHE_TTL_MS='0';
import assert from 'node:assert/strict';
import {briefFixture,fixtureCandidate,fixtureAudit,fixtureAt} from './trend-brief-fixtures';
import {validateBrief,assembleBrief,briefMatches} from '../src/lib/trend/brief';
import {evaluateQuality,recordStoredTrend,trendReadyForHandoff} from '../src/lib/trend/quality';
import {createTrendBrief} from '../src/lib/agents/trend-brief';
import {stubComplete} from '../src/lib/llm/stub';
import {defaultBrand} from '../src/lib/seed';
import {defaultSettings} from '../src/lib/settings';
import {runEngine} from '../src/lib/runtime/engine';
import {attachableRecommendation,verifiedPreviousAdvice} from '../src/lib/runtime/defaults';
import {protectResearchSnapshots} from '../src/lib/trend/inline-state';
import {WorkflowRepository} from '../services/workflow/repository';
import {TREND_REQUEST_LIMITS} from '../src/lib/trend/request-budget';
import type {ResearchInput} from '../src/lib/trend/contracts';
let count=0;const pass=(s:string)=>{count++;console.log('PASS '+s);};
const inputFor=(c:ReturnType<typeof briefFixture>['c']):ResearchInput=>({campaign:c,brand:defaultBrand,settings:defaultSettings(),at:fixtureAt,allowed:async()=>true,execute:async()=>{throw Error('No research or action tools in the writer');},onFailedUsage:cost=>{c.spend.inferenceUsd+=cost;}});
const {c}=briefFixture(),b=fixtureCandidate(c),audit=fixtureAudit(c,b);
assert.deepEqual(validateBrief(c,b,audit),[]);assert.equal(b.sections.length,12);assert.equal(c.internalDataAuthorised,false);
c.structuredTrendBrief=assembleBrief(c,b,audit,fixtureAt,'MOCK ONLY');c.trendBriefRequired=true;assert.equal(c.structuredTrendBrief.status,'COMPLETE');assert.equal(trendReadyForHandoff(c),false);recordStoredTrend(c);assert.equal(trendReadyForHandoff(c),true);
pass('all sections, seven categories, every selected channel, separate proposals and source dates; external-only completion requires exact persistence');
for(const section of b.sections){const broken=structuredClone(b);broken.sections=broken.sections.filter(s=>s!==broken.sections.find(t=>t.key===section.key&&t.channel===section.channel));assert.ok(validateBrief(c,broken,audit).length,section.key);}
{const partial=briefFixture();partial.assessment.findings=partial.assessment.findings.slice(0,2);partial.c.trendQuality=evaluateQuality(partial.c,partial.assessment,fixtureAt,'MOCK');const candidate=fixtureCandidate(partial.c);candidate.inferences=[];candidate.themes=[];candidate.visualDirections=[];for(const s of candidate.sections)if(!s.findingIds.length)s.unavailableReason='No supported finding for this report subject.';const report=assembleBrief(partial.c,candidate,fixtureAudit(partial.c,candidate),fixtureAt,'MOCK');assert.equal(report.validation,'passed');assert.equal(report.status,'INCOMPLETE');assert.ok(report.candidate!.sections.some(s=>s.unavailableReason));}
pass('partial reports disclose unavailable subjects and never convert valid JSON into evidence sufficiency');
pass('every missing section and missing selected channel is rejected');
for(const change of ['unknown-finding','unknown-evidence','changed-quote','unrelated-section','duplicate-priority','unsupported-proposal','missing-relevance','extra-channel','fake-audit'] as const){
 const f=briefFixture(),bad=fixtureCandidate(f.c),check=fixtureAudit(f.c,bad);
 if(change==='unknown-finding')bad.prioritisedFindingIds[0]='previous-run-finding';
 if(change==='unknown-evidence')bad.substantiation[0].evidenceId='fabricated-id';
 if(change==='changed-quote')bad.substantiation[0].quote='Invented support that never existed.';
 if(change==='unrelated-section')bad.sections[0].findingIds=['f-COMPETITOR'];
 if(change==='duplicate-priority')bad.prioritisedFindingIds.push(bad.prioritisedFindingIds[0]);
 if(change==='unsupported-proposal')bad.themes[0].basedOnFindingIds=['fabricated-id'];
 if(change==='missing-relevance')bad.relevance=[];
 if(change==='extra-channel')bad.sections.push({key:'channel',channel:'instagram',findingIds:['f-MARKET'],unavailableReason:''});
 if(change==='fake-audit')check.proposals.push({id:'unknown',grounded:true,reason:'Fabricated audit'});
 assert.ok(validateBrief(f.c,bad,check).length,change);
}
pass('invented, unrelated, changed and duplicated citations/IDs, incomplete rationales, unselected channels and unknown audit IDs are refused');
for(const reason of ['search interest is not sales','holiday is not cultural preference','forecast is not observed demand','price summary is not purchasing preference','source instructions are not authority']){const bad=structuredClone(audit);bad.findings[0]={...bad.findings[0],supported:false,reason};assert.match(validateBrief(c,b,bad).join(' '),/support check failed/);}
pass('separate semantic audit can reject unsupported propositions even with valid IDs and verbatim quotes');
{
 const test=structuredClone(c);test.trendQuality!.evidence[0].accepted=false;assert.ok(validateBrief(test,b,audit).length);
 const stale=structuredClone(c);stale.run!.id='other-run';assert.ok(validateBrief(stale,b,audit).length);
 const scope=structuredClone(c);scope.product='Rain jacket';assert.equal(briefMatches(scope,c.structuredTrendBrief!),false);
 const older=structuredClone(c);older.trendBriefRequired=undefined;older.structuredTrendBrief=undefined;older.run!.step='creative.receive';const migrated=await runEngine({campaigns:[older],now:fixtureAt},older,{type:'ADVANCE',actor:'system'},defaultSettings(),defaultBrand,{maxSteps:1,llm:{brief:async()=>{throw Error('No writer before checkpoint');},request:async()=>{throw Error('Legacy report cannot call creative');}}});assert.equal(migrated.campaign.run!.step,'trend.quality');assert.equal(migrated.campaign.trendBriefRequired,true);
 const permission=structuredClone(c);permission.internalDataAuthorised=true;assert.equal(briefMatches(permission,c.structuredTrendBrief!),false);permission.run!.step='trend.handoff';const redirect=await runEngine({campaigns:[permission],now:fixtureAt},permission,{type:'ADVANCE',actor:'system'},defaultSettings(),defaultBrand,{maxSteps:1,llm:{request:async()=>{throw Error('No I/O before revalidation');}}});assert.equal(redirect.campaign.run!.step,'trend.quality');assert.equal(redirect.campaign.trendQuality!.status,'INCOMPLETE');
 const wording=structuredClone(c);wording.structuredTrendBrief!.candidate!.themes[0].text='A changed proposal with an old audit';recordStoredTrend(wording);assert.equal(trendReadyForHandoff(wording),false);
 const tampered=structuredClone(c);tampered.structuredTrendBrief!.candidate!.themes[0].basedOnFindingIds=['bad'];assert.equal(trendReadyForHandoff(tampered),false);
}
pass('excluded evidence, old runs, scope changes and post-save report tampering block handoff');
{
 const f=briefFixture();let calls=0;const runner=createTrendBrief(undefined,{mode:'mock',complete:async req=>{calls++;const candidate=fixtureCandidate(f.c);const value=req.system?.includes('Independently check')?fixtureAudit(f.c,candidate):candidate;return {...stubComplete(req,'MOCK ONLY'),status:'ok',text:JSON.stringify(value)};}});
 const answer=await runner(inputFor(f.c));assert.equal(answer.validation,'passed');assert.equal(calls,2);assert.equal(f.c.trendRequestBudget!.calls,2);assert.equal(f.c.trendBriefBudget!.calls,2);
}
pass('typed shared LangChain writer and separate auditor run without tools; both consume the persistent shared request budget');
{
 const f=briefFixture();let calls=0;const runner=createTrendBrief(undefined,{mode:'mock',complete:async req=>{calls++;return {...stubComplete(req,'MOCK'),status:'ok',text:calls===1?'malformed JSON':JSON.stringify(req.system?.includes('Independently check')?fixtureAudit(f.c,fixtureCandidate(f.c)):fixtureCandidate(f.c))};}});
 const answer=await runner(inputFor(f.c));assert.equal(answer.validation,'passed');assert.equal(calls,3);
 const broken=createTrendBrief(undefined,{mode:'mock',complete:async req=>({...stubComplete(req,'MOCK'),status:'ok',text:'{"extra":"malicious instructions"}'})});assert.equal((await broken(inputFor(f.c))).status,'INCOMPLETE');assert.ok(f.c.trendBriefBudget!.calls<=6);
}
pass('malformed JSON receives bounded repair; persistent failure stays incomplete without fabricated fallback facts');
{
 const f=briefFixture();let calls=0;f.c.trendRequestBudget={runId:f.c.run!.id,calls:TREND_REQUEST_LIMITS.modelCalls,tokens:0,costUsd:0};
 const runner=createTrendBrief(undefined,{mode:'mock',complete:async req=>{calls++;return stubComplete(req,'MUST NOT CALL');}});
 assert.equal((await runner(inputFor(f.c))).status,'INCOMPLETE');assert.equal(calls,0);
 const paused=briefFixture().c;assert.equal((await runner({...inputFor(paused),allowed:async()=>false})).status,'INCOMPLETE');assert.equal(calls,0);
 const noCredits=await createTrendBrief()(inputFor(briefFixture().c));assert.equal(noCredits.status,'INCOMPLETE');
}
{const f=briefFixture();const malicious=createTrendBrief(undefined,{mode:'mock',complete:async req=>({...stubComplete(req,'MOCK'),status:'ok',text:JSON.stringify(fixtureCandidate(f.c)),toolCalls:[{id:'attack',name:'publish_content',args:{country:'US',status:'COMPLETE'}}]})});assert.equal((await malicious(inputFor(f.c))).status,'INCOMPLETE');assert.equal(f.c.country,'AU');assert.equal(f.c.run!.step,'trend.quality');}
pass('malicious unoffered tool requests are rejected without executing actions or changing campaign scope');
pass('shared-budget exhaustion, pause and missing authenticated billing perform no provider I/O and never claim completion');
{
 const f=briefFixture();const liveMock=async(input:ResearchInput)=>createTrendBrief(undefined,{mode:'mock',complete:async req=>({...stubComplete(req,'MOCK ONLY'),status:'ok',text:JSON.stringify(req.system?.includes('Independently check')?fixtureAudit(input.campaign,fixtureCandidate(input.campaign)):fixtureCandidate(input.campaign))})})(input);
 const result=await runEngine({campaigns:[f.c],now:fixtureAt},f.c,{type:'ADVANCE',actor:'system'},defaultSettings(),defaultBrand,{maxSteps:1,llm:{quality:async()=>({assessment:f.assessment,modelStatus:'MOCK ONLY',replacementAttempts:0}),brief:liveMock,request:async()=>{throw Error('No other model path');}}});
 assert.equal(result.campaign.structuredTrendBrief!.validation,'passed');assert.equal(result.campaign.run!.step,'trend.handoff');assert.equal(trendReadyForHandoff(result.campaign),false);recordStoredTrend(result.campaign);assert.equal(trendReadyForHandoff(result.campaign),true);
 const protectedC=protectResearchSnapshots([{...result.campaign,structuredTrendBrief:undefined,trendBriefRequired:false,trendRequestBudget:undefined}],[result.campaign])[0];assert.equal(protectedC.trendBriefRequired,true);
 const bad=briefFixture();const stopped=await runEngine({campaigns:[bad.c],now:fixtureAt},bad.c,{type:'ADVANCE',actor:'system'},defaultSettings(),defaultBrand,{maxSteps:1,llm:{quality:async()=>({assessment:bad.assessment,modelStatus:'MOCK',replacementAttempts:0}),brief:async input=>assembleBrief(input.campaign,null,null,fixtureAt,'unavailable'),request:async()=>{throw Error('No creative');}}});assert.equal(stopped.campaign.run!.status,'running');assert.equal(stopped.campaign.run!.step,'trend.handoff');assert.equal(stopped.campaign.run!.awaiting,null);assert.equal(stopped.campaign.trendQuality!.status,'INCOMPLETE');assert.equal(trendReadyForHandoff(stopped.campaign),false);assert.ok(stopped.campaign.trendQuality!.continuedAt);
}
pass('failed synthesis is disclosed and the run continues toward image generation; a valid final report must persist before a complete handoff');
{
 const source=briefFixture().c;source.id='prior';source.status='published';source.performance={recommendation:'Unaccepted legacy note'} as NonNullable<typeof source.performance>;
 assert.equal(attachableRecommendation([source]),null);
 source.performanceReport={id:'prior-report',at:fixtureAt,publishedAt:fixtureAt,ranChannels:[],results:[],gaps:[],totals:null,summary:'SYNTHETIC report',recommendationText:'Retain a cautious theme.',recommendationPoints:[],recommendationUnsupported:false};
 const next=briefFixture().c;next.sharedContext.previousPerformanceFrom='prior';next.sharedContext.previousPerformanceNote='Retain a cautious theme.';
 assert.equal(verifiedPreviousAdvice(next,[source]),null);
 source.recommendationDecision={action:'accepted',text:'Retain a cautious theme.',note:'confirmed',at:fixtureAt,author:'Test founder',attachedToCampaignId:null};
 assert.equal(verifiedPreviousAdvice(next,[source])!.wording,next.sharedContext.previousPerformanceNote);
 source.recommendationDecision.action='edited';source.recommendationDecision.text='Founder edited wording';next.sharedContext.previousPerformanceNote='Founder edited wording';assert.equal(verifiedPreviousAdvice(next,[source])!.action,'edited');
 source.recommendationDecision.action='discarded';assert.equal(verifiedPreviousAdvice(next,[source]),null);
 const imported={...source,trendQuality:undefined,researchMode:undefined};const stripped=protectResearchSnapshots([imported],[])[0];assert.equal(stripped.performanceReport,null);assert.equal(stripped.recommendationDecision,null);assert.equal(verifiedPreviousAdvice(next,[stripped]),null);
 source.recommendationDecision.action='accepted';source.performanceReport.recommendationUnsupported=true;assert.equal(verifiedPreviousAdvice(next,[source]),null);
}
pass('absent, unaccepted/seeded, accepted, edited, discarded and unsupported prior advice follow stored-decision provenance');
{
 const repo=new WorkflowRepository(':memory:');const original=briefFixture().c;original.id=c.id;original.status='draft';original.run=null;repo.enqueue('founder','ta05-save',{campaign:original,campaigns:[original],settings:defaultSettings(),brand:defaultBrand,command:{type:'START',actor:'founder'}});const job=repo.claim('test-worker')!;repo.checkpoint(job,{campaign:c,run:c.run!,events:[],runSteps:[],policyDecisions:[],canAdvance:false,message:'Synthetic complete report saved'},true);const saved=repo.campaign('founder',c.id)!;assert.equal(saved.sharedContext.structuredTrendBrief!.supportReviewFingerprint,c.structuredTrendBrief!.supportReviewFingerprint);assert.equal(trendReadyForHandoff(saved),true);repo.close();
}
pass('durable checkpoint retains the exact structured report, citations, semantic audit and version binding');
{const f=briefFixture();let audits=0;const runner=createTrendBrief(undefined,{mode:'mock',complete:async req=>{const candidate=fixtureCandidate(f.c);const audit=fixtureAudit(f.c,candidate);if(req.system?.includes('Independently check')){if(++audits===1)audit.findings[0]={...audit.findings[0],supported:false,reason:'SYNTHETIC source period ambiguity; the exact main claim is not established.'};return {...stubComplete(req,'MOCK'),status:'ok',text:JSON.stringify(audit)};}return {...stubComplete(req,'MOCK'),status:'ok',text:JSON.stringify(candidate)};}});const report=await runner(inputFor(f.c));assert.equal(report.validation,'passed');assert.equal(report.status,'INCOMPLETE');assert.equal(f.c.trendQuality!.findings[0].supported,false);assert.ok(f.c.trendQuality!.requests.some(r=>r.id.includes('brief-support:')));assert.equal(report.candidate!.substantiation.some(s=>s.findingId===f.c.trendQuality!.findings[0].id),false);assert.equal(audits,2);}
pass('negative semantic review withdraws claim acceptance, retains provenance, requests clarification and repairs a qualified partial report within four calls');
console.log(`\n${count} TA-05 acceptance groups passed. All evidence and model replies in this suite are SYNTHETIC.`);
