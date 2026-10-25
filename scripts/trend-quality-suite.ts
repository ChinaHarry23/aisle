process.env.TREND_PUBLIC_CACHE_TTL_MS='0';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {blankCampaign,defaultBrand} from '../src/lib/seed';
import {defaultSettings} from '../src/lib/settings';
import {coverageFor,RESEARCH_CATEGORIES} from '../src/lib/trend/contracts';
import {evaluateQuality,recordStoredTrend,trendReadyForHandoff} from '../src/lib/trend/quality';
import {FINDING_CATEGORIES,contextVersion,type QualityAssessment,type TrendResolution} from '../src/lib/trend/quality-contracts';
import {parseCommand,assertTransition} from '../src/lib/workflow/commands';
import {runEngine} from '../src/lib/runtime/engine';
import {WorkflowRepository} from '../services/workflow/repository';
import {createTrendQuality} from '../src/lib/agents/trend-quality';
import {protectResearchSnapshots,withWorkspaceLock} from '../src/lib/trend/inline-state';
import {importRetailCsv} from '../src/lib/trend/internal-retail';
import {toolByName} from '../src/lib/runtime/tools';
import {stubComplete} from '../src/lib/llm/stub';
import type {Campaign} from '../src/lib/types';
import type {Evidence} from '../src/lib/runtime/types';
const at='2026-10-23T12:00:00Z',settings=defaultSettings();
const base=()=>{
 const c=blankCampaign({name:'TA04 synthetic acceptance',product:'Apple juice',category:'Grocery',targetAudience:'Adult Australian shoppers',objective:'Brand awareness',budget:1000,channels:['web'],startDate:'2026-10-24',endDate:'2026-10-31',country:'AU',notes:''},defaultBrand,null,settings);
 c.status='analysing';c.running=true;c.researchMode='agent';
 c.run={id:'quality-run',campaignId:c.id,status:'running',step:'trend.quality',startedAt:at,updatedAt:at,stepsTaken:0,maxSteps:36,revisionAttempts:0,toolsUsed:[],haltedReason:null,awaiting:null,awaitingDetail:null};
 c.evidence=RESEARCH_CATEGORIES.map((category,i):Evidence=>({id:`e${i}`,claim:'SYNTHETIC fixture',detail:`Synthetic ${category} observation for Australian juice shoppers. Measurement ${i} is zero units. This fixture is not a real retail finding.`,sourceName:'SYNTHETIC primary',sourceRef:`https://www.abs.gov.au/synthetic/${category}`,sourceKind:'external_public',observedAt:category==='historical_market'?'2024-10-01':'2026-10-15',fetchedAt:at,status:'verified',confidence:0,raisedBy:'trend',usedFor:category,research:{category,...(category==='channel'?{channel:'web'}:{}),geography:'AU',queryScope:category,permission:'allowed',quality:'unassessed'}}));
 c.researchAttempts=c.evidence.map(e=>({category:e.research!.category,channel:e.research!.channel,tool:'web.scrape_page',phase:'mandatory',status:'ok',summary:'SYNTHETIC',evidenceIds:[e.id]}));
 c.researchCoverage=coverageFor(c,c.evidence);
 c.brief={product:c.product,angle:'Synthetic evidence-backed theme',audience:c.targetAudience,channels:c.channels,keyMessage:'Synthetic draft',claimsAllowed:[],claimsAvoid:['best'],visualDirection:'Authorised product imagery'};
 return c;
};
const assessment=(c:Campaign):QualityAssessment=>({evidence:c.evidence.map(e=>({id:e.id,sensitive:false,relevant:true,geography:'matches',temporal:'fits',reliability:'primary',originEvidenceId:null,reason:'SYNTHETIC: directly applicable dated original.'})),
 areas:c.evidence.map(e=>({category:e.research!.category,channel:e.research!.channel??null,summary:e.detail,supports:[{evidenceId:e.id,quote:e.detail}],limitation:''})),
 findings:FINDING_CATEGORIES.map((category,i)=>{const index=[0,1,2,4,7,0,0][i],e=c.evidence[index];return {id:`f${i}`,category,claim:`${category}: ${e.detail}`,main:true,confidence:'high',supports:[{evidenceId:e.id,quote:e.detail}],relevance:'SYNTHETIC fixture relevance to product, adult AU audience, awareness objective, campaign timing, web channel and budget.',conflict:null,limitation:'',material:false};})});
