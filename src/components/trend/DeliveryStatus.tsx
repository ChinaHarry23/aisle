'use client';
import type {Campaign} from '@/lib/types';
import {useAisle} from '@/lib/store';
import {useEffect,useState} from 'react';

export function DeliveryStatus({campaign}:{campaign:Campaign}){
 const busy=useAisle(s=>s.busy[campaign.id]);
 const error=useAisle(s=>s.engineError);
 const resume=useAisle(s=>s.continueAgents),launch=useAisle(s=>s.launch);
 const [recovery,setRecovery]=useState<{pending:boolean;message?:string}>({pending:false});
 useEffect(()=>{let active=true;fetch('/api/engine/recovery?campaignId='+encodeURIComponent(campaign.id)).then(r=>r.ok?r.json():null).then(value=>{if(active&&value)setRecovery(value);}).catch(()=>{});return ()=>{active=false;};},[campaign.id,campaign.updatedAt,error]);
 const q=campaign.trendQuality,d=campaign.trendDelivery;
 if(!q)return recovery.pending?<section className="hairline p-4" aria-label="Recoverable report draft"><h3 className="font-medium">Report save needs recovery</h3><p role="alert" className="mt-2 text-sm">{recovery.message} The retained result will be saved before any further agent work.</p><button disabled={busy} className="mt-3 text-sm text-signal underline" onClick={()=>void resume(campaign.id)}>Retry saved draft</button></section>:null;
 const saved=q.storedVersion===q.version;
 const receipt=d?.state==='ACKNOWLEDGED'&&d.persistedState==='ACKNOWLEDGED';
 const handoff=d?.state==='FAILED'?'Not delivered · retry needed':receipt?'Accepted by content generation':d?'Waiting for content generation':'Not dispatched';
 return <section className="hairline p-4 md:p-5" aria-label="Report storage and content generation handoff">
  <h3 className="font-medium">Report &amp; delivery status</h3>
  {recovery.pending&&<p role="alert" className="mt-3 text-sm text-signal">Recoverable report draft · {recovery.message} Retry the save; research will not run again.</p>}
  <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-3">
   <div><dt className="text-mute">Research</dt><dd>{q.status==='COMPLETE'?'Complete · evidence validated':'Partial · evidence gaps remain'}</dd></div>
   <div><dt className="text-mute">Storage</dt><dd>{saved?`Saved · version ${q.version}`:'Awaiting durable save'}</dd></div>
   <div><dt className="text-mute">Handoff</dt><dd>{handoff}</dd></div>
  </dl>
  {d?.mode==='limited_product_direction'&&<p className="mt-3 text-sm text-ink-soft">Only a limited product-led direction is continuing. This does not complete the research or turn assumptions into approved claims.</p>}
  {receipt&&<p className="mt-3 text-xs text-mute">Accepted {d.acknowledgedAt}. {d.completedAt?'Creative result saved.':'Acceptance is recorded; creative generation may still be pending.'}</p>}
  {campaign.run?.status==='paused'&&<p className="mt-3 text-sm text-ink-soft">Paused · {campaign.run.haltedReason}</p>}
  {(d?.error||error)&&<p role="alert" className="mt-3 text-sm text-signal">{d?.error||error}</p>}
  {(!receipt||!d?.completedAt)&&['analysing','paused','generating'].includes(campaign.status)&&<button className="mt-3 rounded-full border border-signal px-4 py-2 text-sm text-signal disabled:opacity-50" disabled={busy} onClick={()=>void(campaign.status==='paused'?launch(campaign.id):resume(campaign.id))}>{busy?'Saving / continuing…':!saved?'Retry report save':d?.state==='FAILED'?'Retry content handoff':'Continue saved campaign'}</button>}
  <details className="mt-3 text-xs text-mute"><summary className="cursor-pointer">Report tracking &amp; delivery history</summary><p className="mt-2 break-all">Campaign {campaign.id} · Run {q.runId} · Context {q.contextVersion} · Report {campaign.structuredTrendBrief?.briefId??'not prepared'} · Review {q.version}</p>{d&&<p className="mt-2 break-all">Job {d.jobId} · Attempts {d.attempts}</p>}{campaign.trendDeliveryHistory?.map((h,i)=><p className="mt-2" key={i}>Version {h.briefVersion} · {h.state} · {h.createdAt}</p>)}</details>
 </section>;
}
