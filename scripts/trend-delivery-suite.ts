/** TA-07 fault injection, real SQLite recovery, actual AHR-03 request contract.
 * All evidence/model/media fixtures are SYNTHETIC; no external calls. */
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {briefFixture,fixtureAt} from './trend-brief-fixtures';
import {fallbackStrategy} from '../src/lib/trend/strategy';
import {assembleStrategyReport} from '../src/lib/trend/strategy-report';
import {prepareDelivery,markDeliveryStored,deliveryMatches} from '../src/lib/trend/delivery';
import {recordStoredTrend,releaseResearchWait} from '../src/lib/trend/quality';
import {persistEngineResult,recoverEngineResult,persistenceDeps,claimCreativeJob} from '../src/lib/trend/persistence';
import {runEngine,type EngineOptions} from '../src/lib/runtime/engine';
import {WorkflowRepository} from '../services/workflow/repository';
import {defaultBrand} from '../src/lib/seed';
import {defaultSettings} from '../src/lib/settings';
import {stubComplete} from '../src/lib/llm/stub';
import type {Campaign} from '../src/lib/types';
import type {EngineResult} from '../src/lib/runtime/types';
import type {WorkspaceSnapshot} from '../src/lib/auth/workspace';
let count=0,calls=0,renders=0;
const prompts:string[]=[];
const pass=(s:string)=>{count++;console.log('PASS '+s);};
const fixture=()=>{const {c}=briefFixture();c.name='SYNTHETIC TA07 handoff';c.spend.capUsd=100;c.trendBriefRequired=true;c.strategy=fallbackStrategy(c,fixtureAt,'SYNTHETIC strategy');c.structuredTrendBrief=assembleStrategyReport(c,fixtureAt);c.run!.step='trend.handoff';recordStoredTrend(c);return c;};
const options:EngineOptions={maxSteps:12,llm:{request:async req=>{calls++;prompts.push(req.prompt);return stubComplete(req,'SYNTHETIC offline');}},renderPoster:async({modelId})=>{renders++;return {kind:'image',modelId,provider:'Fixture',modelName:'Fixture',status:'stubbed',url:null,note:'SYNTHETIC',at:fixtureAt,usage:{inputTokens:0,outputTokens:0,totalTokens:0,units:1,unitLabel:'image',costUsd:0,billedAs:'fixture',estimate:false,latencyMs:0}};}};
const advance=(c:Campaign,opts:EngineOptions={})=>runEngine({campaigns:[c],now:fixtureAt},structuredClone(c),{type:'ADVANCE',actor:'system'},defaultSettings(),defaultBrand,{...options,...opts});
const saved=(r:EngineResult)=>{recordStoredTrend(r.campaign);markDeliveryStored(r.campaign);return r.campaign;};
const output=(c:Campaign):EngineResult=>({campaign:c,run:c.run!,events:[],runSteps:[],policyDecisions:[],canAdvance:true,message:'SYNTHETIC checkpoint'});
{
 const c=fixture(),before=calls;let r=await advance(c);assert.equal(r.run.step,'creative.receive');assert.equal(r.campaign.trendDelivery!.state,'PENDING');assert.equal(calls,before);
 // Unsaved outbox cannot be accepted, even though the report itself was saved.
 const blocked=await advance(r.campaign);assert.equal(blocked.campaign.status,'paused');assert.equal(calls,before);
 const pending=saved(r);r=await advance(pending);assert.equal(r.run.step,'creative.generate');assert.equal(r.campaign.trendDelivery!.state,'ACKNOWLEDGED');assert.equal(r.campaign.trendDelivery!.persistedState,null);assert.equal(calls,before);
 const accepted=saved(r);r=await advance(accepted,{maxSteps:1});assert.equal(r.run.step,'compliance.receive');assert.ok(calls>before);assert.equal(r.campaign.creatives.length,2);assert.ok(r.campaign.creatives.every(v=>v.trendBriefRef?.briefId===c.structuredTrendBrief!.briefId));assert.ok(prompts.some(p=>p.includes('Stored AHR-02 handoff:')&&p.includes('validated_research')));assert.ok(r.campaign.trendDelivery!.completedAt);assert.equal(r.campaign.trendDelivery!.jobId,pending.trendDelivery!.jobId);
 const replay=saved(r),callsAfter=calls,imagesAfter=renders;replay.run!.step='creative.receive';r=await advance(replay,{maxSteps:1});assert.equal(calls,callsAfter);assert.equal(renders,imagesAfter);assert.equal(r.campaign.creatives.length,2);
 pass('save-before-send, durable ACK-before-model, actual AHR-03 output and duplicate completed delivery reuse');
}
{
 const c=fixture();prepareDelivery(c,fixtureAt);markDeliveryStored(c);c.run!.step='creative.receive';const before=calls;
 let r=await advance(c,{acceptTrend:async()=>{throw Error('Injected downstream outage');}});assert.equal(r.campaign.trendDelivery!.state,'FAILED');assert.equal(r.campaign.trendQuality!.status,'COMPLETE');assert.equal(r.campaign.structuredTrendBrief!.status,'COMPLETE');assert.equal(r.campaign.trendQuality!.handedOffAt,null);assert.equal(calls,before);
 const failed=saved(r);failed.status='analysing';failed.run!.status='running';r=await advance(failed,{acceptTrend:async()=>true});assert.equal(r.campaign.trendDelivery!.state,'ACKNOWLEDGED');assert.equal(r.campaign.trendDelivery!.attempts,2);assert.equal(r.campaign.trendDelivery!.key,c.trendDelivery!.key);assert.equal(calls,before);
 const again=saved(r);again.run!.step='creative.receive';r=await advance(again);assert.equal(r.campaign.trendDelivery!.attempts,2);assert.equal(calls,before);
 pass('downstream outage keeps COMPLETE report; retry step15 and duplicate ACK have no research/model calls');
}
{
 for(const mutate of [(c:Campaign)=>{c.product='Changed';},(c:Campaign)=>{c.run!.id='new-run';},(c:Campaign)=>{c.structuredTrendBrief!.version++;},(c:Campaign)=>{c.internalDataAuthorised=!c.internalDataAuthorised;},(c:Campaign)=>{c.structuredTrendBrief!.findings[0].claim='Forged';}]){
  const c=fixture();prepareDelivery(c,fixtureAt);markDeliveryStored(c);c.run!.step='creative.receive';mutate(c);assert.equal(deliveryMatches(c),false);const before=calls;const r=await advance(c);assert.equal(r.campaign.status,'paused');assert.equal(calls,before);
 }
 const c=fixture();prepareDelivery(c,fixtureAt);markDeliveryStored(c);c.run!.step='creative.receive';const before=calls;const r=await advance(c,{researchAllowed:()=>false});assert.notEqual(r.campaign.trendDelivery?.state,'ACKNOWLEDGED');assert.equal(calls,before);
 pass('stale run/context/report, revoked permission, tampering and cancelled permission prevent dispatch');
}
{
 const c=fixture();c.trendQuality!.status='INCOMPLETE';releaseResearchWait(c,fixtureAt);c.strategy=fallbackStrategy(c,fixtureAt,'SYNTHETIC partial');c.structuredTrendBrief=assembleStrategyReport(c,fixtureAt);recordStoredTrend(c);prepareDelivery(c,fixtureAt);assert.equal(c.trendDelivery!.mode,'limited_product_direction');assert.equal(c.structuredTrendBrief!.status,'INCOMPLETE');assert.equal(c.trendQuality!.status,'INCOMPLETE');
 c.structuredTrendBrief!.validation='failed';assert.throws(()=>prepareDelivery(c,fixtureAt));
 pass('partial product direction is a separately labelled validated contract, never research COMPLETE; invalid drafts cannot dispatch');
}
{
 const original={...persistenceDeps},data=new Map<string,unknown>();let workspace:WorkspaceSnapshot={campaigns:[],brand:defaultBrand,settings:defaultSettings()},failWrite=true;
 persistenceDeps.get=async key=>structuredClone(data.get(key)??null) as Awaited<ReturnType<typeof persistenceDeps.get>>;
 persistenceDeps.set=async(key,value)=>{data.set(key,structuredClone(value));};
 persistenceDeps.load=async()=>structuredClone(workspace);
 persistenceDeps.update=async(_user,_role,change)=>{if(failWrite)throw Error('Injected write outage');workspace=await change(structuredClone(workspace));return true;};
 try{
  const c=fixture();workspace.campaigns=[structuredClone(c)];const next=await advance(c),before=calls;
  await assert.rejects(persistEngineResult('fixture','dev',next,c),/recovery draft/);assert.equal(workspace.campaigns[0].trendDelivery,undefined);assert.equal(next.campaign.trendDelivery!.persistedState,null);
  failWrite=false;await assert.rejects(recoverEngineResult('fixture','dev',c.id,()=>false),/permission changed/);assert.equal(workspace.campaigns[0].trendDelivery,undefined);const recovered=await recoverEngineResult('fixture','dev',c.id);assert.ok(recovered);assert.equal(recovered.campaign.trendDelivery!.persistedState,'PENDING');assert.equal(calls,before);assert.equal(await recoverEngineResult('fixture','dev',c.id),null);
  pass('inline write failure retains recoverable draft; retry step13 saves exact report/outbox without regeneration');
  const base=structuredClone(workspace.campaigns[0]);const ack=await advance(base);failWrite=true;await assert.rejects(persistEngineResult('fixture','dev',ack,base));failWrite=false;
  workspace.campaigns[0].status='rejected';workspace.campaigns[0].run!.status='halted';assert.equal(await recoverEngineResult('fixture','dev',c.id),null);assert.equal(workspace.campaigns[0].status,'rejected');
  pass('late recovery cannot overwrite a cancelled/newer canonical campaign');
  const current=fixture();workspace.campaigns=[structuredClone(current)];const pending=await advance(current);let writes=0;
  persistenceDeps.set=async(key,value)=>{writes++;if(writes===2)throw Error('Crash after canonical save');data.set(key,structuredClone(value));};
  await persistEngineResult('fixture','dev',pending,current);persistenceDeps.set=async(key,value)=>{data.set(key,structuredClone(value));};
  assert.ok(await recoverEngineResult('fixture','dev',current.id));assert.equal(calls,before);
  pass('crash after canonical save/before journal confirmation recognises committed snapshot safely');
 }finally{Object.assign(persistenceDeps,original);}
}
{
 const file=path.join(mkdtempSync(path.join(tmpdir(),'ta07-')),'workflow.db');let repo=new WorkflowRepository(file);
 const c=fixture(),draft=structuredClone(c);draft.status='draft';draft.run=null;
 const job=repo.enqueue('fixture','start',{campaign:draft,campaigns:[draft],brand:defaultBrand,settings:defaultSettings(),command:{type:'START',actor:'founder'}}),claimed=repo.claim('first')!;
 repo.checkpoint(claimed,output(c),false);
 const pending=await advance(repo.campaign('fixture',c.id)!);
 // An actual SQL trigger aborts the canonical transaction, not the journal write.
 repo.db.exec("create trigger fail_commit before update on workflow_campaigns begin select raise(abort,'Injected canonical outage'); end;");
 assert.throws(()=>repo.checkpoint(claimed,pending,false),/Injected/);assert.equal(repo.campaign('fixture',c.id)!.trendDelivery,undefined);assert.equal(pending.campaign.trendDelivery!.persistedState,null);repo.fail(claimed,'Injected outage');repo.close();
 repo=new WorkflowRepository(file);repo.db.exec('drop trigger fail_commit');repo.retry('fixture',job.id);const retry=repo.claim('second')!;const before=calls;assert.equal(repo.recoverCheckpoint(retry),true);assert.equal(calls,before);let restored=repo.campaign('fixture',c.id)!;assert.equal(restored.trendDelivery!.persistedState,'PENDING');
 repo.close();repo=new WorkflowRepository(file);restored=repo.campaign('fixture',c.id)!;const ack=await advance(restored);repo.checkpoint(retry,ack,false);assert.equal(repo.campaign('fixture',c.id)!.trendDelivery!.persistedState,'ACKNOWLEDGED');repo.close();
 pass('real SQLite failed write and process reopen retain draft, replay checkpoint and durable outbox/inbox ACK');
}
{
 const file=path.join(mkdtempSync(path.join(tmpdir(),'ta07-inbox-')),'inbox.db');
 const one=new WorkflowRepository(file),two=new WorkflowRepository(file);
 const c=fixture();prepareDelivery(c,fixtureAt);markDeliveryStored(c);c.run!.step='creative.receive';
 const ack=await advance(c);const accepted=saved(ack),before=calls;
 const first=await advance(accepted,{maxSteps:1,claimCreativeJob:key=>one.claimCreativeJob('fixture',key)});assert.ok(first.campaign.trendDelivery!.completedAt);
 const paid=calls;const duplicate=await advance(accepted,{claimCreativeJob:key=>two.claimCreativeJob('fixture',key)});assert.equal(duplicate.campaign.status,'paused');assert.match(duplicate.message,/already started/);assert.equal(calls,paid);assert.ok(paid>before);
 one.close();two.close();const reopened=new WorkflowRepository(file);assert.equal(reopened.claimCreativeJob('fixture',accepted.trendDelivery!.jobId),false);assert.equal(reopened.claimCreativeJob('other-tenant',accepted.trendDelivery!.jobId),true);reopened.close();
 pass('two independent SQLite connections and process reopen cannot start duplicate creative work; tenants remain isolated');
}
{
 process.env.AISLE_DB='sqlite';process.env.AISLE_DB_FILE=path.join(mkdtempSync(path.join(tmpdir(),'ta07-kv-')),'app.db');
 const claims=await Promise.all([claimCreativeJob('fixture','same-report'),claimCreativeJob('fixture','same-report')]);assert.equal(claims.filter(Boolean).length,1);assert.equal(await claimCreativeJob('other-tenant','same-report'),true);
 pass('inline/Studio atomic SQL inbox claim permits exactly one concurrent start per owner and report');
}

console.log(`\n${count} TA-07 acceptance groups passed. SYNTHETIC fixtures only; no provider calls.`);
