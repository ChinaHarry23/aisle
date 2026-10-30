import assert from 'node:assert/strict';
import { trendRequestSize, reserveTrendRequest, TREND_REQUEST_LIMITS } from '../src/lib/trend/request-budget';
import { planResearchRequest } from '../src/lib/trend/research-request';
import { createTrendResearch } from '../src/lib/agents/trend-research';
import { defaultBrand, blankCampaign } from '../src/lib/seed';
import { defaultSettings } from '../src/lib/settings';
import { stubComplete } from '../src/lib/llm/stub';
import type { CompleteRequest } from '../src/lib/llm/types';
import type { Evidence } from '../src/lib/runtime/types';
import type { ResearchCategory } from '../src/lib/trend/contracts';
const settings=defaultSettings();settings.agents.trend={provider:'local',modelId:'local:custom'};
const fixture=()=>blankCampaign({name:'Budget regression',product:'Chicken breast',category:'Grocery',targetAudience:'Adult shoppers',objective:'Awareness',budget:1000,channels:['web','email'],startDate:'2026-11-02',endDate:'2026-11-16',country:'AU',notes:''},defaultBrand,null,settings);
const at='2026-10-26T09:14:15Z';
let checks=0;const pass=(name:string)=>{checks++;console.log('PASS '+name);};
const req:CompleteRequest={agent:'trend',modelId:'local:custom',prompt:'',maxOutputTokens:4000,tools:[{name:'web.scrape_page',description:'Read an original',parameters:{}},{name:'final_response',description:'Structured analysis',parameters:{}}]};
req.prompt='a'.repeat(31684-Buffer.byteLength(JSON.stringify(req)));
assert.equal(trendRequestSize(req).bytes,31684);
assert.ok(trendRequestSize(req).inputTokens<11000);
const plan=planResearchRequest(req,{names:['web.scrape_page'],calls:4,tokens:17522,enrichmentCalls:4,finishSoon:false,finalContext:()=>{throw Error('No compaction needed');}});
assert.equal(plan.final,true);assert.deepEqual(plan.request.tools?.map(t=>t.name),['final_response']);
assert.ok(17522+plan.inputTokens+4000<48000);
pass('live 31,684-byte request with 17,522 spent tokens reaches synthesis within the existing 48,000-token allowance');
const oversized={...req,prompt:'x'.repeat(65000),history:[{role:'assistant' as const,content:'',toolCalls:[{id:'read',name:'web.scrape_page',args:{}}]}],lastTurnIsToolResult:true,toolCallId:'read'};
const compact=planResearchRequest(oversized,{names:['web.scrape_page'],calls:5,tokens:32000,enrichmentCalls:6,finishSoon:false,finalContext:()=>JSON.stringify({source:'ev-original',excerpt:'Original product preparation instructions',limitation:'No audience preference measurement'})});
assert.equal(compact.request.history,undefined);assert.equal(compact.request.lastTurnIsToolResult,undefined);assert.equal(compact.request.toolCallId,undefined);
assert.match(compact.request.prompt,/ev-original/);assert.match(compact.request.prompt,/No audience preference/);assert.ok(compact.bytes<60000);
pass('oversized history becomes a complete source-ledger synthesis request without orphaned tool messages');
const closing=planResearchRequest({...req,prompt:'short'},{names:['web.scrape_page'],calls:2,tokens:2000,enrichmentCalls:1,finishSoon:true,finalContext:()=>''});
assert.equal(closing.final,true);assert.ok(!closing.request.tools?.some(t=>t.name==='web.scrape_page'));
const first=planResearchRequest({...req,prompt:'short'},{names:['web.scrape_page'],calls:1,tokens:0,enrichmentCalls:0,finishSoon:false,finalContext:()=>''});
assert.equal(first.request.toolChoice,'required');assert.deepEqual(first.request.tools?.map(t=>t.name),['web.scrape_page']);
pass('time allowance closes with analysis while an ordinary first turn still collects original evidence');
const budgetCampaign=fixture();budgetCampaign.trendRequestBudget={runId:'unlaunched',calls:3,tokens:145000,costUsd:0.01};
assert.equal(reserveTrendRequest(budgetCampaign,trendRequestSize(req).inputTokens,4000).calls,4);
const used=budgetCampaign.trendRequestBudget.calls;
assert.throws(()=>reserveTrendRequest(budgetCampaign,TREND_REQUEST_LIMITS.tokens,4000),/exhausted/);
assert.equal(budgetCampaign.trendRequestBudget.calls,used);
assert.ok(trendRequestSize({...req,prompt:'漢字'.repeat(100)}).inputTokens>trendRequestSize({...req,prompt:'ab'.repeat(100)}).inputTokens);
pass('shared research stages reserve estimated tokens, retain actual usage, and refuse exhausted calls before dispatch');
const oldEnv={...process.env};
try{
 delete process.env.LANGSMITH_TRACING;delete process.env.LANGCHAIN_TRACING_V2;
 const c=fixture();let turn=0,booked=0;const outputs=[4211,5252,8059,2100];
 const answer={researchAnalysis:[{category:'current_market',summary:'Use the original product preparation instructions.',evidenceIds:['original-3'],limitation:'Preference not measured'}],priorities:[],angle:'Practical dinner',keyMessage:'Chicken and vegetables',claimsAllowed:[],claimsAvoid:['Unmeasured health benefits'],visualDirection:'Show the meal and pack',limitations:['No audience preference measurement']};
 const result=await createTrendResearch(undefined,{mode:'mock',complete:async request=>{
   if(String(request.prompt??'').includes('Product seasonality judgement'))return {...stubComplete(request,'SYNTHETIC ONLY'),status:'ok',text:JSON.stringify({seasonal:true,reason:'This fixture product has a seasonal occasion worth checking.'})};
   turn++;
   const response={...stubComplete(request,'SYNTHETIC ONLY'),status:'ok' as const};
   response.usage={...response.usage,inputTokens:outputs[turn-1]-100,outputTokens:100,totalTokens:outputs[turn-1],costUsd:0.01};
   if(turn<=3)return {...response,text:null,toolCalls:[{id:`read-${turn}`,name:'web.scrape_page',args:{category:'current_market',url:`https://www.coles.com.au/product/original-${turn}`}}]};
   assert.match(JSON.stringify(request),/original-3/);
   return {...response,text:JSON.stringify(answer)};
 }})({campaign:c,brand:defaultBrand,settings,at,allowed:async()=>true,onFailedUsage:cost=>{booked+=cost;},execute:async(name,args,override)=>{
   if(override)return override;
   const original=name==='web.scrape_page';
   const category=(args.category??'historical_market') as ResearchCategory;
   const evidence:Evidence[]=[{id:original?`original-${turn}`:`candidate-${category}-${args.channel??''}`,claim:'Synthetic source',detail:'Original product preparation and vegetable meal information. '.repeat(22),sourceName:'Fixture original',sourceRef:original?args.url:`https://www.coles.com.au/${category}/${args.channel??''}`,sourceKind:'external_public',observedAt:null,fetchedAt:at,status:'verified',confidence:0,raisedBy:'trend',usedFor:category,research:{category,channel:args.channel,permission:'allowed',quality:original?'unassessed':'snippet',geography:'AU',queryScope:category}}];
   return {status:'ok',summary:'Synthetic observed result',data:null,evidence};
 }});
 assert.ok(result);assert.equal(turn,4);assert.equal(result.decision.researchAnalysis?.[0].evidenceIds[0],'original-3');
 assert.equal(c.researchModelTurns?.at(-1)?.phase,'assessment');assert.equal(c.trendRequestBudget?.tokens,19622);
 assert.equal(booked,0.04);assert.equal(result.trace.usage.costUsd,0);
 pass('real LangChain loop reads three originals then synthesizes their IDs; every completion is booked exactly once');
 const originalNow=Date.now;let clock=0,queuedReads=0,queuedTurns=0;
 try{
  Date.now=()=>clock;
  const queued=fixture();
  const completed=await createTrendResearch(undefined,{mode:'mock',complete:async request=>{
   if(String(request.prompt??'').includes('Product seasonality judgement'))return {...stubComplete(request,'SYNTHETIC ONLY'),status:'ok',text:JSON.stringify({seasonal:true,reason:'This fixture product has a seasonal occasion worth checking.'})};
   const response={...stubComplete(request,'SYNTHETIC ONLY'),status:'ok' as const};
   if(++queuedTurns===1){clock=134000;return {...response,text:null,toolCalls:[1,2,3].map(i=>({id:`queued-${i}`,name:'web.scrape_page',args:{category:'current_market',url:`https://www.coles.com.au/product/queue-${i}`}}))};}
   assert.ok(request.tools?.every(t=>t.name!=='web.scrape_page'));
   return {...response,text:JSON.stringify(answer)};
  }})({campaign:queued,brand:defaultBrand,settings,at,allowed:async()=>true,onFailedUsage:()=>{},execute:async(name,_args,override)=>{
   if(override)return override;
   if(name==='web.scrape_page'){queuedReads++;clock+=12000;}
   return {status:'empty',summary:'No source result',data:null,evidence:[]};
  }});
  assert.ok(completed);assert.equal(queuedReads,1);assert.equal(queuedTurns,2);
  assert.equal(queued.researchAttempts?.filter(a=>a.phase==='agent'&&a.status==='skipped').length,2);
  pass('queued reads check the synthesis deadline when executed, leaving the last 45 seconds for analysis');
 }finally{Date.now=originalNow;}

}finally{for(const key of Object.keys(process.env))if(!(key in oldEnv))delete process.env[key];Object.assign(process.env,oldEnv);}
console.log(`${checks} research budget checks passed. No live provider calls.`);
