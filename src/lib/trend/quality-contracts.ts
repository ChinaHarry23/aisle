import { z } from 'zod';
import type { Campaign } from '@/lib/types';
import type { ResearchInput, ResearchCategory } from './contracts';
export const FINDING_CATEGORIES = ['MARKET','TREND','CUSTOMER','SEASONAL_CULTURAL','COMPETITOR','OPPORTUNITY','RISK'] as const;
export type FindingCategory = typeof FINDING_CATEGORIES[number];
export const qualityAssessmentSchema = z.object({
  evidence: z.array(z.object({
    id:z.string(), sensitive:z.boolean(), relevant:z.boolean(), geography:z.enum(['matches','transferable','mismatch','unknown']),
    temporal:z.enum(['fits','outdated','unknown']), reliability:z.enum(['primary','credible','uncertain']),
    originEvidenceId:z.string().nullable().default(null).describe('ID of the original record if this is copied/syndicated; null if no shared origin is established.'),
    reason:z.string().min(1).max(650),
  }).strict()).max(100),
  areas:z.array(z.object({category:z.enum(['current_market','historical_market','customer_interest','purchase_preference','seasonal','cultural','channel','competitor']),channel:z.string().nullable(),summary:z.string().min(1).max(900),supports:z.array(z.object({evidenceId:z.string(),quote:z.string().min(12).max(650)}).strict()).max(5),limitation:z.string().max(650)}).strict()).max(32),
  findings:z.array(z.object({
    id:z.string().min(1).max(80), category:z.enum(FINDING_CATEGORIES), claim:z.string().min(1).max(1200),
    main:z.boolean(), confidence:z.enum(['high','moderate','low']),
    supports:z.array(z.object({evidenceId:z.string(),quote:z.string().min(12).max(650)}).strict()).max(10),
    relevance:z.string().min(1).max(600),
    conflict:z.object({evidenceIds:z.array(z.string()).min(2).max(8), explanation:z.string().max(800), explained:z.boolean()}).strict().nullable(),
    limitation:z.string().max(800), material:z.boolean().default(true),
  }).strict()).max(30),
}).strict();
export type QualityAssessment = z.infer<typeof qualityAssessmentSchema>;
export type EvidenceReview = QualityAssessment['evidence'][number] & { accepted:boolean; currency:'current'|'historical'|'outdated'|'unknown'; independentOrigin:string; exclusions:string[] };
export type FindingReview = QualityAssessment['findings'][number] & { supported:boolean; usableEvidenceIds:string[]; independentSources:number; reasons:string[] };
export type ReviewRequest = {
  id:string; runId:string; contextVersion:string; reviewVersion:number; category:FindingCategory|ResearchCategory|'context'; findingIds:string[];
  reason:string; question:string; neededData:string; options:('correct_context'|'provide_data'|'continue_limited'|'decline')[];
  status:'pending'|'resolved'|'declined'|'superseded'; requestedAt:string; resolvedAt?:string; decision?:string; note?:string; actorId?:string;
};
export type TrendQuality = {
  version:number; contextVersion:string; runId:string; rulesVersion:string; assessedAt:string;
  status:'INCOMPLETE'|'COMPLETE'; storedVersion:number|null; handedOffAt:string|null;
  resumeStep:2|3|8|12|13|15; evidence:EvidenceReview[]; findings:FindingReview[];
  researchAreas:{category:ResearchCategory;channel?:string;supported:boolean;reason:string}[];
  requiredCategories:{category:FindingCategory;supported:boolean}[];
  limitations:string[]; requests:ReviewRequest[]; replacementAttempts:number;
  assessment:QualityAssessment|null; modelStatus:string; rules:QualityRules;
};
export type TrendResolution = {
  type:'RESOLVE_TREND';actor:'founder'; requestId:string; reviewVersion:number; contextVersion:string;
  action:'correct_context'|'provide_data'|'continue_limited'|'decline';note:string;
  context?: Partial<Pick<Campaign,'product'|'category'|'targetAudience'|'objective'|'budget'|'channels'|'startDate'|'endDate'|'country'>>;
  sources?:{url:string;category:ResearchCategory;channel?:string}[];
};
export type QualityRunner = (input:ResearchInput) => Promise<{assessment:QualityAssessment|null;modelStatus:string;replacementAttempts:number}>;
/** Named, versioned implementation rules; no numeric threshold is attributed to Stage 1. */
export const QUALITY_RULES = {
  version:'ta04-2', currentMaxAgeDays:120, culturalMaxAgeDays:730, replacementCallLimit:4,
  minIndependentSources:1, materialMinIndependentSources:2,
};
export type QualityRules=typeof QUALITY_RULES;
export function configuredQualityRules():QualityRules {
 const bounded=(key:string,fallback:number,max:number)=>{const raw=process.env[key];const value=raw?Number(raw):fallback;return Number.isInteger(value)&&value>=1&&value<=max?value:fallback;};
 return {...QUALITY_RULES,currentMaxAgeDays:bounded('TREND_CURRENT_MAX_AGE_DAYS',QUALITY_RULES.currentMaxAgeDays,730),culturalMaxAgeDays:bounded('TREND_CULTURAL_MAX_AGE_DAYS',QUALITY_RULES.culturalMaxAgeDays,3650),materialMinIndependentSources:bounded('TREND_MATERIAL_MIN_SOURCES',QUALITY_RULES.materialMinIndependentSources,5)};
}
export function contextVersion(c:Campaign):string {
  const text=JSON.stringify([c.product,c.category,c.targetAudience,c.objective,c.budget,c.channels,c.startDate,c.endDate,c.country,
    c.dataAccessPolicy,c.sharedContext.previousPerformanceNote]);
  let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);
  return (h>>>0).toString(16);
}
export const findingResearch:Record<FindingCategory,ResearchCategory[]>={MARKET:['current_market'],TREND:['historical_market'],CUSTOMER:['customer_interest','purchase_preference'],SEASONAL_CULTURAL:['seasonal','cultural'],COMPETITOR:['competitor'],OPPORTUNITY:['current_market','customer_interest','purchase_preference','channel'],RISK:['current_market','historical_market','customer_interest','purchase_preference','seasonal','cultural','channel','competitor']};
