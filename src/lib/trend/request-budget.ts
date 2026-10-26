import type { Campaign } from '@/lib/types';
import type { CompleteRequest } from '@/lib/llm/types';

/** Scheduling estimate, not billing usage. Keep bytes (payload size) separate
 * from tokens. English/JSON averages several bytes per token; non-ASCII text
 * gets a larger allowance. The shared meter still settles provider usage. */
export function trendRequestSize(request: CompleteRequest) {
 const serialized=JSON.stringify(request), bytes=Buffer.byteLength(serialized);
 const nonAscii=serialized.replace(/[\x00-\x7F]/g,'');
 const nonAsciiBytes=Buffer.byteLength(nonAscii);
 return {bytes,inputTokens:128+Math.ceil((bytes-nonAsciiBytes)/3)+Math.ceil(nonAsciiBytes/2)};
}
/** One persistent allowance across collection, quality, writing and repair.
 * Campaign credits remain the shared metering authority. These are engineering
 * ceilings, not school-prescribed thresholds. */
export const TREND_REQUEST_LIMITS={modelCalls:16,tokens:160000} as const;
export function reserveTrendRequest(c:Campaign,inputTokens:number,outputTokens:number){
 const runId=c.run?.id??'unlaunched';
 const budget=c.trendRequestBudget?.runId===runId?c.trendRequestBudget:{runId,calls:0,tokens:0,costUsd:0};
 c.trendRequestBudget=budget;
 if(budget.calls>=TREND_REQUEST_LIMITS.modelCalls||budget.tokens+inputTokens+outputTokens>TREND_REQUEST_LIMITS.tokens)throw Error('Shared Trend Analysis request/token budget exhausted.');
 budget.calls++;
 return budget;
}
