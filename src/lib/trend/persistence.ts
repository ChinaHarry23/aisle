import type { Campaign } from '@/lib/types';
import type { EngineResult } from '@/lib/runtime/types';
import type { UserRole } from '@/lib/auth/types';
import { loadWorkspace,updateWorkspace } from '@/lib/auth/workspace';
import { kvGet,kvSet,kvSetIfUnchanged } from '@/lib/db/kv';
import { recordStoredTrend } from './quality';
import { markDeliveryStored } from './delivery';

type Draft={base:string;result:EngineResult;state:'PENDING'|'SAVED'|'SUPERSEDED';error?:string};
const key=(user:string,campaign:string)=>`trend-recovery/${user}/${campaign}`;
const identity=(c:Campaign|undefined)=>JSON.stringify(c??null);
export const persistenceDeps={load:loadWorkspace,update:updateWorkspace,get:kvGet<Draft>,set:kvSet};
/** Write-ahead recovery record, then a compare-and-set of the campaign aggregate.
 * Both brief and its outbox/inbox receipt live in that one atomic document. */
export async function persistEngineResult(user:string,role:UserRole,result:EngineResult,base:Campaign|undefined,allowed?:()=>boolean|Promise<boolean>):Promise<EngineResult>{
  const journal:Draft={base:identity(base),result:structuredClone(result),state:'PENDING'};
  await persistenceDeps.set(key(user,result.campaign.id),journal);
  return commit(user,role,journal,allowed);
}
async function commit(user:string,role:UserRole,draft:Draft,allowed?:()=>boolean|Promise<boolean>):Promise<EngineResult>{
  const committed=structuredClone(draft.result);
  recordStoredTrend(committed.campaign);markDeliveryStored(committed.campaign);
  try{
    if(allowed&&!await allowed())throw Error('Execution permission changed. Draft retained; no handoff committed.');
    const saved=await persistenceDeps.update(user,role,latest=>{
      const current=latest.campaigns.find(c=>c.id===committed.campaign.id);
      if(identity(current)!==draft.base)throw Error('Campaign changed; the retained draft cannot overwrite a newer run or permission.');
      if(latest.retiredCampaignIds?.includes(committed.campaign.id)||current?.archivedAt)throw Error('Campaign is no longer active.');
      return {...latest,campaigns:[committed.campaign,...latest.campaigns.filter(c=>c.id!==committed.campaign.id)]};
    });
    if(!saved)throw Error('Workspace changed during save.');
  }catch(error){
    draft.error=error instanceof Error?error.message:'Storage unavailable.';
    // The initial PENDING record is already durable even if this update fails.
    await persistenceDeps.set(key(user,committed.campaign.id),draft).catch(()=>{});
    throw Error('Report save failed. A recovery draft was retained; retry saves it without repeating research. '+draft.error);
  }
  // A crash here is safe: recovery recognises the exact committed aggregate.
  draft.state='SAVED';await persistenceDeps.set(key(user,committed.campaign.id),draft).catch(()=>{});
  return committed;
}
export async function recoverEngineResult(user:string,role:UserRole,campaignId:string,allowed?:()=>boolean|Promise<boolean>):Promise<EngineResult|null>{
  const draft=await persistenceDeps.get(key(user,campaignId));
  if(!draft||draft.state!=='PENDING')return null;
  const current=(await persistenceDeps.load(user,role)).campaigns.find(c=>c.id===campaignId);
  const committed=structuredClone(draft.result);recordStoredTrend(committed.campaign);markDeliveryStored(committed.campaign);
  if(identity(current)===identity(committed.campaign)){
    draft.state='SAVED';await persistenceDeps.set(key(user,campaignId),draft);return committed;
  }
  if(identity(current)!==draft.base){draft.state='SUPERSEDED';await persistenceDeps.set(key(user,campaignId),draft);return null;}
  return commit(user,role,draft,allowed);
}
export async function recoveryStatus(user:string,campaignId:string){
 const draft=await persistenceDeps.get(key(user,campaignId));
 return draft?.state==='PENDING'?{pending:true,briefVersion:draft.result.campaign.structuredTrendBrief?.version??null,message:draft.error??'A recoverable draft awaits its workspace save.'}:{pending:false};
}
/** An atomic inbox claim shared by hosts. Never automatically reclaim an
 * uncertain external call: doing so could charge twice after a process crash. */
export async function claimCreativeJob(user:string,jobId:string):Promise<boolean>{
 return kvSetIfUnchanged(`trend-creative/${user}/${jobId}`,{startedAt:new Date().toISOString(),jobId},null);
}
