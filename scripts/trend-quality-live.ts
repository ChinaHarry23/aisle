/** Explicit owner-run probe: actual metered semantic review of previously
 * retrieved public TA-03 records; campaign inputs are synthetic. No ad calls. */
import {readFileSync,writeFileSync} from 'node:fs';
import {blankCampaign,defaultBrand} from '../src/lib/seed';
import {defaultSettings} from '../src/lib/settings';
import {findUserById} from '../src/lib/auth/users';
import {billingFor} from '../src/lib/billing/meter';
import {createTrendQuality} from '../src/lib/agents/trend-quality';
import {runEngine} from '../src/lib/runtime/engine';
import type {Campaign} from '../src/lib/types';
const liveUser=process.env.TA04_LIVE_USER_ID??(process.argv.includes('--user')?process.argv[process.argv.indexOf('--user')+1]:undefined);
const liveCase=process.env.TA04_LIVE_CASE??(process.argv.includes('--case')?process.argv[process.argv.indexOf('--case')+1]:undefined);
if(!liveUser)throw Error('An explicit existing local billing user is required.');
const user=await findUserById(liveUser);if(!user)throw Error('User unavailable.');
const records=JSON.parse(readFileSync('docs/TA-03-LIVE-ACCEPTANCE-RELEASE.json','utf8')).records as {product:string;category:string;evidence:Campaign['evidence'];attempts:Campaign['researchAttempts'];coverage:Campaign['researchCoverage']}[];
const settings=defaultSettings();settings.agents.trend={provider:'openai',modelId:'openai:gpt-6-luna'};
const out:unknown[]=liveCase?JSON.parse(readFileSync('docs/TA-04-LIVE-VALIDATION.json','utf8')).cases.filter((c:{summary:{category:string}})=>c.summary.category!==liveCase):[];
for(const row of records){
 if(liveCase&&row.category!==liveCase)continue;
 const now=new Date().toISOString();
 const c=blankCampaign({name:'TA04 LIVE review probe — synthetic campaign scope',product:row.product,category:row.category,targetAudience:'Australian adult shoppers',objective:'Research seasonal retail promotion opportunities',budget:1000,channels:[row.category==='Grocery'?'web':'email'],startDate:'2026-11-01',endDate:'2026-12-26',country:'AU',notes:''},defaultBrand,null,settings);
 c.evidence=row.evidence;c.researchAttempts=row.attempts;c.researchCoverage=row.coverage;c.researchMode='agent';c.status='analysing';c.running=true;c.spend.capUsd=1;
 c.run={id:'ta04-live-'+row.category,campaignId:c.id,status:'running',step:'trend.quality',startedAt:now,updatedAt:now,stepsTaken:0,maxSteps:36,revisionAttempts:0,toolsUsed:[],haltedReason:null,awaiting:null,awaitingDetail:null};
 c.brief={product:c.product,angle:'Review required',audience:c.targetAudience,channels:c.channels,keyMessage:'No approved message',claimsAllowed:[],claimsAvoid:[],visualDirection:'Pending supported research'};
 console.log('START actual quality review '+row.category);
 const result=await runEngine({campaigns:[c],now},c,{type:'ADVANCE',actor:'system'},settings,defaultBrand,{ownerUserId:user.id,maxSteps:1,llm:{quality:createTrendQuality(billingFor(user)),request:async()=>{throw Error('No advertising or extra decision request permitted.');}},renderPoster:async()=>{throw Error('No advertising permitted.');}});
 const actual=result.campaign,q=actual.trendQuality!;
 const checks={realSharedModel:actual.researchModelTurns?.some(t=>t.phase==='quality'&&t.status==='ok'&&t.modelId===settings.agents.trend.modelId)===true,typedAssessment:q.assessment!==null,allResearchAreas:q.researchAreas.length===8,allReportCategories:q.requiredCategories.length===7,unknownDatesNotFresh:q.evidence.filter(e=>{const name=actual.evidence.find(v=>v.id===e.id)?.sourceName??'';return e.currency==='unknown'&&!['Firecrawl Scrape','Public source text','SerpApi Google Trends'].includes(name);}).every(e=>!e.accepted),safeHandoff:q.status==='INCOMPLETE'?actual.sharedContext.approvedClaims.length===0&&actual.run?.step==='trend.quality':q.storedVersion===null&&actual.run?.step==='trend.handoff',boundedReplacement:q.replacementAttempts<=4};
 if(!Object.values(checks).every(Boolean))process.exitCode=1;
 const summary={product:c.product,category:c.category,model:settings.agents.trend.modelId,checks,status:q.status,acceptedEvidence:q.evidence.filter(e=>e.accepted).length,requiredFindingsSupported:q.requiredCategories.filter(e=>e.supported).length,openRequests:q.requests.filter(r=>r.status==='pending').length,replacementAttempts:q.replacementAttempts,estimatedCostUsd:c.spend.inferenceUsd};
 console.log(JSON.stringify(summary));out.push({summary,quality:q,attempts:actual.researchAttempts,modelTurns:actual.researchModelTurns});
 writeFileSync('docs/TA-04-LIVE-VALIDATION.json',JSON.stringify({at:now,mode:'Actual shared model + bounded public replacements; previously retrieved real public evidence; synthetic campaign inputs; no advertising',cases:out},null,2)+'\n');
 writeFileSync('docs/TA-04-ACCEPTANCE-SUMMARY.json',JSON.stringify({at:now,mode:'Actual shared model review of previously retrieved public evidence; synthetic campaign inputs; no advertising',cases:out.map(v=>(v as {summary:unknown}).summary)},null,2)+'\n');
}
