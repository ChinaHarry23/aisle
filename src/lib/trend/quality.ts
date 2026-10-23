/** Stage 1 pp5–6,9–10,19–23,36–38,44,47–48,51–52,55–56.
 * Evidence acquisition, semantic judgement, deterministic acceptance and human
 * authority remain separate. Source text is data, never workflow authority.
 */
import type { Campaign } from '@/lib/types';
import type { Evidence } from '@/lib/runtime/types';
import { publicSourceUrl } from './source-tools';
import { RESEARCH_CATEGORIES } from './contracts';
import { contextVersion, FINDING_CATEGORIES, findingResearch, QUALITY_RULES, qualityAssessmentSchema,configuredQualityRules,type QualityRules,
  type QualityAssessment,type TrendQuality,type EvidenceReview,type FindingReview,type ReviewRequest } from './quality-contracts';
const decisionFingerprint=(value:unknown)=>{const text=JSON.stringify(value);let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return (h>>>0).toString(16);};
const normalized=(s:string)=>s.toLowerCase().replace(/\s+/g,' ').trim();
export function sourceIdentity(e:Evidence):string {
  try {const u=new URL(e.sourceRef);return u.hostname.replace(/^www\./,'')+u.pathname.replace(/\/$/,'');}catch{return e.sourceRef;}
}
export function evidenceCurrency(e:Evidence,now:string,rules:QualityRules=configuredQualityRules()):EvidenceReview['currency'] {
  if(!e.observedAt || !Number.isFinite(Date.parse(e.observedAt)))return 'unknown';
  if(e.status==='stale')return 'outdated';
  const end=e.coverage?.end??e.observedAt;
  if(e.research?.category==='historical_market')return Date.parse(end)<=Date.parse(now)?'historical':'unknown';
  const age=(Date.parse(now)-Date.parse(end))/86400000;
  const window=e.research?.category==='cultural'?rules.culturalMaxAgeDays:rules.currentMaxAgeDays;
  return age < -2 ? (e.coverage?'current':'unknown') : age > window ? 'outdated' : 'current';
}
export function evaluateQuality(c:Campaign, raw:QualityAssessment|null, at:string, modelStatus:string, replacementAttempts=0,rules:QualityRules=configuredQualityRules()):TrendQuality {
  const parsed=qualityAssessmentSchema.safeParse(raw), assessment=parsed.success?parsed.data:null;
  const version=(c.trendQuality?.version??0)+1, ctx=contextVersion(c), runId=c.run?.id??'unlaunched';
  // Review only this run's ledger, never old/unrelated candidate records.
  const ledger=c.evidence.filter(e=>c.researchCoverage?.some(a=>a.evidenceIds.includes(e.id)));
  const seen=new Map<string,string>();
  const evidence:EvidenceReview[]=ledger.map(e=>{
    const matches=assessment?.evidence.filter(v=>v.id===e.id)??[];
    const semantic=matches.length===1?matches[0]:null;
    const currency=evidenceCurrency(e,at,rules), exclusions:string[]=[];
    if(!semantic)exclusions.push('No unique semantic review for this record.');
    if(e.sourceKind==='internal_retail'?!c.internalDataAuthorised:e.sourceKind!=='external_public'||!publicSourceUrl(e.sourceRef))exclusions.push('Unauthorised or non-public source.');
    if(semantic?.sensitive)exclusions.push('Sensitive information excluded.');
    if(e.research?.permission!=='allowed')exclusions.push('No evidence access permission.');
    if(e.status!=='verified'&&e.status!=='conflicting')exclusions.push('Source is not usable.');
    if(e.research?.quality==='snippet')exclusions.push('Search snippet requires original-source verification.');
    if(semantic?.relevant!==true)exclusions.push('Relevance not established.');
    if(semantic?.geography!=='matches'&&semantic?.geography!=='transferable')exclusions.push('Geographical applicability not established.');
    if(semantic?.reliability==='uncertain')exclusions.push('Source reliability uncertain.');
    if(semantic?.temporal!=='fits'||currency==='outdated'||currency==='unknown')exclusions.push('Currency or target-period fit not established.');
    const fingerprint=normalized(e.detail).replace(/[^a-z0-9]/g,'');
    const identity=sourceIdentity(e), duplicate=seen.get(identity)|| (fingerprint.length>80?seen.get(fingerprint):undefined);
    const origin=semantic?.originEvidenceId;
    if(origin && origin!==e.id && !ledger.some(v=>v.id===origin))exclusions.push('Unknown original-source reference.');
    const independentOrigin=duplicate??origin??e.id;
    seen.set(identity,independentOrigin);if(fingerprint.length>80)seen.set(fingerprint,independentOrigin);
    return {...(semantic??{id:e.id,sensitive:false,relevant:false,geography:'unknown' as const,temporal:'unknown' as const,reliability:'uncertain' as const,originEvidenceId:null,reason:'Assessment unavailable.'}),accepted:!exclusions.length,currency,independentOrigin,exclusions};
  });
  // Union shared origins transitively; all syndicated members have one key.
  const parents=new Map(evidence.map(e=>[e.id,e.id]));
  const root=(id:string):string=>{const next=parents.get(id);return next&&next!==id?root(next):id;};
  for(const v of evidence){const a=root(v.id),b=root(v.independentOrigin);if(a!==b)parents.set(a<b?b:a,a<b?a:b);}
  for(const v of evidence)v.independentOrigin=root(v.id);
  const findings:FindingReview[]=(assessment?.findings??[]).map(f=>{
    const reasons:string[]=[], usable:string[]=[];
    for(const support of f.supports){
      const e=ledger.find(e=>e.id===support.evidenceId),review=evidence.find(e=>e.id===support.evidenceId);
      if(!e||!review?.accepted||!normalized(e.detail).includes(normalized(support.quote))){reasons.push(`Invalid, excluded or non-verbatim support: ${support.evidenceId}`);continue;}
      if(!e.research||!findingResearch[f.category].includes(e.research.category)){reasons.push(`Evidence category does not support ${f.category}: ${e.id}`);continue;}
      usable.push(e.id);
    }
    if(!usable.length)reasons.push('No accepted evidence directly supports this finding.');
    const independentSources=new Set(usable.map(id=>evidence.find(e=>e.id===id)!.independentOrigin)).size;
    if(f.material && independentSources<rules.materialMinIndependentSources && !usable.some(id=>evidence.find(e=>e.id===id)?.reliability==='primary'))reasons.push('Material claim needs independent corroboration or a directly applicable primary record.');
    if(f.confidence==='low')reasons.push('Finding confidence is too low.');
    if(f.conflict?.evidenceIds.some(id=>!ledger.some(e=>e.id===id)))reasons.push('Conflict cites an unknown record.');
    if(f.conflict&&!f.conflict.explained&&!f.limitation.trim())reasons.push('Unresolved conflict requires a disclosed limitation.');
    if(f.conflict?.explained&&!f.conflict.explanation.trim())reasons.push('Conflict explanation missing.');
    if((assessment?.findings.filter(other=>other.id===f.id).length??0)!==1)reasons.push('Finding ID is not unique.');
    return {...f,confidence:f.conflict||f.limitation?'moderate' as const:f.confidence,supported:!reasons.length,usableEvidenceIds:[...new Set(usable)],independentSources,reasons};
  });
  const researchAreas=RESEARCH_CATEGORIES.flatMap(category=>(category==='channel'?c.channels:[undefined]).map(channel=>{
    const area=c.researchCoverage?.find(a=>a.category===category&&a.channel===channel);
    const matches=assessment?.areas.filter(a=>a.category===category&&(category!=='channel'||a.channel===channel))??[];
    const reviewed=matches.length===1?matches[0]:null;
    const supported=Boolean(area?.attempts?.length&&reviewed?.summary&&reviewed.supports.length&&reviewed.supports.every(s=>{
      const record=ledger.find(e=>e.id===s.evidenceId);
      return record&&record.research?.category===category&&(!channel||record.research.channel===channel)&&evidence.some(e=>e.id===s.evidenceId&&e.accepted)&&normalized(record.detail).includes(normalized(s.quote));
    }));
    return {category,...(channel?{channel}:{}),supported,reason:supported?'Assessment has applicable, current authorised evidence.':`No sufficient evidence-backed assessment for ${category}${channel?' / '+channel:''}.`};
  }));
  const requiredCategories=FINDING_CATEGORIES.map(category=>({category,supported:findings.some(f=>f.category===category&&f.main&&f.supported)}));
  const requests:ReviewRequest[]=[];
  const add=(key:string,category:ReviewRequest['category'],reason:string,findingIds:string[]=[],limited=false)=>{
    const id=`${runId}:${ctx}:${key}`;
    const old=c.trendRequests?.find(r=>r.id===id&&r.status!=='superseded');
    requests.push({...old,id,runId,contextVersion:ctx,reviewVersion:version,category,findingIds,reason,
      question:limited?'May this analysis continue with the stated limitation?':'Can you correct the brief or provide relevant authorised evidence?',
      neededData:limited?'Review both sources, the qualified conclusion and its disclosed uncertainty.':'A dated original source matching the affected category, geography and campaign question.',
      options:limited?['correct_context','provide_data','continue_limited','decline']:['correct_context','provide_data','decline'],
      status:old?.decision==='continue_limited'&&limited?'resolved':'pending',requestedAt:old?.requestedAt??at});
  };
  for(const a of researchAreas)if(!a.supported)add(`area:${a.category}:${a.channel??''}`,a.category,a.reason);
  for(const cat of requiredCategories)if(!cat.supported)add(`output:${cat.category}`,cat.category,`The report needs a sufficiently supported main ${cat.category.toLowerCase()} finding.`,findings.filter(f=>f.category===cat.category).map(f=>f.id));
  for(const f of findings){
    if(f.main&&!f.supported&&!requests.some(r=>r.findingIds.includes(f.id)))add(`finding:${f.id}`,f.category,f.reasons.join(' '),[f.id]);
    else if(f.supported&&(f.material&&f.limitation.trim()||f.conflict&&!f.conflict.explained))add(`limited:${f.id}:${decisionFingerprint([f.claim,f.supports,f.conflict,f.limitation,rules])}`,f.category,f.limitation||'Evidence conflicts; both accounts are retained.',[f.id],true);
  }
  const passed=Boolean(assessment&&researchAreas.every(a=>a.supported)&&requiredCategories.every(a=>a.supported)&&findings.filter(f=>f.main).every(f=>f.supported)&&requests.every(r=>r.status==='resolved'));
  return {rules,version,contextVersion:ctx,runId,rulesVersion:QUALITY_RULES.version,assessedAt:at,status:passed?'COMPLETE':'INCOMPLETE',storedVersion:null,handedOffAt:null,resumeStep:12,evidence,findings,researchAreas,requiredCategories,
    limitations:[...new Set([...findings.flatMap(f=>f.limitation?[f.limitation]:[]),...evidence.flatMap(e=>e.exclusions.map(reason=>`${e.id}: ${reason}`))])],requests,replacementAttempts,assessment,modelStatus};
}
export function recordStoredTrend(c:Campaign):void {
 const q=c.trendQuality;if(!q||q.contextVersion!==contextVersion(c))return;
 c.sharedContext={...c.sharedContext,trendBrief:{version:q.version,contextVersion:q.contextVersion,status:q.status,evidenceIds:q.evidence.map(e=>e.id),findings:q.findings,limitations:q.limitations}};
 q.storedVersion=q.version;
}
export function trendReadyForHandoff(c:Campaign):boolean {
  const q=c.trendQuality;return Boolean(q&&q.status==='COMPLETE'&&q.contextVersion===contextVersion(c)&&q.runId===c.run?.id&&q.storedVersion===q.version&&c.sharedContext.trendBrief?.version===q.version&&c.sharedContext.trendBrief.status==='COMPLETE'&&q.researchAreas.every(a=>a.supported)&&q.requiredCategories.every(a=>a.supported)&&q.findings.filter(f=>f.main).every(f=>f.supported)&&!c.trendRequests?.some(r=>r.contextVersion===q.contextVersion&&r.status==='pending')&&c.run?.status==='running');
}
