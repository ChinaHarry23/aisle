/** TA-06: versioned local ranking over the reviewed ledger. No I/O or model
 * scores. Planning value/effort is ordinal judgement, never ROI or a quotation. */
import type { Campaign } from '@/lib/types';
import { contextVersion } from './quality-contracts';

export const RANKING_RULES = {
  version:'ta06-1',
  weights:{product:12,audience:14,objective:12,timing:10,country:8,channels:10,budget:8,quality:12,recency:8,value:6},
  tieBreak:'Supported material risks first; supported before assumptions; score descending, then quality, recency, stable finding ID.',
  meaning:'0–100 relative editorial priority, not confidence, probability, causation, forecast ROI or authority to spend.',
  confidence:'High/moderate/low are qualitative source-review judgements. High means accepted support without a recorded qualification; moderate retains qualifications/conflict; low is insufficient. They are not calibrated probabilities.',
} as const;
export type ResourceNeed='existing_assets'|'single_asset'|'multiple_assets'|'unknown';
export type RankingApplication={findingIds:string[];application:string;visualDirection?:string;channelApproach?:string;resourceNeed?:ResourceNeed;potentialValue?:'high'|'moderate'|'low'|'unknown'};
export type RankFactor={value:number;weight:number;points:number;reason:string};
export type RankedFinding={findingId:string;category:string;supported:boolean;score:number;rank:number;riskRank:number|null;opportunityRank:number|null;attention:boolean;confidence:string;factors:Record<keyof typeof RANKING_RULES.weights,RankFactor>;reason:string;evidenceIds:string[];counterEvidenceIds:string[];uncertainty:string[];signals:string[];themeImplication:string;visualImplication:string;channelImplication:string;sensitivity:string};
export type FindingRanking={version:string;contextVersion:string;runId:string;qualityVersion:number;asOf:string;rows:RankedFinding[];opportunityIds:string[];riskIds:string[];attentionIds:string[];limitations:string[]};
const normalize=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const quoteText=(s:string)=>s.toLowerCase().replace(/\s+/g,' ').trim();
const stop=new Set(['the','and','for','with','from','this','that','their','into','a','an','of','to','in','on','or','brand','campaign']);
function words(text:string){return [...new Set(normalize(text).split(' ').filter(w=>w.length>2&&!stop.has(w)))];}
function textFit(context:string,source:string){const wanted=words(context),found=new Set(words(source));return wanted.length?wanted.filter(w=>found.has(w)).length/wanted.length:0;}
function day(s:string|null|undefined){return s&&/^\d{4}-\d{2}-\d{2}/.test(s)&&Number.isFinite(Date.parse(s))?Date.parse(s.slice(0,10)):null;}
function signal(c:Campaign,id:string){const e=c.evidence.find(e=>e.id===id);if(!e)return 'Unavailable source';
 if(e.sourceKind==='internal_retail')return 'Observed uploaded retailer units; not representative preference or causal demand';
 if(/trends|serpapi/i.test(e.sourceName))return 'Relative search interest; not sales';
 if(/abs/i.test(e.sourceName))return 'Aggregate spending; not product sales or individual preference';
 if(/nager|holiday/i.test(e.sourceName))return 'Calendar timing; not cultural purchasing preference';
 if(/weather|meteo/i.test(e.sourceName))return 'Weather context; not observed demand or causation';
 if(e.research?.category==='competitor')return 'Public competitor/catalogue observation; not measured purchases';
 return 'Scoped public source observation; retain population, period and measurement';
}
export function rankFindings(c:Campaign,applications:RankingApplication[]=[]):FindingRanking{
 const q=c.trendQuality,valid=!!q&&q.contextVersion===contextVersion(c)&&q.runId===(c.run?.id??'unlaunched');
 const asOf=q?.assessedAt??c.run?.startedAt??'unknown',now=day(asOf);
 const rows:RankedFinding[]=(q?.findings??[]).map(f=>{
  const records=c.evidence.filter(e=>f.usableEvidenceIds.includes(e.id)&&q!.evidence.some(r=>r.id===e.id&&r.accepted)&&e.origin!=='synthetic'&&(e.sourceKind!=='internal_retail'||c.internalDataAuthorised===true)&&(e.status==='verified'||e.status==='conflicting')&&f.supports.some(s=>s.evidenceId===e.id&&quoteText(e.detail).includes(quoteText(s.quote)))).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const supported=valid&&f.supported&&records.length>0;
  // Only exact reviewed excerpts determine lexical scope fit; model relevance
  // prose, notes and numeric confidence fields cannot increase a score.
  const source=f.supports.filter(s=>records.some(e=>e.id===s.evidenceId)).map(s=>s.quote).join(' ');
  const plans=applications.filter(a=>a.findingIds.includes(f.id)).sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);
  const needs=[...new Set(plans.map(p=>p.resourceNeed??'unknown'))];
  const need:ResourceNeed=needs.length===1?needs[0]:'unknown';
  const budget=c.budget<=1000?'small':c.budget<5000?'medium':'large';
  const effort:Record<ResourceNeed,number>=budget==='small'?{existing_assets:1,single_asset:0.5,multiple_assets:0,unknown:0.25}:budget==='medium'?{existing_assets:1,single_asset:1,multiple_assets:0.5,unknown:0.25}:{existing_assets:1,single_asset:1,multiple_assets:1,unknown:0.25};
  const factor=(key:keyof typeof RANKING_RULES.weights,value:number,reason:string):RankFactor=>({value:Math.round(Math.max(0,Math.min(1,value))*1000)/1000,weight:RANKING_RULES.weights[key],points:Math.round(Math.max(0,Math.min(1,value))*RANKING_RULES.weights[key]*100)/100,reason});
  const coverage=records.flatMap(e=>{const start=day(e.coverage?.start),end=day(e.coverage?.end),a=day(c.startDate),b=day(c.endDate);return start!==null&&end!==null&&a!==null&&b!==null?[Math.max(0,Math.min(end,b)-Math.max(start,a)+86400000)/Math.max(86400000,b-a+86400000)]:[];});
  const timing=coverage.length?Math.min(1,Math.max(...coverage)):records.some(e=>q!.evidence.find(r=>r.id===e.id)?.temporal==='fits')?0.5:0;
  const geography=records.map(e=>e.research?.geography===c.country?1:q!.evidence.find(r=>r.id===e.id)?.geography==='transferable'?0.5:0);
  const namedChannels=[...new Set(records.flatMap(e=>e.research?.channel?[e.research.channel]:[]))];
  const channelFit=namedChannels.length?c.channels.filter(ch=>namedChannels.includes(ch)).length/Math.max(1,c.channels.length):0.25;
  const sourceQuality=records.map(e=>q!.evidence.find(r=>r.id===e.id)?.reliability==='primary'?1:0.6);
  const recency=records.map(e=>{const review=q!.evidence.find(r=>r.id===e.id),d=day(e.observedAt);if(review?.currency==='historical')return 0.6;if(d===null||now===null||d>now)return 0;return Math.max(0,1-(now-d)/86400000/Math.max(1,q!.rules?.currentMaxAgeDays??120));});
  const values=[...new Set(plans.map(p=>p.potentialValue??'unknown'))];const value=values.length===1?values[0]:'unknown';const potential=value==='high'?1:value==='moderate'?0.6:value==='low'?0.2:0.25;
  const factors={
   product:factor('product',textFit(c.product,source),'Share of product keywords present in reviewed quotations; no semantic equivalence assumed.'),
   audience:factor('audience',textFit(c.targetAudience,source),'Share of audience keywords in reviewed quotations; population generalisation is not inferred.'),
   objective:factor('objective',textFit(c.objective,source),'Share of objective keywords in reviewed quotations; an objective match is not proof of campaign impact.'),
   timing:factor('timing',timing,coverage.length?'Overlap of explicit source applicability windows with campaign dates.':'No exact applicability window: a reviewed temporal fit receives half credit, not a forecast.'),
   country:factor('country',geography.length?Math.max(...geography):0,'Reviewed source geography versus the approved country; transferable support receives half credit.'),
   channels:factor('channels',channelFit,namedChannels.length?'Selected-channel coverage in source records: '+namedChannels.join(', '):'No channel-specific source: limited generic context only.'),
   budget:factor('budget',Number.isFinite(c.budget)&&c.budget>0?effort[need]:0,`Budget ${c.budget} (${budget} planning tier); resource need ${need}. Effort is a creative planning assumption, not a quoted cost or spend authorisation.`),
   quality:factor('quality',sourceQuality.length?sourceQuality.reduce((a,b)=>a+b,0)/sourceQuality.length*(f.conflict||f.limitation?0.75:1):0,'Accepted primary/credible source review, reduced by 25% for a recorded conflict or qualification; model confidence numbers never enter this factor.'),
   recency:factor('recency',recency.length?Math.max(...recency):0,'Source information dates against the fixed review date; reviewed historical context gets a separate 0.6, not current status.'),
   value:factor('value',potential,'Ordinal strategic value proposed in the creative plan; unknown gets 0.25. It is not measured uplift or ROI.'),
  };
  const score=supported?Math.round(Object.values(factors).reduce((n,f)=>n+f.points,0)*100)/100:0;
  const attention=f.category==='RISK'&&(f.material||!!f.conflict);
  const uncertainty=[...new Set([f.limitation,...f.reasons,f.conflict?.explanation,!supported?'Insufficient/currently inapplicable support; excluded from established recommendations.':'',need==='unknown'?'Resource requirement is unknown or planning proposals disagree.':'',values.length>1?'Conflicting potential-value judgements use the conservative unknown value.':''].filter((x):x is string=>!!x))];
  const application=plans.map(p=>p.application).join(' ');
  return {findingId:f.id,category:f.category,supported,score,rank:0,riskRank:null,opportunityRank:null,attention,confidence:f.confidence,factors,
   reason:`${supported?'Evidence-supported':'Assumption / insufficient support'}; ${score}/100 relative priority. ${attention?'Material/conflicting risk is retained in the separate attention queue. ':''}${application||'No specific creative application established; retain the finding and its limits.'}`,
   evidenceIds:records.map(e=>e.id).sort(),counterEvidenceIds:[...new Set(f.conflict?.evidenceIds??[])].sort(),uncertainty,signals:[...new Set(records.map(e=>signal(c,e.id)))],
   themeImplication:application|| (f.category==='RISK'?`Review this risk before choosing a message: ${f.claim}`:'No grounded theme mapped; test a clearly labelled product-led concept.'),
   visualImplication:plans.map(p=>p.visualDirection).filter(Boolean).join(' ') || (f.category==='RISK'?`Review wording and visual claims against this risk: ${f.claim}`:'Use a scene linked to a mapped research insight; otherwise keep the exact product recognisable and label the scene as a creative hypothesis.'),
   channelImplication:plans.map(p=>p.channelApproach).filter(Boolean).join(' ') || `Apply only to selected channels (${c.channels.join(', ')}). ${namedChannels.length?'Source channel scope: '+namedChannels.join(', '):'Channel response is not established.'}`,
   sensitivity:['RISK','SEASONAL_CULTURAL'].includes(f.category)?`Preserve the source's dates and population; do not turn a calendar event or weather pattern into cultural preference. ${f.limitation}`:'No additional sensitivity established; this is not a declaration that the campaign is risk-free.'};
 });
 rows.sort((a,b)=>Number(b.supported)-Number(a.supported)||Number(b.supported&&b.attention)-Number(a.supported&&a.attention)||b.score-a.score||b.factors.quality.points-a.factors.quality.points||b.factors.recency.points-a.factors.recency.points||(a.findingId<b.findingId?-1:a.findingId>b.findingId?1:0));
 rows.forEach((r,i)=>r.rank=i+1);
 const opportunities=rows.filter(r=>r.category==='OPPORTUNITY'),risks=rows.filter(r=>r.category==='RISK');
 opportunities.forEach((r,i)=>r.opportunityRank=i+1);risks.forEach((r,i)=>r.riskRank=i+1);
 return {version:RANKING_RULES.version,contextVersion:contextVersion(c),runId:c.run?.id??'unlaunched',qualityVersion:q?.version??0,asOf,rows,opportunityIds:opportunities.map(r=>r.findingId),riskIds:risks.map(r=>r.findingId),attentionIds:rows.filter(r=>r.attention).map(r=>r.findingId),limitations:['Keyword fit is a conservative lexical heuristic; synonyms and unstated populations are not inferred. A zero is not evidence of irrelevance.','Budget tiers (≤1000, <5000, ≥5000) and resource/value labels are planning choices in campaign budget units, not provider prices or school thresholds.',...(!valid?['Current campaign/run evidence review unavailable; all ranks are exploratory.']:[])]};
}
