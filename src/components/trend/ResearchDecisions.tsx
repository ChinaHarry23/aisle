'use client';
import {useState} from 'react';
import type {Campaign} from '@/lib/types';
import {useAisle} from '@/lib/store';
import {RESEARCH_CATEGORIES,type ResearchCategory} from '@/lib/trend/contracts';
import type {ReviewRequest,TrendResolution} from '@/lib/trend/quality-contracts';

function DecisionCard({campaign,request}:{campaign:Campaign;request:ReviewRequest}){
 const resolve=useAisle(s=>s.resolveTrend),busy=useAisle(s=>s.busy[campaign.id]),error=useAisle(s=>s.engineError);
 const [action,setAction]=useState<TrendResolution['action']>('provide_data');
 const [note,setNote]=useState(''),[urls,setUrls]=useState(''),[category,setCategory]=useState<ResearchCategory>(RESEARCH_CATEGORIES.includes(request.category as ResearchCategory)?request.category as ResearchCategory:'current_market');
 const [channel,setChannel]=useState(campaign.channels[0]);
 const [context,setContext]=useState({product:campaign.product,category:campaign.category,targetAudience:campaign.targetAudience,objective:campaign.objective,budget:campaign.budget,channels:campaign.channels,startDate:campaign.startDate,endDate:campaign.endDate,country:campaign.country});
 const choices:Record<TrendResolution['action'],string>={correct_context:'Correct campaign details',provide_data:'Provide authorised evidence',continue_limited:'Accept qualified continuation',decline:'End this analysis'};
 const selected=request.options.includes(action)?action:request.options[0];
 return <article className="rounded-xl border border-line p-4">
   <p className="text-xs uppercase tracking-wide text-signal">{request.category.replaceAll('_',' ')} · Review {request.reviewVersion}</p>
   <h4 className="mt-2 font-medium">{request.reason}</h4>
   <dl className="mt-3 space-y-2 text-sm"><div><dt className="font-medium">What we need from you</dt><dd className="text-ink-soft">{request.question}</dd></div><div><dt className="font-medium">Evidence needed</dt><dd className="text-ink-soft">{request.neededData}</dd></div></dl>
   <form className="mt-4 space-y-4" onSubmit={event=>{event.preventDefault();void resolve(campaign.id,{type:'RESOLVE_TREND',actor:'founder',requestId:request.id,reviewVersion:request.reviewVersion,contextVersion:request.contextVersion,action:selected,note,
     ...(selected==='correct_context'?{context}:{}),...(selected==='provide_data'?{sources:urls.split('\n').map(url=>url.trim()).filter(Boolean).map(url=>({url,category,...(category==='channel'?{channel}:{})}))}:{})});}}>
     <label className="block text-sm">Choose how to proceed<select className="mt-1 w-full rounded-lg border border-line bg-surface p-2" value={selected} onChange={e=>setAction(e.target.value as TrendResolution['action'])}>{request.options.map(a=><option value={a} key={a}>{choices[a]}</option>)}</select></label>
     {selected==='provide_data'&&<div className="space-y-3"><p className="text-xs text-mute">Add public original sources below, or attach an authorised aggregate export in the retail-data section. Sources are retrieved and checked before use.</p>
       <label className="block text-sm">Research category<select className="mt-1 w-full rounded-lg border border-line bg-surface p-2" value={category} onChange={e=>setCategory(e.target.value as ResearchCategory)}>{RESEARCH_CATEGORIES.map(c=><option key={c} value={c}>{c.replaceAll('_',' ')}</option>)}</select></label>
       {category==='channel'&&<label className="block text-sm">Selected channel<select className="mt-1 w-full border border-line p-2" value={channel} onChange={e=>setChannel(e.target.value as typeof channel)}>{campaign.channels.map(c=><option key={c}>{c}</option>)}</select></label>}
       <label className="block text-sm">Source URLs · one per line, up to four<textarea className="mt-1 min-h-20 w-full rounded-lg border border-line bg-surface p-2" value={urls} onChange={e=>setUrls(e.target.value)} placeholder="https://www.abs.gov.au/…" /></label>
     </div>}
     {selected==='correct_context'&&<div className="grid gap-3 sm:grid-cols-2">
       {(['product','category','targetAudience','objective','budget','startDate','endDate','country'] as const).map(key=><label className="block text-sm" key={key}>{({targetAudience:'Target audience',startDate:'Start date',endDate:'End date'} as Record<string,string>)[key]??key}<input required className="mt-1 w-full rounded-lg border border-line bg-surface p-2" type={key==='budget'?'number':key.endsWith('Date')?'date':'text'} value={context[key]} onChange={e=>setContext({...context,[key]:key==='budget'?Number(e.target.value):e.target.value})}/></label>)}
       <fieldset className="sm:col-span-2"><legend className="text-sm">Channels</legend><div className="mt-2 flex flex-wrap gap-3">{(['instagram','web','email','print','digital_signage'] as const).map(c=><label className="text-xs" key={c}><input type="checkbox" checked={context.channels.includes(c)} onChange={e=>setContext({...context,channels:e.target.checked?[...context.channels,c]:context.channels.filter(v=>v!==c)})}/>{' '}{c}</label>)}</div></fieldset>
       <p className="text-xs text-mute sm:col-span-2">The corrected brief is validated again. Research relevance is reconsidered under the new scope; previous approvals do not transfer.</p>
     </div>}
     <label className="block text-sm">Your explanation<textarea required minLength={1} maxLength={4000} className="mt-1 min-h-20 w-full rounded-lg border border-line bg-surface p-2" value={note} onChange={e=>setNote(e.target.value)} /></label>
     <p className="text-xs text-mute">{selected==='decline'?'This ends the run and retains valid partial work.':selected==='continue_limited'?'Your decision and the limitation remain in the report. The evidence gate still applies.':'This resumes validation and may use research/model credits. Providing a source does not approve its claims.'}</p>
     <button disabled={busy||!note.trim()||(selected==='provide_data'&&!urls.trim()&&!campaign.retailUpload)} className="rounded-full bg-signal px-4 py-2 text-sm text-white disabled:opacity-40" type="submit">{busy?'Saving…':selected==='decline'?'End analysis':'Save decision and continue'}</button>
     {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
   </form>
 </article>;
}
export function ResearchDecisions({campaign}:{campaign:Campaign}){
 const pending=campaign.trendRequests?.filter(r=>r.status==='pending')??[];
 const history=campaign.trendRequests?.filter(r=>r.status!=='pending')??[];
 const busy=useAisle(s=>s.busy[campaign.id]),launch=useAisle(s=>s.launch),cancel=useAisle(s=>s.cancelTrend);
 return <div className="mt-5 space-y-4">
   {pending.map(r=><DecisionCard key={`${r.id}:${r.reviewVersion}`} campaign={campaign} request={r}/>)}
   {!pending.length&&<p className="text-sm text-mute">{campaign.trendQuality?.status==='COMPLETE'?'Evidence review passed. No research decision is required.':'No open research decisions. Further validation may still be required.'}</p>}
   {!pending.length&&campaign.status==='paused'&&campaign.trendQuality&&<button disabled={busy} className="rounded-full border border-signal px-4 py-2 text-sm text-signal" onClick={()=>void launch(campaign.id)}>Resume saved analysis</button>}
   {['paused','analysing'].includes(campaign.status)&&campaign.run?.step.startsWith('trend.')&&<button disabled={busy} className="ml-3 text-sm text-mute underline" onClick={()=>void cancel(campaign.id,'Founder ended the analysis from the research report.')}>End analysis and keep partial report</button>}
   {history.length>0&&<details className="border-t border-line pt-4"><summary className="cursor-pointer text-sm">Decision history · {history.length}</summary><ol className="mt-3 space-y-3 text-xs text-mute">{history.map(r=><li key={`${r.id}:${r.reviewVersion}`}>{r.category} · {r.status} · {r.decision??'Superseded by new evidence or context'}<p>{r.note}</p><p>{r.actorId} · {r.resolvedAt??r.requestedAt} · Context {r.contextVersion}</p></li>)}</ol></details>}
 </div>;
}