let checks=0;const pass=(s:string)=>{checks++;console.log('PASS '+s);};
function reviewed(c=base(),a=assessment(c)){c.trendQuality=evaluateQuality(c,a,at,'MOCK ONLY');c.trendRequests=c.trendQuality.requests;return c;}
let c=reviewed();assert.equal(c.trendQuality!.status,'COMPLETE');assert.equal(trendReadyForHandoff(c),false);recordStoredTrend(c);assert.equal(trendReadyForHandoff(c),true);assert.equal(c.sharedContext.trendBrief?.status,'COMPLETE');
assert.equal(c.internalDataAuthorised,false);assert.equal(c.trendQuality!.evidence.find(e=>e.id==='e1')!.currency,'historical');
pass('sufficient external-only evidence and historical target period pass; current version must persist before handoff');
for(const mutation of ['stale','missing-date','irrelevant','geography','sensitive','snippet','missing','forged-quote','missing-category','low-confidence'] as const){
 const test=base(),a=assessment(test);
 switch(mutation){case 'stale':test.evidence[0].observedAt='2020-01-01';break;case 'missing-date':test.evidence[0].observedAt=null;break;case 'irrelevant':a.evidence[0].relevant=false;break;case 'geography':a.evidence[0].geography='mismatch';break;case 'sensitive':a.evidence[0].sensitive=true;break;case 'snippet':test.evidence[0].research!.quality='snippet';break;case 'missing':a.areas=a.areas.filter(v=>v.category!=='channel');break;case 'forged-quote':a.findings[0].supports[0].quote='This quote does not occur in the source.';break;case 'missing-category':a.findings=a.findings.filter(f=>f.category!=='RISK');break;case 'low-confidence':a.findings[0].confidence='low';break;}
 assert.equal(evaluateQuality(test,a,at,'MOCK').status,'INCOMPLETE',mutation);
}
pass('stale, unknown dates, irrelevant, geography mismatch, sensitive, snippet, missing area/output, forged quotes and low confidence block completion');
{
 const test=base(),a=assessment(test);const original={...test.evidence[0],id:'syndicated',sourceRef:'https://www.abs.gov.au/synthetic/reprint'};test.evidence.push(original);test.researchCoverage=coverageFor(test,test.evidence);a.evidence.push({...a.evidence[0],id:original.id,originEvidenceId:'e0',reliability:'credible'});a.evidence[0].reliability='credible';a.findings[0].material=true;a.findings[0].supports.push({evidenceId:original.id,quote:original.detail});
 const q=evaluateQuality(test,a,at,'MOCK');assert.equal(q.findings[0].independentSources,1);assert.equal(q.findings[0].supported,false);assert.equal(q.evidence.length,9);
}
pass('copied/syndicated articles retain provenance but cannot manufacture independent corroboration');
const limited=()=>{const test=base(),a=assessment(test);a.findings[0].material=true;a.findings[0].limitation='Regional sample; conclusion restricted to this observed population.';a.findings[0].conflict={evidenceIds:['e0','e1'],explanation:'Population differs; retain both observations.',explained:false};return reviewed(test,a);};
c=limited();assert.equal(c.trendQuality!.status,'INCOMPLETE');let request=c.trendRequests!.find(r=>r.options.includes('continue_limited'))!;assert.ok(request);
c.status='paused';c.run!.status='paused';const cmd:TrendResolution={type:'RESOLVE_TREND',actor:'founder',requestId:request.id,contextVersion:request.contextVersion,reviewVersion:request.reviewVersion,action:'continue_limited',note:'Accept the qualified supported conclusion; retain both sources.'};
assert.throws(()=>parseCommand({...cmd,actor:'trend'}));assert.throws(()=>parseCommand({...cmd,context:{approvedClaims:['fake']}}));assert.throws(()=>assertTransition(c,{type:'START',actor:'founder'}));
let result=await runEngine({campaigns:[c],now:at},c,parseCommand(cmd),settings,defaultBrand,{ownerUserId:'test-founder',llm:{request:async()=>{throw Error('No model needed');}}});
assert.equal(result.canAdvance,true);assert.equal(result.campaign.trendQuality!.resumeStep,8);assert.equal(result.campaign.trendRequests![0].actorId,'test-founder');
assert.throws(()=>assertTransition(result.campaign,cmd));
result=await runEngine({campaigns:[result.campaign],now:at},result.campaign,{type:'ADVANCE',actor:'system'},settings,defaultBrand,{llm:{request:async()=>{throw Error('Do not rerun the accepted exact assessment');}}});
assert.equal(result.campaign.trendQuality!.status,'COMPLETE');assert.equal(result.campaign.run!.step,'trend.handoff');assert.equal(result.campaign.trendQuality!.storedVersion,null);
recordStoredTrend(result.campaign);assert.equal(trendReadyForHandoff(result.campaign),true);
pass('supported limited continuation records founder identity, retains uncertainty, resumes step8 without spending; stale/agent/replay approvals refused');
c=reviewed();c.status='paused';c.run!.status='paused';c.trendQuality!.status='INCOMPLETE';c.trendRequests=[{...request,id:'missing-request',runId:c.run!.id,contextVersion:contextVersion(c),reviewVersion:c.trendQuality!.version,status:'pending',decision:undefined,options:['correct_context','provide_data','decline']}];
await assert.rejects(()=>runEngine({campaigns:[c],now:at},c,{...cmd,requestId:'missing-request'},settings,defaultBrand,{llm:{request:async()=>{throw Error('No model');}}}),/unavailable|changed/);
const correct={...cmd,requestId:'missing-request',action:'correct_context',context:{product:'Rain jacket',category:'Apparel'}} as TrendResolution;
result=await runEngine({campaigns:[c],now:at},c,correct,settings,defaultBrand,{llm:{request:async()=>{throw Error('No model');}}});
assert.equal(result.campaign.product,'Rain jacket');assert.equal(result.campaign.sharedContext.product,'Rain jacket');assert.equal(result.campaign.trendQuality!.resumeStep,2);assert.equal(result.campaign.run!.step,'trend.receive');assert.equal(trendReadyForHandoff(result.campaign),false);
pass('missing evidence cannot be approved; scope correction uses intake validation, invalidates old support, resumes step2');
c=limited();c.status='paused';c.run!.status='paused';request=c.trendRequests![0];
result=await runEngine({campaigns:[c],now:at},c,{...cmd,requestId:request.id,action:'decline'},settings,defaultBrand,{llm:{request:async()=>{throw Error('No model');}}});
assert.equal(result.campaign.status,'rejected');assert.equal(result.campaign.run!.status,'halted');assert.equal(result.campaign.evidence.length,8);assert.deepEqual(result.campaign.sharedContext.approvedClaims,[]);
pass('founder refusal terminates the run and retains partial work without handoff');
c=reviewed();recordStoredTrend(c);c.run!.status='paused';assert.equal(trendReadyForHandoff(c),false);c.run!.status='running';c.product='Other product';assert.equal(trendReadyForHandoff(c),false);
pass('pause and changed context prevent handoff even after a previously successful save');
{
 const test=base();let modelCalls=0,io=0;const runner=createTrendQuality(undefined,{mode:'mock',complete:async req=>{modelCalls++;return {...stubComplete(req,'MOCK ONLY'),status:'ok',text:JSON.stringify(assessment(test))};}});
 const answer=await runner({campaign:test,brand:defaultBrand,settings,at,allowed:async()=>true,execute:async()=>{io++;throw Error('Sufficient evidence needs no replacement');},onFailedUsage:()=>{}});
 assert.ok(answer.assessment);assert.equal(modelCalls,1);assert.equal(io,0);
 const paused=await runner({campaign:test,brand:defaultBrand,settings,at,allowed:async()=>false,execute:async()=>{throw Error('Paused');},onFailedUsage:()=>{}});assert.equal(paused.assessment,null);
}
pass('typed shared LangChain assessment consumes real fixture excerpts; sufficient evidence avoids extra searches; pause prevents calls');
{
 const upload=await importRetailCsv('sku,category,week,units\nSKU1,Grocery,2026-10-19,0',at);assert.equal(upload.rows[0].units,0);
 const test=reviewed();recordStoredTrend(test);
 const forged={...test,trendRequests:[],trendQuality:{...test.trendQuality!,status:'COMPLETE' as const,version:999}};
 assert.equal(protectResearchSnapshots([forged],[test])[0].trendQuality!.version,test.trendQuality!.version);
 const order:string[]=[];await Promise.all([withWorkspaceLock('test',async()=>{order.push('a');await Promise.resolve();order.push('b');}),withWorkspaceLock('test',async()=>{order.push('c');})]);assert.deepEqual(order,['a','b','c']);
}
pass('zero remains a measured zero; browser snapshots cannot overwrite review authority; inline writes serialize');
{
 const repo=new WorkflowRepository(':memory:');const test=base();test.status='draft';test.run=null;test.researchMode=undefined;
 const job=repo.enqueue('founder','start',{campaign:test,campaigns:[test],brand:defaultBrand,settings,command:{type:'START',actor:'founder'}});const claimed=repo.claim('worker')!;
 const stored=reviewed({...base(),id:test.id});const out={campaign:stored,run:stored.run!,events:[],runSteps:[],policyDecisions:[],canAdvance:true,message:'Assessed'};
 repo.checkpoint(claimed,out,true);assert.equal(repo.campaign('founder',test.id)!.trendQuality!.storedVersion,1);assert.equal(repo.get('founder',job.id).status,'completed');
 assert.throws(()=>repo.enqueue('other','tamper',{campaign:stored,campaigns:[],brand:defaultBrand,settings,command:{...cmd,requestId:'fake'}}));repo.close();
}
pass('durable checkpoint atomically stores the reviewed shared context; another tenant cannot supply a fabricated review');
{
 const test=base();test.evidence[0].observedAt='2020-01-01';let models=0,tools=0;
 const recovered=()=>{const a=assessment(test),fresh=test.evidence.find(e=>e.id==='fresh-original');
   a.areas=a.areas.filter(x=>x.category!=='current_market');
   if(fresh){a.areas.push({category:'current_market',channel:null,summary:fresh.detail,supports:[{evidenceId:fresh.id,quote:fresh.detail}],limitation:''});for(const f of a.findings.filter(f=>['MARKET','OPPORTUNITY','RISK'].includes(f.category)))f.supports=[{evidenceId:fresh.id,quote:fresh.detail}];}
   return a;};
 const runner=createTrendQuality(undefined,{mode:'mock',complete:async req=>{models++;return {...stubComplete(req,'MOCK'),status:'ok',text:JSON.stringify(recovered())};}});
 const outcome=await runner({campaign:test,brand:defaultBrand,settings,at,allowed:async()=>true,onFailedUsage:()=>{},execute:async(name,args)=>{
   tools++;assert.equal(args.category,'current_market');assert.ok(['web.search','web.scrape_page'].includes(name));
   const e:Evidence={...test.evidence[0],id:name==='web.search'?'candidate':'fresh-original',sourceRef:'https://www.abs.gov.au/synthetic/replacement',detail:'Synthetic replacement: recent Australian juice retail observations for the campaign.',observedAt:at.slice(0,10),research:{...test.evidence[0].research!,quality:name==='web.search'?'snippet':'unassessed'}};
   test.evidence.push(e);return {status:'ok',summary:'SYNTHETIC replacement',evidence:[e],data:null};
 }});
 assert.equal(models,2);assert.equal(tools,2);assert.equal(evaluateQuality(test,outcome.assessment,at,'MOCK').status,'COMPLETE');assert.ok(test.researchAttempts?.some(a=>a.phase==='quality'));
}
pass('outdated evidence triggers bounded same-category search and original extraction, then a grounded second assessment recovers');
{
 const test=limited();test.status='paused';test.run!.status='paused';const r=test.trendRequests![0];
 const result=await runEngine({campaigns:[test],now:at},test,{...cmd,requestId:r.id,action:'provide_data',sources:[{url:'https://www.abs.gov.au/synthetic/current_market',category:'current_market'}]},settings,defaultBrand,{llm:{request:async()=>{throw Error('No model in decision command');}}});
 assert.equal(result.campaign.trendQuality!.resumeStep,3);assert.equal(result.campaign.trendSupplementarySources?.length,1);
 const paused=reviewed();paused.run!.status='paused';paused.status='paused';paused.trendQuality!.storedVersion=null;paused.run!.step='trend.handoff';
 const resume=await runEngine({campaigns:[paused],now:at},paused,{type:'START',actor:'founder'},settings,defaultBrand,{llm:{request:async()=>{throw Error('Storage retry must not research');}}});
 assert.equal(resume.campaign.run!.step,'trend.handoff');assert.equal(resume.canAdvance,true);recordStoredTrend(resume.campaign);assert.equal(trendReadyForHandoff(resume.campaign),true);
}
pass('new authorised sources resume step3; storage-restored resume retries persistence before dispatching the same version');
{
 const file=path.join(mkdtempSync(path.join(tmpdir(),'ta04-recovery-')),'workflow.db');
 let repo=new WorkflowRepository(file);const original=base();original.status='draft';original.run=null;
 repo.enqueue('founder','initial',{campaign:original,campaigns:[original],brand:defaultBrand,settings,command:{type:'START',actor:'founder'}});
 const job=repo.claim('worker')!;const pending=limited();pending.id=original.id;pending.status='paused';pending.run!.status='paused';
 repo.checkpoint(job,{campaign:pending,run:pending.run!,events:[],runSteps:[],policyDecisions:[],canAdvance:false,message:'Needs founder review'},true);repo.close();repo=new WorkflowRepository(file);
 const restored=repo.campaign('founder',original.id)!;assert.equal(restored.trendRequests![0].status,'pending');assert.equal(restored.trendQuality!.storedVersion,restored.trendQuality!.version);
 const request=restored.trendRequests![0];const resolution={...cmd,requestId:request.id,reviewVersion:request.reviewVersion,contextVersion:request.contextVersion};
 repo.enqueue('founder','resolve',{campaign:{...restored,trendRequests:[],product:'forged scope'},campaigns:[],brand:defaultBrand,settings,command:resolution});
 const next=repo.claim('worker')!;assert.equal(next.input.campaign.product,'Apple juice');
 const outcome=await runEngine({campaigns:[restored],now:at},next.input.campaign,next.nextCommand,settings,defaultBrand,{ownerUserId:'founder',llm:{request:async()=>{throw Error('Decision must not call providers.');}}});
 repo.checkpoint(next,outcome,true);repo.close();repo=new WorkflowRepository(file);assert.equal(repo.campaign('founder',original.id)!.trendRequests![0].decision,'continue_limited');repo.close();
}
pass('pending request survives database reopen; founder decision survives a second reopen; browser scope tampering is discarded');
{
 const previousFetch=globalThis.fetch,previousKey=process.env.FIRECRAWL_API_KEY;
 try{
   delete process.env.FIRECRAWL_API_KEY;
   globalThis.fetch=async()=>new Response('<html><script type="application/ld+json">{"datePublished":"2026-10-12"}</script><nav>Unrelated navigation</nav><main>Published public observation: zero measured purchases in the sample.</main></html>',{headers:{'content-type':'text/html'}});
   const result=await toolByName('web.scrape_page')!.run({campaign:base(),brand:defaultBrand,at,args:{url:'https://www.abs.gov.au/synthetic/date-test',category:'current_market'}});
   assert.equal(result.evidence[0].observedAt,'2026-10-12');assert.doesNotMatch(result.evidence[0].detail,/navigation/);assert.match(result.evidence[0].detail,/zero/);
 }finally{globalThis.fetch=previousFetch;if(previousKey===undefined)delete process.env.FIRECRAWL_API_KEY;else process.env.FIRECRAWL_API_KEY=previousKey;}
 const previous=process.env.TREND_CURRENT_MAX_AGE_DAYS;
 try{process.env.TREND_CURRENT_MAX_AGE_DAYS='5';const test=base(),q=evaluateQuality(test,assessment(test),at,'MOCK');assert.equal(q.rules.currentMaxAgeDays,5);assert.equal(q.status,'INCOMPLETE');}
 finally{if(previous===undefined)delete process.env.TREND_CURRENT_MAX_AGE_DAYS;else process.env.TREND_CURRENT_MAX_AGE_DAYS=previous;}
}
pass('declared publication metadata is distinct from fetch time; original content excludes navigation; configured currency policy is recorded');
{
 const test=limited();const r=test.trendRequests![0];r.status='resolved';r.decision='continue_limited';r.resolvedAt=at;
 const unchanged=evaluateQuality(test,test.trendQuality!.assessment,at,'MOCK');assert.equal(unchanged.status,'COMPLETE');
 const changed=structuredClone(test.trendQuality!.assessment!);changed.findings[0].claim='Different conclusion using the same finding ID';
 const next=evaluateQuality(test,changed,at,'MOCK');assert.equal(next.status,'INCOMPLETE');assert.ok(next.requests.some(v=>v.status==='pending'&&v.options.includes('continue_limited')));assert.notEqual(next.requests[0].id,r.id);
}
pass('limited continuation is bound to the exact claim, citations, conflict, qualification and rules; a reused finding ID cannot transfer approval');
console.log(`${checks} TA-04 acceptance groups passed. ALL model/data fixtures above are synthetic.`);
if(process.argv.includes('--preview')){
 const {loadWorkspace,saveWorkspace}=await import('../src/lib/auth/workspace');
 const snapshot=await loadWorkspace('dev-alex','dev');
 const pending=limited();pending.id='cmp_ta04_review_fixture';pending.name='TA-04 verification: qualified review (SYNTHETIC)';pending.status='paused';pending.running=false;pending.run!.campaignId=pending.id;pending.run!.status='paused';pending.run!.step='trend.quality';recordStoredTrend(pending);
 const complete=reviewed();complete.id='cmp_ta04_complete_fixture';complete.name='TA-04 verification: complete report (SYNTHETIC)';complete.status='paused';complete.running=false;complete.run!.campaignId=complete.id;complete.run!.status='paused';complete.run!.step='trend.handoff';recordStoredTrend(complete);
 const projected:Campaign[]=[];
 for(const campaign of [pending,complete]){
   campaign.run!.status='running';campaign.status='analysing';campaign.run!.step='trend.quality';
   const output=await runEngine({campaigns:[campaign],now:at},campaign,{type:'ADVANCE',actor:'system'},settings,defaultBrand,{maxSteps:1,llm:{quality:async()=>({assessment:campaign.trendQuality!.assessment,modelStatus:'MOCK ONLY — synthetic preview',replacementAttempts:0}),request:async()=>{throw Error('Preview never calls a provider.');}}});
   output.campaign.status='paused';output.campaign.running=false;output.campaign.run!.status='paused';recordStoredTrend(output.campaign);projected.push(output.campaign);
 }
 const fixtures=projected;await saveWorkspace('dev-alex',{...snapshot,campaigns:[...fixtures,...snapshot.campaigns.filter(c=>!fixtures.some(f=>f.id===c.id))]});
 console.log('Two clearly labelled SYNTHETIC local preview campaigns saved for existing dev-alex. No provider calls made.');
}
