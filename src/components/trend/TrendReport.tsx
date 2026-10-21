"use client";

import Link from 'next/link';
import type { Campaign } from '@/lib/types';
import { coverageFor, type ResearchCategory } from '@/lib/trend/contracts';

const labels: Record<ResearchCategory,string> = {
  current_market:'Current market', historical_market:'Historical trends', customer_interest:'Customer interests',
  purchase_preference:'Purchasing preferences', seasonal:'Seasonal influences', cultural:'Cultural influences',
  channel:'Channel behaviour', competitor:'Competitor activity',
};

export function TrendReport({campaign}: {campaign:Campaign}) {
  const areas=campaign.researchCoverage ?? coverageFor(campaign,[]);
  const analysed=areas.filter(a=>a.analysis).length;
  const retrieved=areas.filter(a=>a.evidenceIds.length).length;
  const attention=campaign.trendGaps.filter(g=>g.needsFounder);
  const recorded=Boolean(campaign.researchAttempts?.length);
  const draft=recorded ? 'Draft · evidence review pending' : 'No verified research run';
  return <div className="space-y-8">
    <section className="hairline overflow-hidden" aria-label="Trend report overview">
      <div className="border-b border-line bg-paper-2 p-5 md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs uppercase tracking-wider text-signal">Campaign research</p><span className="status-chip status-wait">{draft}</span></div>
        <h2 className="mt-3 font-serif text-2xl md:text-3xl">Trend analysis report</h2>
        <p className="mt-2 text-sm text-ink-soft">{campaign.product} · {campaign.country} · {campaign.startDate} – {campaign.endDate}</p>
        <p className="mt-3 text-sm text-mute">{recorded ? 'The report below retains results and gaps for every required research area. Retrieval is not evidence approval.' : 'This campaign has no recorded run of the current research workflow. Any existing findings below are legacy or sample material, not a completed research report.'}</p>
        <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4">
          <div><dt className="text-xs text-mute">Areas with sources</dt><dd className="mt-1 text-xl">{retrieved} / {areas.length}</dd></div>
          <div><dt className="text-xs text-mute">Draft assessments</dt><dd className="mt-1 text-xl">{analysed} / {areas.length}</dd></div>
          <div><dt className="text-xs text-mute">Needs your input</dt><dd className="mt-1 text-xl">{attention.length}</dd></div>
        </dl>
        <nav className="mt-5 flex flex-wrap gap-4 text-sm text-signal" aria-label="Report sections"><a href="#research-areas">Research areas</a><a href="#research-conclusions">Conclusions & recommendations</a><a href="#research-decisions">Your decisions</a></nav>
      </div>
      <div className="p-5 md:p-7" id="research-areas">
        <h3 className="font-serif text-xl">Every research area, in one place</h3>
        <p className="mt-1 text-sm text-mute">Seasonal and cultural influences are checked separately. Each selected channel has its own assessment.</p>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {areas.map((area,i)=><article className="rounded-xl border border-line p-4" key={`${area.category}:${area.channel ?? ''}`}>
            <div className="flex items-start justify-between gap-3"><h4 className="font-medium"><span className="mr-2 text-mute">{String(i+1).padStart(2,'0')}</span>{' '}{labels[area.category]}{area.channel ? ` · ${area.channel}` : ''}</h4><span className="shrink-0 text-xs text-signal">{area.analysis ? 'Draft assessment' : area.evidenceIds.length ? 'Sources retrieved' : area.attempts?.length ? 'Blocked / no evidence' : 'Not run'}</span></div>
            <p className="mt-3 text-sm leading-relaxed">{area.analysis?.summary ?? 'No source-supported assessment is available yet.'}</p>
            <p className="mt-2 text-xs leading-relaxed text-mute">{area.analysis?.limitation || area.limitation}</p>
            <details className="mt-4 border-t border-line pt-3"><summary className="cursor-pointer text-sm text-signal">Evidence & execution · {area.evidenceIds.length} sources</summary>
              <ul className="mt-3 space-y-2 text-xs text-mute">{(area.attempts ?? []).map((a,index)=><li key={index}>{a.tool} · {a.status}<p>{a.summary}</p></li>)}{!area.attempts?.length && <li>No execution recorded.</li>}</ul>
              {area.evidenceIds.map(id=>{const e=campaign.evidence.find(source=>source.id===id);return e ? <div className="mt-3 border-t border-line pt-3 text-xs" key={id}>
                <p className="font-medium">{e.sourceName}</p>{e.sourceName === "WhichGrocer" && <a className="text-signal underline" href="https://www.whichgrocer.com" target="_blank" rel="noreferrer">Product data by WhichGrocer</a>}<p className="mt-1 text-mute">Information date: {e.observedAt ?? 'Unknown'} · Retrieved: {e.fetchedAt}</p>
                <p className="mt-2 break-words leading-relaxed">{e.detail}</p>{/^https?:\/\//.test(e.sourceRef) ? <a className="mt-2 inline-block text-signal underline" href={e.sourceRef} target="_blank" rel="noreferrer">Read source ↗</a>:<p className="mt-2 break-all text-mute">{e.sourceRef}</p>}
              </div>:null;})}
            </details>
          </article>)}
        </div>
      </div>
    </section>

    <section id="research-conclusions" className="hairline p-5 md:p-7" aria-label="Research conclusions">
      <h3 className="font-serif text-xl">Conclusions & recommendations</h3>
      <p className="mt-2 text-sm text-mute">{recorded ? 'Draft recommendations require supporting evidence and sufficiency checks before handoff.' : 'Existing sample or legacy recommendations are shown for reference only.'}</p>
      <div className="mt-5 grid gap-6 md:grid-cols-2">
        <div><h4 className="font-medium">Market summary & prioritised findings</h4>{campaign.trendFindings.length ? <ol className="mt-3 space-y-3">{campaign.trendFindings.map(f=><li key={f.id} className="text-sm"><strong>{f.topic}</strong><span className="ml-2 text-xs text-mute">{f.basis === 'supported' ? 'Source cited · review required' : 'Assumption'} · confidence {f.confidence}%</span><p className="mt-1 text-ink-soft">{f.finding}</p><p className="mt-1 text-xs text-mute">Relevance {f.relevance}% · {f.evidenceIds.length} cited records</p><ul className="mt-2 space-y-1 text-xs text-mute">{f.evidenceIds.map(id=>{const e=campaign.evidence.find(source=>source.id===id);return <li key={id}>{e ? <>{e.sourceName} · {e.observedAt ?? 'Date unknown'} · {e.status} {/^https?:\/\//.test(e.sourceRef)&&<a className="text-signal underline" href={e.sourceRef} target="_blank" rel="noreferrer">Read source</a>}</> : 'Source record unavailable'}</li>;})}</ul></li>)}</ol>:<p className="mt-2 text-sm text-mute">Awaiting analysis.</p>}</div>
        <div className="space-y-5"><div><h4 className="font-medium">Opportunities</h4>{campaign.opportunities.length ? <ol className="mt-2 space-y-2">{campaign.opportunities.map(o=><li key={o.id} className="text-sm"><strong>{o.rank}. {o.title}</strong><p className="text-ink-soft">{o.why}</p></li>)}</ol>:<p className="mt-2 text-sm text-mute">Awaiting evidence-backed opportunities.</p>}</div>
          <div><h4 className="font-medium">Risks & sensitivities</h4><ul className="mt-2 space-y-2 text-sm">{campaign.trendFindings.filter(f=>f.risk).map(f=><li key={f.id}>{f.risk}</li>)}{!campaign.trendFindings.some(f=>f.risk)&&<li className="text-mute">No risk assessment recorded. This does not mean no risks exist.</li>}</ul></div>
          <div><h4 className="font-medium">Recommended theme</h4><p className="mt-2 text-sm text-ink-soft">{campaign.brief?.angle || 'Awaiting supported theme recommendations.'}</p></div>
          <div><h4 className="font-medium">Visual direction</h4><p className="mt-2 text-sm text-ink-soft">{campaign.brief?.visualDirection || 'Awaiting supported visual recommendations.'}</p></div>
        </div>
      </div>
      <details className="mt-6 border-t border-line pt-4"><summary className="cursor-pointer text-sm">All limitations · {campaign.trendGaps.length}</summary><ul className="mt-3 space-y-3 text-sm">{campaign.trendGaps.map(g=><li key={g.id}>{g.detail}<p className="text-mute">Impact: {g.effect}</p></li>)}</ul></details>
    </section>

    <section id="research-decisions" className="hairline border-l-4 border-l-signal p-5 md:p-7" aria-label="Research decisions">
      <div className="flex flex-wrap justify-between gap-2"><h3 className="font-serif text-xl">Needs your attention</h3><span className="status-chip status-wait">{attention.length} research requests</span></div>
      <p className="mt-2 text-sm text-mute">A decision may allow further research or clarify the brief. It cannot certify unsupported findings or authorise publication.</p>
      {attention.length ? <ul className="mt-5 space-y-4">{attention.map(g=><li key={g.id} className="rounded-xl border border-line p-4">
        <h4 className="font-medium">{g.kind==='missing_source' ? 'More evidence needed' : g.kind==='conflict' ? 'Conflicting evidence needs review' : 'Evidence quality needs review'}</h4>
        <dl className="mt-3 space-y-2 text-sm"><div><dt className="font-medium">Why you are seeing this</dt><dd className="text-ink-soft">{g.detail}</dd></div><div><dt className="font-medium">What is affected</dt><dd className="text-ink-soft">{g.effect}</dd></div><div><dt className="font-medium">Next action</dt><dd className="text-ink-soft">{g.kind==='missing_source' ? 'Check source access in Settings or provide an authorised aggregate export below, then request another research run.' : 'Review the cited sources and record clarification with the project owner. This request stays open until the research workflow reassesses the evidence.'}</dd></div></dl>
        <p className="mt-3 text-xs text-mute">Awaiting evidence / assessment · approval cannot clear this automatically.</p>
      </li>)}</ul>:<p className="mt-4 text-sm">{recorded ? 'No research decision has been requested. Evidence validation is still required before the report is complete.' : 'No research approval requested yet. Run the research workflow first to identify evidence gaps.'}</p>}
      <div className="mt-5 flex flex-wrap gap-4 text-sm text-signal"><Link href="/settings">Check source connections →</Link><a href="#retail-data">Provide authorised retail data →</a></div>
      {campaign.status==='awaiting_approval'&&<p className="mt-5 border-t border-line pt-4 text-sm">This campaign also has a separate advertising approval. <Link className="text-signal underline" href={`/campaigns/${campaign.id}?tab=compliance`}>Review advertising →</Link></p>}
    </section>
  </div>;
}
