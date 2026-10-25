import type { Campaign } from '@/lib/types';
/** One persistent allowance across collection, quality, writing and repair.
 * Campaign credits remain the shared metering authority. These are engineering
 * ceilings, not school-prescribed thresholds. */
export const TREND_REQUEST_LIMITS={modelCalls:16,tokens:160000} as const;
export function reserveTrendRequest(c:Campaign,inputBytes:number,outputTokens:number){
 const runId=c.run?.id??'unlaunched';
 const budget=c.trendRequestBudget?.runId===runId?c.trendRequestBudget:{runId,calls:0,tokens:0,costUsd:0};
 c.trendRequestBudget=budget;
 if(budget.calls>=TREND_REQUEST_LIMITS.modelCalls||budget.tokens+inputBytes+outputTokens>TREND_REQUEST_LIMITS.tokens)throw Error('Shared Trend Analysis request/token budget exhausted.');
 budget.calls++;
 return budget;
}
