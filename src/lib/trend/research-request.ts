import type { CompleteRequest } from '@/lib/llm/types';
import { trendRequestSize } from './request-budget';

export const RESEARCH_MODEL_LIMITS = { tokens:48000, outputTokens:4000, inputBytes:60000, calls:6 } as const;

/** Leave room to turn retrieval into an answer. Removing retrieval tools stops
 * another round of collection; the response schema remains available. */
export function planResearchRequest(req:CompleteRequest, state:{
  names:readonly string[]; calls:number; tokens:number; enrichmentCalls:number;
  finishSoon:boolean; finalContext:()=>string;
}) {
  const choices=req.tools?.filter(t=>state.names.includes(t.name)&&t.name!=='retail.internal_signals')??[];
  const finalTools=req.tools?.filter(t=>!state.names.includes(t.name))??[];
  let request:CompleteRequest={...req,tools:state.calls===1?choices:[...choices,...finalTools],toolChoice:state.calls===1&&choices.length?'required':'auto'};
  let size=trendRequestSize(request);
  // 2,500 tokens covers new tool excerpts before the final response. Usage
  // already spent comes from the provider, not this planning estimate.
  const final=state.finishSoon||state.enrichmentCalls>=6||state.calls>=RESEARCH_MODEL_LIMITS.calls
    ||state.tokens+2*(size.inputTokens+RESEARCH_MODEL_LIMITS.outputTokens)+2500>RESEARCH_MODEL_LIMITS.tokens
    ||size.bytes>RESEARCH_MODEL_LIMITS.inputBytes;
  if(final){
    request={...req,tools:finalTools,toolChoice:'auto',system:`${req.system??''}\nCollection is complete. Synthesize the retained observations into the structured campaign analysis now. Explain useful decisions and remaining gaps; do not request more research.`};
    size=trendRequestSize(request);
    if(size.bytes>RESEARCH_MODEL_LIMITS.inputBytes||state.tokens+size.inputTokens+RESEARCH_MODEL_LIMITS.outputTokens>RESEARCH_MODEL_LIMITS.tokens){
      // Rebuild from the retained source ledger, keeping IDs and originals,
      // instead of truncating a tool result or breaking call/result pairs.
      request={...request,prompt:state.finalContext(),history:undefined,lastTurnIsToolResult:undefined,toolCallId:undefined};
      size=trendRequestSize(request);
    }
  }
  return {request,...size,final};
}
