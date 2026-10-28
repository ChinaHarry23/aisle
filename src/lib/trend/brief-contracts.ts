import { z } from 'zod';
import type { ResearchInput } from './contracts';
import type { FindingReview } from './quality-contracts';

export const BRIEF_SECTIONS = ['market_summary','current_trends','historical_trends','customer_interests','purchasing_preferences','seasonal','cultural','channel','competitor','opportunities','risks'] as const;
const text = z.string().min(1).max(800);
const direction = z.object({id:text, text, basedOnFindingIds:z.array(text).min(1).max(10), rationale:text}).strict();
/** Facts are selected from the reviewed ledger, never silently rewritten by a writer. */
export const briefCandidateSchema = z.object({
  sections:z.array(z.object({key:z.enum(BRIEF_SECTIONS),channel:z.string().nullable(),findingIds:z.array(text).max(30),unavailableReason:z.string().max(800)}).strict()).max(32),
  prioritisedFindingIds:z.array(text).max(30),
  substantiation:z.array(z.object({findingId:text,evidenceId:text,quote:z.string().min(12).max(650)}).strict()).max(100),
  relevance:z.array(z.object({findingId:text,product:text,audience:text,objective:text,timing:text,country:text,channels:text,budget:text,priorityReason:text}).strict()).max(30),
  inferences:z.array(direction).max(8), themes:z.array(direction).max(8), visualDirections:z.array(direction).max(8),
  limitations:z.array(text).max(40),
}).strict();
export type BriefCandidate = z.infer<typeof briefCandidateSchema>;
export const briefAuditSchema = z.object({
  findings:z.array(z.object({id:text,supported:z.boolean(),reason:text}).strict()).max(30),
  proposals:z.array(z.object({id:text,grounded:z.boolean(),reason:text}).strict()).max(24),
}).strict();
export type BriefAudit = z.infer<typeof briefAuditSchema>;
export type StructuredTrendBrief = {
  ranking?:import('./ranking').FindingRanking;
  format?:'strategy-v1';strategyVersion?:number;sourceFingerprint?:string;
  briefId:string;campaignId:string;runId:string;contextVersion:string;version:number;qualityVersion:number;generatedAt:string;
  status:'INCOMPLETE'|'COMPLETE';validation:'passed'|'failed'|'unavailable';errors:string[];modelStatus:string;
  candidate:BriefCandidate|null;audit:BriefAudit|null;findings:FindingReview[];
  supportReviewFingerprint:string;
  sources:{evidenceId:string;name:string;ref:string;informationDate:string|null;retrievedAt:string}[];
  limitations:string[];previousAdvice:{sourceCampaignId:string;wording:string;action:'accepted'|'edited';decidedAt:string;author:string;reportId:string}|null;
};
export type BriefBudget = {runId:string;calls:number;tokens:number;costUsd:number};
export type BriefRunner = (input:ResearchInput) => Promise<StructuredTrendBrief>;
/** Engineering limits, shared by generation, audit and repair across retries of a run. */
export const BRIEF_LIMITS = {callsPerRun:6,tokensPerRun:60000,callsPerAttempt:4,inputBytes:60000,outputTokens:6500,elapsedMs:120000} as const;
