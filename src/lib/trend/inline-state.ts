import type { Campaign } from '@/lib/types';
/** Inline prototype: serialize this host's workspace writes so stale browser
 * snapshots cannot overwrite a completed review or replay a founder decision.
 * Multi-host production execution uses the durable workflow repository. */
const pauseRequests=new Set<string>();
export function requestInlinePause(owner:string,campaign:string){pauseRequests.add(owner+':'+campaign);}
export function resumeInlineResearch(owner:string,campaign:string){pauseRequests.delete(owner+':'+campaign);}
export function inlineResearchAllowed(owner:string,campaign:string){return !pauseRequests.has(owner+':'+campaign);}
const queues=new Map<string,Promise<unknown>>();
export async function withWorkspaceLock<T>(owner:string,operation:()=>Promise<T>):Promise<T>{
 const previous=queues.get(owner)??Promise.resolve();
 const next=previous.catch(()=>undefined).then(operation);queues.set(owner,next);
 try{return await next;}finally{if(queues.get(owner)===next)queues.delete(owner);}
}
export function protectResearchSnapshots(incoming:Campaign[],stored:Campaign[]):Campaign[]{
 const canonical=new Map(stored.filter(c=>c.trendQuality||c.researchMode==='agent'||c.performanceReport||c.recommendationDecision).map(c=>[c.id,c]));
 return [...incoming.map(c=>canonical.get(c.id)??{...c,performanceReport:null,recommendationDecision:null,structuredTrendBrief:undefined,trendBriefHistory:undefined,trendBriefBudget:undefined,trendRequestBudget:undefined,trendBriefRequired:undefined,sharedContext:{...c.sharedContext,structuredTrendBrief:undefined,previousAdvice:undefined},trendQualityHistory:undefined,trendQuality:undefined,trendRequests:undefined,trendSupplementarySources:undefined}),...stored.filter(c=>canonical.has(c.id)&&!incoming.some(i=>i.id===c.id))];
}
