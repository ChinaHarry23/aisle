import type { Campaign } from '@/lib/types';
import { contextVersion } from './quality-contracts';
import { briefMatches } from './brief';
import { currentStrategy } from './strategy';

/** Durable outbox/inbox in the campaign aggregate. ACK means the AHR-03 job
 * has been accepted, never that its model/media calls have completed. */
export type TrendDelivery = {
  key:string; briefId:string; briefVersion:number; runId:string; contextVersion:string;
  fingerprint:string; mode:'validated_research'|'limited_product_direction';
  state:'PENDING'|'ACKNOWLEDGED'|'FAILED'; createdAt:string; acknowledgedAt:string|null;
  persistedState:'PENDING'|'ACKNOWLEDGED'|'FAILED'|null;
  attempts:number; error:string|null; jobId:string; completedAt:string|null;
};
export function deliveryFingerprint(c:Campaign):string {
  // Exact snapshot comparison, not a model score or a collision-prone short hash.
  return JSON.stringify([c.structuredTrendBrief,c.trendQuality?.assessment,c.trendRequests,
    c.internalDataAuthorised,c.retailUpload,c.dataAccessPolicy,c.strategy]);
}
export function validDeliveryInput(c:Campaign):boolean {
  const q=c.trendQuality,b=c.structuredTrendBrief;
  if(!q||!b||q.runId!==c.run?.id||b.runId!==c.run?.id||b.campaignId!==c.id||
    q.contextVersion!==contextVersion(c)||b.contextVersion!==q.contextVersion||
    b.qualityVersion!==q.version||b.validation!=='passed'||!briefMatches(c,b))return false;
  // Main's product-led continuation remains a separate, explicitly partial path.
  return q.status==='COMPLETE'&&b.status==='COMPLETE'||
    Boolean(q.continuedAt&&b.format==='strategy-v1'&&currentStrategy(c));
}
export function deliveryMatches(c:Campaign):boolean {
  const d=c.trendDelivery,b=c.structuredTrendBrief;
  return Boolean(d&&b&&d.runId===c.run?.id&&d.contextVersion===contextVersion(c)&&
    d.briefId===b.briefId&&d.briefVersion===b.version&&d.fingerprint===deliveryFingerprint(c)&&validDeliveryInput(c));
}
export function prepareDelivery(c:Campaign,at:string):TrendDelivery {
  if(!validDeliveryInput(c))throw Error('The report is not validated for the current run, context and permission.');
  if(deliveryMatches(c))return c.trendDelivery!;
  if(c.trendDelivery)(c.trendDeliveryHistory??=[]).push(structuredClone(c.trendDelivery));
  const b=c.structuredTrendBrief!, key=JSON.stringify([c.id,b.runId,b.contextVersion,b.briefId,b.version,b.supportReviewFingerprint]);
  return c.trendDelivery={key,briefId:b.briefId,briefVersion:b.version,runId:b.runId,contextVersion:b.contextVersion,
    fingerprint:deliveryFingerprint(c),mode:b.status==='COMPLETE'?'validated_research':'limited_product_direction',
    state:'PENDING',persistedState:null,createdAt:at,acknowledgedAt:null,attempts:0,error:null,
    jobId:'ahr03:'+key,completedAt:null};
}
export function acknowledgeDelivery(c:Campaign,at:string):void {
  if(!deliveryMatches(c)||!c.trendDelivery?.persistedState||c.trendQuality?.storedVersion!==c.trendQuality?.version)
    throw Error('Save the current report and handoff before AHR-03 can accept it.');
  const d=c.trendDelivery;
  if(d.state==='ACKNOWLEDGED')return;
  d.state='ACKNOWLEDGED';d.persistedState=null;d.acknowledgedAt=at;d.attempts++;d.error=null;
  c.trendQuality!.handedOffAt=at;
}
/** Called only inside a durable commit. Never mutate the caller on failed IO. */
export function markDeliveryStored(c:Campaign):void {
  if(c.trendDelivery&&deliveryMatches(c))c.trendDelivery.persistedState=c.trendDelivery.state;
}
