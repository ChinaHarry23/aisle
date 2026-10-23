/** Explicit live owner-run acceptance probe; never invoked by the test suite. */
import { writeFileSync } from 'node:fs';
import { blankCampaign, defaultBrand } from '../src/lib/seed';
import { defaultSettings } from '../src/lib/settings';
import { createServerResearchRuntime } from '../src/lib/agents/trend-server';
import { runEngine } from '../src/lib/runtime/engine';
import { findUserById } from '../src/lib/auth/users';
import { billingFor } from '../src/lib/billing/meter';
if (!process.env.TA03_LIVE_USER_ID || !process.env.TREND_PROVIDER_SEARCH_MAX_USD) throw Error('Explicit existing local user and search-cost bound required.');
const user = await findUserById(process.env.TA03_LIVE_USER_ID);
if (!user) throw Error('Existing local user required.');
const settings=defaultSettings();
settings.agents.trend={provider:'openai',modelId:'openai:gpt-6-luna'};
const records:unknown[]=[];
for (const [product,category,channel] of [['Apple juice','Grocery','web'],['Rain jacket','Apparel','email']] as const) {
 if(process.env.TA03_LIVE_CASE && process.env.TA03_LIVE_CASE!==category)continue;
 const at=new Date().toISOString();
 const campaign=blankCampaign({name:`LIVE acceptance: ${product}`,product,category,targetAudience:'Australian adult shoppers',objective:'Research seasonal retail promotion opportunities',budget:1000,channels:[channel],startDate:'2026-11-01',endDate:'2026-12-26',country:'AU',notes:''},defaultBrand,null,settings);
 console.log(`START ${category}`);
 try {
 const result=await runEngine({campaigns:[campaign],now:at},campaign,{type:'START',actor:'founder'},settings,defaultBrand,{llm:createServerResearchRuntime(billingFor(user)),renderPoster:async()=>{throw Error('Live research acceptance must not generate advertising assets.');}});
 const c=result.campaign;
 const cited=new Set(c.researchCoverage?.flatMap(a=>a.analysis?.evidenceIds ?? []) ?? []);
 const agentCalls=c.researchAttempts?.filter(a=>a.phase==='agent') ?? [];
 const citedTools=[...new Set(agentCalls.filter(a=>a.status==='ok'&&a.evidenceIds.some(id=>cited.has(id))).map(a=>a.tool))];
 const checks={allAreasAttempted:c.researchCoverage?.every(a=>a.attempts.some(t=>t.phase==='mandatory'))===true,
   allAreasAssessed:c.researchCoverage?.every(a=>Boolean(a.analysis))===true,
   twoAgentToolTypes:new Set(agentCalls.map(a=>a.tool)).size>=2,twoToolTypesCited:citedTools.length>=2,
   validToolArguments:c.researchModelTurns?.every(t=>!t.invalidTools?.length)===true,
   safePartial:c.status==='paused'&&c.sharedContext.approvedClaims.length===0,
   liveModel:c.researchModelTurns?.some(t=>t.status==='ok'&&t.modelId===settings.agents.trend.modelId)===true};
 if(!Object.values(checks).every(Boolean))process.exitCode=1;
 console.log(JSON.stringify({acceptance:checks,citedTools}));
 records.push({at,mode:'LIVE providers; synthetic campaign inputs; no publication',product,category,checks,citedTools,model:settings.agents.trend.modelId,status:c.status,evidence:c.evidence,attempts:c.researchAttempts,coverage:c.researchCoverage,toolCalls:c.toolCalls,modelTurns:c.researchModelTurns,spend:c.spend,runSteps:c.runSteps,log:c.log});
 console.log(JSON.stringify({category,status:c.status,evidence:c.evidence.length,attempts:c.researchAttempts?.length,spend:c.spend}));
 } catch(e) {records.push({at,category,error:e instanceof Error?e.name:'Error'});console.log(`${category}: failed; inspect sanitized run records`);}
 writeFileSync(process.env.TA03_LIVE_OUTPUT || 'docs/TA-03-LIVE-ACCEPTANCE.json',JSON.stringify({at:new Date().toISOString(),records},null,2)+'\n');
}
