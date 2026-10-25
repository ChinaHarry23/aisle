import type { Campaign } from '@/lib/types';
import { contextVersion, findingResearch, type FindingCategory } from './quality-contracts';
import { briefCandidateSchema,briefAuditSchema,BRIEF_SECTIONS,type BriefCandidate,type BriefAudit,type StructuredTrendBrief } from './brief-contracts';

export const sectionCategories:Record<typeof BRIEF_SECTIONS[number],FindingCategory[]>={market_summary:['MARKET'],current_trends:['MARKET','TREND'],historical_trends:['TREND'],customer_interests:['CUSTOMER'],purchasing_preferences:['CUSTOMER'],seasonal:['SEASONAL_CULTURAL'],cultural:['SEASONAL_CULTURAL'],channel:['OPPORTUNITY','RISK','MARKET','TREND','CUSTOMER'],competitor:['COMPETITOR'],opportunities:['OPPORTUNITY'],risks:['RISK']};
export const sectionResearch:Partial<Record<typeof BRIEF_SECTIONS[number],string>>={market_summary:'current_market',current_trends:'current_market',historical_trends:'historical_market',customer_interests:'customer_interest',purchasing_preferences:'purchase_preference',seasonal:'seasonal',cultural:'cultural',channel:'channel',competitor:'competitor'};
export function requiredBriefSections(c:Campaign){return BRIEF_SECTIONS.flatMap(key=>(key==='channel'?c.channels:[null]).map(channel=>({key,channel})));}
/** Negative support checks may withdraw a candidate's acceptance. They can
 * never create support or resolve a founder decision. Preserve the original
 * claim/quotes and request the existing TA-04 recovery path. */
export function applyBriefSupportAudit(c:Campaign,audit:BriefAudit,at:string):void{
 const q=c.trendQuality;if(!q)return;
 for(const f of q.findings.filter(f=>f.supported)){
  const checks=audit.findings.filter(v=>v.id===f.id);if(checks.length!==1||checks[0].supported)continue;
  const reason='Final claim support review: '+checks[0].reason;
  const affectedIds=[...f.usableEvidenceIds];
  f.supported=false;f.confidence='low';f.reasons.push(reason);f.limitation=[f.limitation,reason].filter(Boolean).join(' ');f.usableEvidenceIds=[];
  const original=q.assessment?.findings.find(v=>v.id===f.id);if(original){original.confidence='low';original.limitation=f.limitation;}
  for(const area of q.researchAreas){if(c.evidence.some(e=>affectedIds.includes(e.id)&&e.research?.category===area.category&&e.research?.channel===area.channel)){area.supported=false;area.reason=reason;}}
  const id=`${q.runId}:${q.contextVersion}:brief-support:${f.id}`;
  q.requests=q.requests.filter(r=>r.id!==id);
  q.requests.push({id,runId:q.runId,contextVersion:q.contextVersion,reviewVersion:q.version,category:f.category,findingIds:[f.id],reason,question:'Can you clarify the affected claim or provide an unambiguous authorised source?',neededData:'Direct support for the exact proposition, period, geography and measurement; preserve the rejected claim for audit.',options:['correct_context','provide_data','decline'],status:'pending',requestedAt:at});
  q.limitations.push(reason);q.status='INCOMPLETE';
 }
 q.requiredCategories.forEach(category=>{category.supported=q.findings.some(f=>f.category===category.category&&f.main&&f.supported);});
}
function supportFingerprint(c:Campaign,b:BriefCandidate|null,audit:BriefAudit|null){
 const text=JSON.stringify([c.id,c.run?.id,contextVersion(c),c.internalDataAuthorised,c.retailUpload?.sha256,c.trendQuality?.version,c.trendQuality?.findings,b,audit,c.evidence.filter(e=>c.trendQuality?.evidence.some(r=>r.id===e.id&&r.accepted)),c.sharedContext.previousAdvice]);
 let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return (h>>>0).toString(16);
}

