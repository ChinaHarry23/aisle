/** Opt-in hosted acceptance, using synthetic campaign scope and real configured
 * model/public tools. Normal CI and --check make no remote calls. */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const ready=Boolean(process.env.LANGSMITH_API_KEY||process.env.LANGCHAIN_API_KEY);
if(!process.argv.includes('--live')) {
 console.log(JSON.stringify({configured:ready,project:process.env.LANGSMITH_PROJECT||'aisle',status:ready?'Ready for explicit --live acceptance':'PENDING: existing LangSmith configuration required; never paste credentials into chat'}));
}else{
 if(!ready)throw Error('Existing LangSmith key required. Set it locally; no credential is printed.');
 const index=process.argv.indexOf('--user'),userId=index>=0?process.argv[index+1]:undefined;
 if(!userId)throw Error('Use --live --user <existing local billing user>.');
 // Global flags also protect automatic child traces; never upload Work, raw model
 // prompts, private notes, CSV rows, HTTP headers or provider response bodies.
 process.env.LANGSMITH_HIDE_INPUTS='true';process.env.LANGSMITH_HIDE_OUTPUTS='true';process.env.LANGSMITH_TRACING='true';process.env.LANGCHAIN_CALLBACKS_BACKGROUND='false';
 const {Client}=await import('langsmith');
 const {LangChainTracer}=await import('@langchain/core/tracers/tracer_langchain');
 const {blankCampaign,defaultBrand}=await import('../src/lib/seed');
 const {defaultSettings}=await import('../src/lib/settings');
 const {createServerResearchRuntime}=await import('../src/lib/agents/trend-server');
 const {findUserById}=await import('../src/lib/auth/users');
 const {billingFor}=await import('../src/lib/billing/meter');
 const {runEngine}=await import('../src/lib/runtime/engine');
 const {setShelfPriceLookup}=await import('../src/lib/runtime/tools');
 const {lookupShelfPrices}=await import('../src/lib/retail/whichgrocer/connection');
 const user=await findUserById(userId);if(!user)throw Error('Existing billing identity unavailable.');
 const project=process.env.LANGSMITH_PROJECT||'aisle';process.env.LANGSMITH_PROJECT=project;
 const client=new Client({hideInputs:true,hideOutputs:true}),tracer=new LangChainTracer({client,projectName:project});
 const settings=defaultSettings();settings.agents.trend={provider:'openai',modelId:'openai:gpt-6-luna'};
 const at=new Date().toISOString(),start=new Date();start.setUTCDate(start.getUTCDate()+7);const end=new Date(start);end.setUTCDate(end.getUTCDate()+20);
 const c=blankCampaign({name:'SCRUM-124 public-tool acceptance (synthetic campaign)',product:'Apple juice',category:'Grocery',country:'AU',targetAudience:'Australian adult shoppers',objective:'Research retail opportunities',budget:1000,channels:['web'],startDate:start.toISOString().slice(0,10),endDate:end.toISOString().slice(0,10),notes:''},defaultBrand,null,settings);
 const rootId=randomUUID();setShelfPriceLookup(lookupShelfPrices);
 const runtime=createServerResearchRuntime(billingFor(user));
 // This ticket validates collection/routing. TA-04/05 have their own semantic
 // acceptance; do not create ads or spend on downstream stages for this probe.
 const result=await runEngine({campaigns:[c],now:at},c,{type:'START',actor:'founder'},settings,defaultBrand,{llm:{...runtime,quality:undefined,brief:undefined},traceConfig:{runId:rootId,callbacks:[tracer]},renderPoster:async()=>{throw Error('No creative/media I/O permitted.');}});
 await client.awaitPendingTraceBatches();
 const root=await client.readRun(rootId,{loadChildRuns:true});
 const all:(typeof root)[]=[];const visit=(r:typeof root)=>{all.push(r);r.child_runs?.forEach(visit);};visit(root);
 const trend=all.find(r=>r.name==='trend'),seat=all.find(r=>r.name==='aisle_trend');
 const ancestor=(r:typeof root,target:string):boolean=>r.parent_run_id===target||!!r.parent_run_id&&!!all.find(p=>p.id===r.parent_run_id&&ancestor(p,target));
 const campaign=result.campaign,cited=new Set(campaign.researchCoverage?.flatMap(a=>a.analysis?.evidenceIds??[])??[]);
 const selected=campaign.researchAttempts?.filter(a=>a.phase==='agent'&&a.status==='ok'&&a.evidenceIds.some(id=>cited.has(id)))??[];
 const audit=selected.map(a=>({tool:a.tool,evidence:campaign.evidence.filter(e=>a.evidenceIds.includes(e.id)&&cited.has(e.id)).map(e=>({id:e.id,url:e.sourceRef,observedAt:e.observedAt,fetchedAt:e.fetchedAt}))}));
 const checks={hostedRoot:root.name.startsWith('aisle.operation.START'),nestedSeat:!!trend&&!!seat&&ancestor(seat,trend.id)&&ancestor(trend,root.id),twoCitedToolTypes:new Set(selected.map(a=>a.tool)).size>=2,allAreasAssessed:campaign.researchCoverage?.every(a=>!!a.analysis)===true,safePartial:campaign.status==='paused'&&campaign.sharedContext.approvedClaims.length===0};
 const url=await client.getRunUrl({run:root});
 await client.updateRun(rootId,{extra:{metadata:{scrum124Acceptance:checks,publicEvidenceAudit:audit,inputOutputPolicy:'Hidden; synthetic public campaign only'}}});
 await client.awaitPendingTraceBatches();
 const summary={at,mode:'LIVE hosted LangSmith and configured model/public tools; synthetic campaign; no publication',project,url,checks,audit,spendUsd:campaign.spend.inferenceUsd};
 writeFileSync('docs/SCRUM-124-HOSTED-TRACE.json',JSON.stringify(summary,null,2)+'\n');
 console.log(JSON.stringify({url,checks}));if(!Object.values(checks).every(Boolean))process.exitCode=1;
}
