import { uid } from '@/lib/ids';
import { addEvent,addStep,setRun,callTool,type Work,type StepEnv } from './steps';
import { evaluateQuality,trendReadyForHandoff } from '@/lib/trend/quality';
import { contextVersion,type TrendResolution,type ReviewRequest } from '@/lib/trend/quality-contracts';
import { validateIntake } from './intake';
import type { Campaign } from '@/lib/types';
import type { ResearchCategory } from '@/lib/trend/contracts';
import { assembleBrief,briefMatches } from '@/lib/trend/brief';

export async function runTrendQuality(w:Work,env:StepEnv):Promise<{message:string;blocked:boolean}> {
 const c=w.campaign;
 const permitted=async()=>env.researchAllowed?await env.researchAllowed():true;
 if(!await permitted()){c.status='paused';c.running=false;setRun(w,{status:'paused',step:'trend.quality',haltedReason:'Paused; evidence retained.'});return {message:'Quality review paused.',blocked:true};}
 c.status='analysing';c.running=true;
 const saved=c.trendQuality;
 const result=saved?.resumeStep===8&&saved.assessment ? {assessment:saved.assessment,modelStatus:saved.modelStatus,replacementAttempts:0} : await env.llm.quality?.({campaign:c,brand:env.brand,settings:env.settings,at:w.now,allowed:permitted,
   execute:(name,args,override)=>callTool(w,'trend',name,args,env,override),onFailedUsage:cost=>{c.spend.inferenceUsd+=cost;}});
 const q=evaluateQuality(c,result?.assessment??null,w.now,result?.modelStatus??'unavailable',result?.replacementAttempts??0);
 if(c.trendQuality)(c.trendQualityHistory??=[]).push(structuredClone(c.trendQuality));
 c.trendQuality=q;
 const newIds=new Set(q.requests.map(r=>r.id));
 c.trendRequests=[...(c.trendRequests??[]).map(r=>r.status==='pending'&&!newIds.has(r.id)?{...r,status:'superseded' as const}:r).filter(r=>!newIds.has(r.id)),...q.requests];
 c.trendGaps=q.requests.filter(r=>r.status==='pending').map(r=>({id:r.id,kind:'low_confidence',detail:r.reason,effect:r.neededData,needsFounder:true}));
 c.trendGaps.push(...q.limitations.map(detail=>({id:uid('gap'),kind:'low_confidence' as const,detail,effect:'Disclosed evidence limitation.',needsFounder:false})));
 const byId=new Map(c.evidence.map(e=>[e.id,e]));
 c.trendFindings=q.assessment?q.findings.map(f=>({id:f.id,topic:f.category,finding:f.claim,basis:f.supported?'supported':'assumption',relevance:0,confidence:f.confidence==='high'?90:f.confidence==='moderate'?65:0,country:c.country,channelRelevance:c.channels,evidenceIds:f.usableEvidenceIds,
   risk:f.category==='RISK'?f.claim:f.limitation||undefined,themeSuggestion:f.category==='OPPORTUNITY'?f.claim:undefined})):c.trendFindings.map(f=>({...f,basis:'assumption',confidence:0}));
 if(q.assessment)c.opportunities=q.findings.filter(f=>f.category==='OPPORTUNITY').map((f,i)=>({id:f.id,title:f.claim,why:f.relevance,audienceFit:0,expectedValue:f.supported?'Recommendation grounded in cited evidence; no sales outcome promised.':'Unsupported proposal.',rank:i+1}));
 c.trends=c.trendFindings.map(f=>({id:f.id,topic:f.topic,evidence:f.finding,source:f.evidenceIds.map(id=>byId.get(id)?.sourceName).filter(Boolean).join(', ')||'Assumption',relevance:f.relevance,confidence:f.confidence}));
 for(const area of c.researchCoverage??[]){const approved=q.assessment?.areas.find(a=>a.category===area.category&&(area.category!=='channel'||a.channel===area.channel));if(approved)area.analysis={category:area.category,channel:area.channel,summary:approved.summary,evidenceIds:approved.supports.map(s=>s.evidenceId).filter(id=>area.evidenceIds.includes(id)),limitation:approved.limitation};}
 // No arbitrary market-claim approval: only the reviewed main findings travel.
 c.sharedContext={...c.sharedContext,approvedClaims:[]};
 if(c.brief&&q.assessment){
   const market=q.findings.find(f=>f.category==='MARKET'&&f.main&&f.supported);
   const opportunity=q.findings.find(f=>f.category==='OPPORTUNITY'&&f.main&&f.supported);
   c.brief={...c.brief,angle:opportunity?.claim??'Campaign direction awaits sufficient evidence.',keyMessage:market?.claim??'No supported market message yet.',claimsAllowed:q.status==='COMPLETE'?q.findings.filter(f=>f.main&&f.supported&&!['OPPORTUNITY','RISK'].includes(f.category)).map(f=>f.claim):[]};
 }
 if(env.llm.brief){
   c.trendBriefRequired=true;
   if(c.structuredTrendBrief)(c.trendBriefHistory??=[]).push(structuredClone(c.structuredTrendBrief));
   const report=await env.llm.brief({campaign:c,brand:env.brand,settings:env.settings,at:w.now,allowed:permitted,execute:async()=>{throw Error('Report synthesis has no retrieval or action tools.');},onFailedUsage:cost=>{c.spend.inferenceUsd+=cost;}});
   c.structuredTrendBrief=report;
   for(const request of q.requests)if(!c.trendRequests?.some(r=>r.id===request.id)){
     (c.trendRequests??=[]).push(request);
     c.trendGaps.push({id:request.id,kind:'low_confidence',detail:request.reason,effect:request.neededData,needsFounder:request.status==='pending'});
   }
   c.trendFindings.forEach(f=>{const reviewed=q.findings.find(v=>v.id===f.id);if(reviewed&&!reviewed.supported){f.basis='assumption';f.confidence=0;}});
   c.trends.forEach(f=>{const reviewed=q.findings.find(v=>v.id===f.id);if(reviewed&&!reviewed.supported){f.confidence=0;f.evidence='Assumption — final support review failed: '+reviewed.claim;}});
   c.opportunities.forEach(o=>{if(q.findings.some(f=>f.id===o.id&&!f.supported))o.expectedValue='Unsubstantiated proposal; supporting evidence requires clarification.';});
   if(report.validation==='passed'&&report.candidate){
     const order=report.candidate.prioritisedFindingIds;
     c.trendFindings.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
     c.opportunities.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
     c.opportunities.forEach((opportunity,i)=>{opportunity.rank=i+1;});
   }
   if(report.status!=='COMPLETE'){
     q.status='INCOMPLETE';q.limitations=[...new Set([...q.limitations,...report.errors])];
     // Retry the retained assessment and report, rather than spending on a new
     // retrieval. Shared per-run model/token/credit limits still apply.
     if(report.validation!=='passed'&&!q.requests.some(r=>r.status==='pending'))q.resumeStep=8;
   }
   if(c.brief)c.brief={...c.brief,angle:report.validation==='passed'?report.candidate?.themes[0]?.text??'No supported theme available.':'Report synthesis needs review.',visualDirection:report.validation==='passed'?report.candidate?.visualDirections.map(v=>v.text).join(' ')||'Visual direction unavailable.':'Visual direction awaits a validated report.',claimsAllowed:report.status==='COMPLETE'?c.brief.claimsAllowed:[]};
   for(const reason of report.errors)c.trendGaps.push({id:uid('gap'),kind:'low_confidence',detail:reason,effect:'Final report cannot be completed or handed off; retry within the shared run budget.',needsFounder:false});
   addStep(w,'trend.brief','trend',report.validation==='passed'?'ok':'blocked','Structured TrendBrief validated',report.errors.join(' ')||'All report sections, citations, scope rationales and semantic support checks validated.');
 }else if(c.trendBriefRequired){
   c.structuredTrendBrief=assembleBrief(c,null,null,w.now,'unavailable',['Structured brief runner unavailable.']);q.status='INCOMPLETE';
 }
 addEvent(w,'trend','output',q.status==='COMPLETE'?'Evidence review passed — awaiting storage':'Research needs your input',`${q.requiredCategories.filter(v=>v.supported).length}/7 report categories supported. ${q.requests.filter(r=>r.status==='pending').length} requests. Rules ${q.rulesVersion}.`);
 addStep(w,'trend.quality','trend',q.status==='COMPLETE'?'ok':'blocked','Evidence quality assessed',q.limitations.join(' ')||'All required main findings supported.');
 if(!await permitted()||q.status==='INCOMPLETE'){
   c.status='paused';c.running=false;
   setRun(w,{status:'paused',step:'trend.quality',awaiting:q.status==='INCOMPLETE'?'trend_clarification':null,awaitingDetail:[...q.requests.filter(r=>r.status==='pending').map(r=>r.reason),...(c.structuredTrendBrief?.errors??[])].join(' '),haltedReason:q.status==='INCOMPLETE'?'Resolve research requests or retry the failed report within the run budget.':'Paused by founder; explicit resume required.'});
   return {message:'Valid partial work saved; no content-generation handoff.',blocked:true};
 }
 q.resumeStep=13;setRun(w,{status:'running',step:'trend.handoff',awaiting:null,awaitingDetail:null,haltedReason:null});
 return {message:'Evidence sufficient. Save this version before handoff.',blocked:false};
}
export async function handoffTrend(w:Work,env:StepEnv):Promise<{message:string;blocked:boolean}> {
 const c=w.campaign;
 if(env.llm.brief&&c.trendQuality&&!c.trendBriefRequired){
   c.trendBriefRequired=true;c.trendQuality.status='INCOMPLETE';c.trendQuality.storedVersion=null;c.trendQuality.handedOffAt=null;c.trendQuality.resumeStep=8;
   setRun(w,{status:'running',step:'trend.quality'});
   return {message:'Prepare the full structured report from the retained assessment before handoff.',blocked:false};
 }
 if(c.trendBriefRequired&&c.trendQuality&&c.structuredTrendBrief&&!briefMatches(c,c.structuredTrendBrief)&&(!env.researchAllowed||await env.researchAllowed())){
   c.trendQuality.status='INCOMPLETE';c.trendQuality.storedVersion=null;c.trendQuality.handedOffAt=null;
   const changed=c.trendQuality.contextVersion!==contextVersion(c);c.trendQuality.resumeStep=changed?2:3;
   setRun(w,{status:'running',step:changed?'trend.receive':'trend.quality'});
   return {message:'The report, evidence or data permission changed; revalidate before handoff.',blocked:false};
 }
 if(c.trendQuality?.status==='COMPLETE'&&c.trendQuality.contextVersion===contextVersion(c)&&c.trendQuality.storedVersion!==c.trendQuality.version&&(!env.researchAllowed||await env.researchAllowed())){
   c.trendQuality.resumeStep=13;return {message:'Retrying persistence of the supported current brief; handoff awaits confirmation.',blocked:false};
 }
 if(!trendReadyForHandoff(c)||env.researchAllowed&&!await env.researchAllowed()){
   c.status='paused';c.running=false;
   setRun(w,{status:'paused',step:'trend.handoff',haltedReason:'The current supported brief must be stored and execution permitted before handoff.'});
   return {message:'Trend handoff pending; current version retained.',blocked:true};
 }
 // AHR-03 receives the exact stored brief through the orchestrator on the next
 // step. Its handler records acknowledgement before any creative/model call.
 c.sharedContext={...c.sharedContext,approvedClaims:c.trendQuality!.findings.filter(f=>f.main&&f.supported&&!['OPPORTUNITY','RISK'].includes(f.category)).map(f=>f.claim)};
 c.trendQuality!.resumeStep=15;setRun(w,{status:'running',step:'creative.receive'});
 return {message:'Stored evidence-backed brief ready for content generation.',blocked:false};
}
export function resolveTrend(w:Work,env:StepEnv,command:TrendResolution):{message:string;blocked:boolean} {
 const c=w.campaign,q=c.trendQuality;
 const request=c.trendRequests?.find(r=>r.id===command.requestId&&r.status==='pending');
 if(!q||!request||command.contextVersion!==contextVersion(c)||command.contextVersion!==q.contextVersion||command.reviewVersion!==q.version||request.runId!==w.run?.id||!request.options.includes(command.action))throw Error('This research request changed or the selected action is unavailable. Refresh the report.');
 if(!command.note.trim())throw Error('Record a reason for the research decision.');
 if(command.action==='correct_context'){
   if(!command.context||!Object.keys(command.context).length)throw Error('Provide the corrected campaign fields.');
   const candidate={...c,...command.context};
   const problems=validateIntake(candidate,env.brand);
   if(problems.length)throw Error(problems.map(p=>`${p.field}: ${p.message}`).join(' '));
   Object.assign(c,command.context);c.validationProblems=[];
   c.sharedContext={...c.sharedContext,product:c.product,audience:c.targetAudience,objective:c.objective,country:c.country,approvedClaims:[],founderNotes:[...c.sharedContext.founderNotes,command.note]};
   q.resumeStep=2;
 } else if(command.action==='provide_data'){
   if(!command.sources?.length&&!c.retailUpload)throw Error('Provide an authorised source or attach an aggregate export.');
   if(command.sources?.some(s=>!supplementalCategory(c,s.category,s.channel)))throw Error('Evidence must refer to a selected campaign channel.');
   c.trendSupplementarySources=command.sources??[];q.resumeStep=3;
 } else if(command.action==='continue_limited'){
   const affected=q.findings.filter(f=>request.findingIds.includes(f.id));
   if(!affected.length||affected.some(f=>!f.supported)||!request.options.includes('continue_limited'))throw Error('Approval cannot replace sufficient evidence.');
   q.resumeStep=8;
 }
 Object.assign(request,{status:command.action==='decline'?'declined':'resolved',decision:command.action,note:command.note,actorId:env.ownerUserId??'founder',resolvedAt:w.now});
 addEvent(w,'founder','decision','Research decision recorded',`${command.action}: ${command.note}. UC-02 resumes at step ${q.resumeStep}.`);
 if(command.action==='decline'){cancelTrend(w,env,command.note);return {message:'Analysis ended at the founder’s request. Partial work retained.',blocked:true};}
 const scopeChanged=q.contextVersion!==contextVersion(c);
 if(scopeChanged)c.trendRequests=c.trendRequests?.map(r=>r.status==='pending'?{...r,status:'superseded' as const}:r);
 q.status='INCOMPLETE';q.storedVersion=null;q.handedOffAt=null;
 c.status='analysing';c.running=true;
 // Context correction restarts relevance determination; new data is re-gathered
 // in its category. Limited continuation reuses the exact reviewed assessment.
 setRun(w,{status:'running',step:scopeChanged?'trend.receive':'trend.quality',awaiting:null,awaitingDetail:null,haltedReason:null});
 return {message:`Decision saved. Continue UC-02 from step ${q.resumeStep}.`,blocked:false};
}
export function cancelTrend(w:Work,env:StepEnv,note:string):void {
 w.campaign.status='rejected';w.campaign.running=false;
 w.campaign.sharedContext={...w.campaign.sharedContext,approvedClaims:[]};
 w.campaign.trendRequests=w.campaign.trendRequests?.map(r=>r.status==='pending'?{...r,status:'declined' as const,decision:'decline',note,actorId:env.ownerUserId??'founder',resolvedAt:w.now}:r);
 setRun(w,{status:'halted',haltedReason:note||'Analysis cancelled.',awaiting:null,awaitingDetail:null});
 addEvent(w,'founder','decision','Trend analysis cancelled',note||'Partial work retained. No handoff.');
}
/** UC-02 2.a: retained work + a specific correction request for invalid context. */
export function contextRequest(c:Campaign,at:string,reason:string):ReviewRequest {
 return {id:`${c.run?.id}:context`,runId:c.run?.id??'',contextVersion:contextVersion(c),reviewVersion:(c.trendQuality?.version??0)+1,category:'context',findingIds:[],reason,question:'Please correct the required campaign information.',neededData:reason,options:['correct_context','decline'],status:'pending',requestedAt:at};
}
export function supplementalCategory(c:Campaign,category:ResearchCategory,channel?:string):boolean{return category!=='channel'||Boolean(channel&&c.channels.includes(channel as Campaign['channels'][number]));}