/** Structural checks plus a separate semantic review. A judge result is never evidence. */
export function validateBrief(c:Campaign,raw:unknown,auditRaw:unknown,requireAudit=true):string[]{
 const q=c.trendQuality,parsed=briefCandidateSchema.safeParse(raw),judged=briefAuditSchema.safeParse(auditRaw);
 if(!q||q.contextVersion!==contextVersion(c)||q.runId!==c.run?.id)return ['Quality review does not belong to the current campaign context/run.'];
 if(!parsed.success)return ['Invalid structured TrendBrief: '+parsed.error.issues.slice(0,6).map(e=>e.path.join('.')+': '+e.message).join('; ')];
 const b=parsed.data,errors:string[]=[];
 const unique=(ids:string[],what:string)=>{if(new Set(ids).size!==ids.length)errors.push('Duplicate '+what+'.');};
 unique(b.prioritisedFindingIds,'prioritised finding IDs');
 if(b.prioritisedFindingIds.length!==q.findings.length||q.findings.some(f=>!b.prioritisedFindingIds.includes(f.id)))errors.push('Every reviewed finding must be retained once in priority order.');
 for(const id of b.prioritisedFindingIds)if(!q.findings.some(f=>f.id===id))errors.push('Unknown or stale-run finding: '+id);
 const expected=requiredBriefSections(c);
 if(b.sections.length!==expected.length)errors.push('Unexpected report section or selected-channel count.');
 for(const e of expected){
  const rows=b.sections.filter(s=>s.key===e.key&&s.channel===e.channel),s=rows[0];
  if(rows.length!==1){errors.push('Missing/duplicate section: '+e.key+(e.channel?' / '+e.channel:''));continue;}
  unique(s.findingIds,'section finding IDs');
  for(const id of s.findingIds)if(!q.findings.some(f=>f.id===id&&sectionCategories[e.key].includes(f.category)))errors.push('Unrelated section finding: '+id+' / '+e.key);
  const area=sectionResearch[e.key];
  const supported=area?q.researchAreas.some(a=>a.category===area&&(!e.channel||a.channel===e.channel)&&a.supported):s.findingIds.some(id=>q.findings.some(f=>f.id===id&&f.main&&f.supported));
  if((!supported||!s.findingIds.length)&&!s.unavailableReason.trim())errors.push('Unavailable section requires a reason: '+e.key);
  if(supported&&q.status==='COMPLETE'&&(!s.findingIds.some(id=>q.findings.some(f=>f.id===id&&f.main&&f.supported))||s.unavailableReason.trim()))errors.push('Complete evidence-backed section missing: '+e.key);
 }
 unique(b.relevance.map(r=>r.findingId),'relevance entries');
 for(const f of q.findings){
  if(!b.relevance.some(r=>r.findingId===f.id))errors.push('Missing scope and priority rationale: '+f.id);
  const citations=b.substantiation.filter(s=>s.findingId===f.id);
  if(f.supported&&!citations.length)errors.push('Supported finding needs exact citations: '+f.id);
  for(const s of citations){
   const e=c.evidence.find(e=>e.id===s.evidenceId);
   if(!f.supported||!e||!q.evidence.some(r=>r.id===e.id&&r.accepted)||!f.usableEvidenceIds.includes(e.id)||!f.supports.some(v=>v.evidenceId===s.evidenceId&&v.quote===s.quote)||!e.detail.includes(s.quote)||!e.research||!findingResearch[f.category].includes(e.research.category))errors.push('Invented, unrelated, excluded or changed support: '+f.id+' / '+s.evidenceId);
  }
 }
 if(b.substantiation.some(s=>!q.findings.some(f=>f.id===s.findingId)))errors.push('Citation refers to an unknown finding.');
 if(b.relevance.some(s=>!q.findings.some(f=>f.id===s.findingId)))errors.push('Relevance refers to an unknown finding.');
 const proposals=[...b.inferences,...b.themes,...b.visualDirections];unique(proposals.map(p=>p.id),'proposal IDs');
 if(proposals.some(p=>q.findings.some(f=>f.id===p.id)))errors.push('Proposal IDs must be separate from factual findings.');
 for(const p of proposals)if(p.basedOnFindingIds.some(id=>!q.findings.some(f=>f.id===id&&f.supported)))errors.push('Unsupported proposal basis: '+p.id);
 if(q.status==='COMPLETE'&&(!b.themes.length||!b.visualDirections.length))errors.push('Complete brief needs grounded themes and visual directions.');
 if(requireAudit){
  if(!judged.success)errors.push('Independent semantic support check unavailable or malformed.');
  else{
   for(const f of q.findings.filter(f=>f.supported)){
    const checks=judged.data.findings.filter(a=>a.id===f.id);
    if(checks.length!==1||!checks[0].supported)errors.push('Claim support check failed: '+f.id+' — '+(checks[0]?.reason??'missing check'));
   }
   for(const p of proposals){const checks=judged.data.proposals.filter(a=>a.id===p.id);if(checks.length!==1||!checks[0].grounded)errors.push('Proposal grounding check failed: '+p.id+' — '+(checks[0]?.reason??'missing check'));}
   if(judged.data.findings.some(a=>!q.findings.some(f=>f.id===a.id&&f.supported))||judged.data.proposals.some(a=>!proposals.some(p=>p.id===a.id)))errors.push('Semantic audit includes unknown identifiers.');
  }
 }
 return [...new Set(errors)];
}

export function assembleBrief(c:Campaign,candidate:BriefCandidate|null,audit:BriefAudit|null,at:string,modelStatus:string,extraErrors:string[]=[]):StructuredTrendBrief{
 const errors=[...new Set([...extraErrors,...validateBrief(c,candidate,audit)])],q=c.trendQuality;
 const cited=new Set([...(candidate?.substantiation.map(s=>s.evidenceId)??[]),...(q?.assessment?.areas.filter(a=>q.researchAreas.some(r=>r.category===a.category&&(a.category!=='channel'||r.channel===a.channel)&&r.supported)).flatMap(a=>a.supports.map(s=>s.evidenceId))??[])]);
 return {briefId:c.id+':'+(c.run?.id??'unlaunched')+':brief',campaignId:c.id,runId:c.run?.id??'unlaunched',contextVersion:contextVersion(c),version:q?.version??0,qualityVersion:q?.version??0,generatedAt:at,status:!errors.length&&q?.status==='COMPLETE'?'COMPLETE':'INCOMPLETE',validation:errors.length?'failed':'passed',errors,modelStatus,candidate,audit,supportReviewFingerprint:supportFingerprint(c,candidate,audit),findings:structuredClone(q?.findings??[]),sources:c.evidence.filter(e=>cited.has(e.id)&&q?.evidence.some(r=>r.id===e.id&&r.accepted)).map(e=>({evidenceId:e.id,name:e.sourceName,ref:e.sourceRef,informationDate:e.observedAt,retrievedAt:e.fetchedAt})),limitations:[...new Set([...(q?.limitations??[]),...(candidate?.limitations??[]),...errors])],previousAdvice:c.sharedContext.previousAdvice??null};
}
export function briefMatches(c:Campaign,b:StructuredTrendBrief):boolean{
 return b.briefId===c.id+':'+c.run?.id+':brief'&&b.version===c.trendQuality?.version&&b.campaignId===c.id&&b.runId===c.run?.id&&b.contextVersion===contextVersion(c)&&b.qualityVersion===c.trendQuality?.version&&b.supportReviewFingerprint===supportFingerprint(c,b.candidate,b.audit)&&b.validation==='passed'&&validateBrief(c,b.candidate,b.audit).length===0&&JSON.stringify(b.findings)===JSON.stringify(c.trendQuality.findings);
}
