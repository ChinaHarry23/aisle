/** Bounded public retrieval. Search results are evidence candidates, never instructions. */
import { z } from 'zod';
import { getPublicResearchCache, putPublicResearchCache, publicCacheKey } from './public-cache';
import { uid } from '@/lib/ids';
import type { Evidence } from '@/lib/runtime/types';
import type { ToolDefinition, ToolInput, ToolOutcome } from '@/lib/runtime/tools';
import { RESEARCH_CATEGORIES, sourcePermitted, unavailable, type ResearchCategory } from './contracts';
export const RESEARCH_TOOL_IDS = ['web.search', 'web.scrape_page', 'web.search_trends', 'stats.abs_spending', 'calendar.public_holidays', 'web.historical_weather', 'retail.specials', 'retail.price_stats'] as const;
const categorySchema = z.enum(RESEARCH_CATEGORIES);
const querySchema = z.object({ category: categorySchema, channel: z.string().max(40).optional() }).strict();
export const sourceHosts = ['abs.gov.au', 'aihw.gov.au', 'accc.gov.au', 'bom.gov.au', 'australia.com', 'visitnsw.com', 'nagerholidays.com', 'business.gov.au', 'thinkwithgoogle.com', 'business.instagram.com', 'facebook.com', 'meta.com', 'support.google.com', 'developers.google.com', 'mailchimp.com', 'coles.com.au', 'woolworths.com.au', 'aldi.com.au', 'iga.com.au', 'stats.govt.nz', 'ons.gov.uk', 'census.gov'];
export function publicSourceUrl(raw: string): string | null {
  try { const url = new URL(raw); const hosts = [...sourceHosts, ...(process.env.TREND_SOURCE_DOMAINS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)];
    if (/^[\d.]+$/.test(url.hostname) || url.hostname.includes(':') || !url.hostname.includes('.') || /\.(local|localhost|internal|test)$/.test(url.hostname) || url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.search || url.hash || !hosts.some(h => url.hostname === h || url.hostname.endsWith('.'+h))) return null;
    return url.href;
  } catch { return null; }
}
export function redact(text: string): string {
  return text.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email removed]').replace(/(?:bearer\s+\S+|(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+)/gi, '[credential removed]').replace(/\b(?:\+?\d[ ()-]?){9,15}\b/g, '[identifier removed]');
}
function safePublicTerm(value: string) { return redact(value).replace(/[^\p{L}\p{N}\s&'-]/gu, ' ').slice(0, 100); }
export function queryFor(input: ToolInput, category: ResearchCategory, channel?: string) {
  const c = input.campaign;
  const areas: Record<ResearchCategory,string> = {current_market:'current market report',historical_market:'historical market time series',customer_interest:'consumer interest survey methodology',purchase_preference:'consumer purchasing preferences survey sample methodology',seasonal:'seasonal retail demand',cultural:'local cultural events calendar',channel:'audience engagement research methodology',competitor:'retailer promotion price offer dates'};
  // Never transmit notes, uploads, audience free text, budgets or credentials to search.
  return `${safePublicTerm(c.product)} ${safePublicTerm(c.category)} ${c.country} ${areas[category]} ${channel ?? ''} ${c.startDate.slice(0,4)} ${c.endDate.slice(0,4)}`;
}
export async function boundedResponse(response: Response, maximum = 1_000_000): Promise<string> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const reader = response.body?.getReader(); if (!reader) throw new Error('Empty body');
  let size=0; const parts: Uint8Array[]=[];
  while (true) { const next=await reader.read(); if(next.done)break; size+=next.value.length; if(size>maximum){await reader.cancel();throw new Error('Response exceeds size cap');} parts.push(next.value); }
  return new TextDecoder().decode(Buffer.concat(parts));
}
async function json(url: string, init: RequestInit = {}): Promise<unknown> {
  return JSON.parse(await boundedResponse(await fetch(url, {...init,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12_000)})));
}
function record(value: unknown): Record<string, unknown> { return value && typeof value==='object' && !Array.isArray(value) ? value as Record<string,unknown> : {}; }
function date(value: unknown): string | null { return typeof value==='string' && /^\d{4}-\d{2}-\d{2}/.test(value) && Number.isFinite(Date.parse(value)) ? value.slice(0,10):null; }
function item(input: ToolInput, category: ResearchCategory, name: string, url: string, excerpt: string, observedAt: string|null, extra: Partial<NonNullable<Evidence['research']>> = {}): Evidence {
  return {id:uid('ev'), claim:`Retrieved ${category.replaceAll('_',' ')} material`, detail:redact(excerpt).slice(0,2400),sourceName:name,sourceRef:url,sourceKind:'external_public',observedAt,dateBasis:observedAt?'source_record':'unknown',fetchedAt:input.at,status:'verified',confidence:0,raisedBy:'trend',usedFor:'Source material only; not a validated conclusion.',research:{category,geography:input.campaign.country,queryScope:queryFor(input,category,input.args.channel),permission:'allowed',quality:'unassessed',...extra}};
}
function result(evidence: Evidence[], data: unknown, summary: string): ToolOutcome { return evidence.length ? {status:'ok',summary,evidence,data} : unavailable('No usable scoped records returned.'); }
/** Runtime telemetry is separate from source evidence and model conclusions. */
function providerUsage(provider: 'firecrawl'|'whichgrocer'|'serpapi', response: Record<string,unknown>): NonNullable<ToolOutcome['usage']> {
  const candidate = provider === 'whichgrocer' ? record(response.meta).credits_charged
    : provider === 'firecrawl' ? response.creditsUsed ?? record(response.data).creditsUsed ?? record(record(response.data).metadata).creditsUsed : undefined;
  const credits = typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0 ? candidate : null;
  return {provider, cache:'miss', credits, creditsBasis:credits === null ? 'unknown' : 'reported'};
}
function providerFor(name:string) {
  if(name==='web.search'||name==='web.scrape_page')return process.env.FIRECRAWL_API_KEY ? {name:'firecrawl',credential:process.env.FIRECRAWL_API_KEY}:null;
  if(name==='web.search_trends')return process.env.SERPAPI_API_KEY ? {name:'serpapi',credential:process.env.SERPAPI_API_KEY}:null;
  if(name==='web.shelf_prices'||name==='retail.specials'||name==='retail.price_stats')return process.env.WHICHGROCER_API_KEY ? {name:'whichgrocer',credential:process.env.WHICHGROCER_API_KEY}:null;
  return null;
}
function eligible(name:string,schema:z.ZodType,input:ToolInput): ToolOutcome|null {
  if(!sourcePermitted(input.campaign,name,[...RESEARCH_TOOL_IDS,'web.shelf_prices']))return unavailable(`${name} excluded by DataAccessPolicy.`,'skipped');
  if(!schema.safeParse(input.args).success)return unavailable('Invalid tool arguments.','error');
  if(input.args.channel && !input.campaign.channels.includes(input.args.channel as never))return unavailable('Channel is outside the approved campaign.','skipped');
  if(name==='web.scrape_page'&&!publicSourceUrl(input.args.url))return unavailable('URL is outside the public source allowlist.','skipped');
  if(name.startsWith('retail.')&&input.campaign.country!=='AU')return unavailable('WhichGrocer covers Australia only.','skipped');
  if(name==='retail.price_stats'&&!input.campaign.evidence.some(e=>e.sourceName==='WhichGrocer'&&e.research?.category==='competitor'&&e.detail.includes(`"id":"${input.args.productId}"`)))return unavailable('Select a product ID from this campaign’s retrieved WhichGrocer evidence first.','skipped');
  return null;
}
async function cacheKey(name:string,input:ToolInput) {
  const provider=providerFor(name);if(!provider)return null;
  // Only public query scope is cached. Credential digest isolates provider accounts.
  const c=input.campaign;
  return publicCacheKey({version:1,provider:provider.name,name,args:Object.entries(input.args).sort(),product:safePublicTerm(c.product),category:safePublicTerm(c.category),country:c.country,start:c.startDate,end:c.endDate,channels:c.channels,hosts:process.env.TREND_SOURCE_DOMAINS??''},provider.credential);
}
function refreshCached(outcome:ToolOutcome,input:ToolInput) {
  for(const e of outcome.evidence){
    if(e.sourceName==='WhichGrocer'){
      const age=e.observedAt?(Date.parse(input.at.slice(0,10))-Date.parse(e.observedAt))/86400000:Infinity;
      if(age<0||age>7){e.status='stale';e.detail=e.detail.replace('Recent catalogue record','Historical/stale; not current');}
    }
  }
  if(Array.isArray((outcome.data as {offers?:unknown[]})?.offers)){
    const data=outcome.data as {offers:{observedAt?:string;archived?:boolean;stale?:boolean}[]};
    data.offers=data.offers.filter(o=>{const age=o.observedAt?(Date.parse(input.at.slice(0,10))-Date.parse(o.observedAt))/86400000:Infinity;return !o.archived&&!o.stale&&age>=0&&age<=7;});
  }
  return outcome;
}
export function definePublicResearchTool(name: string,label: string,schema: z.ZodType,run: (i: ToolInput)=>Promise<ToolOutcome>): ToolDefinition {
  const cached=async(input:ToolInput)=>{
    if(eligible(name,schema,input))return null;
    const key=await cacheKey(name,input);if(!key)return null;
    const hit=getPublicResearchCache(key);return hit?refreshCached(hit,input):null;
  };
  return {name,label,agent:'trend',description:label+'. Returns bounded source material and provenance; never establishes claim support by itself.',args:Object.keys(schema instanceof z.ZodObject ? schema.shape : {}),schema,cached,async run(input){
    const rejected=eligible(name,schema,input);if(rejected)return rejected;
    const hit=await cached(input);if(hit)return hit;
    try{
      const outcome=await run(input);
      const provider=providerFor(name);
      if(provider&&!outcome.usage)outcome.usage={provider:provider.name as 'firecrawl'|'whichgrocer'|'serpapi',cache:'miss',credits:null,creditsBasis:'unknown'};
      const key=await cacheKey(name,input);if(key&&outcome.usage)putPublicResearchCache(key,outcome);
      return outcome;
    }catch(error){const outcome=unavailable(error instanceof Error && /^HTTP \d+$/.test(error.message)?`${name}: ${error.message}`:`${name}: unavailable, timed out or malformed response.`);const provider=providerFor(name);if(provider)outcome.usage={provider:provider.name as 'firecrawl'|'whichgrocer'|'serpapi',cache:'miss',credits:null,creditsBasis:'unknown'};return outcome;}
  }};
}
const define=definePublicResearchTool;

const searchTool=define('web.search','Scoped public search: Firecrawl or existing model-provider web search when configured',querySchema,async input=>{
  if(!process.env.FIRECRAWL_API_KEY)return unavailable('Firecrawl key is not configured.');
  const category=input.args.category as ResearchCategory;
  const response=record(await json('https://api.firecrawl.dev/v2/search',{method:'POST',headers:{Authorization:`Bearer ${process.env.FIRECRAWL_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({query:queryFor(input,category,input.args.channel),limit:3,sources:['web'],country:input.campaign.country==='UK'?'GB':input.campaign.country,timeout:10000})}));
  const data=record(response.data); const rows=Array.isArray(data.web)?data.web:[];
  const evidence=rows.slice(0,3).flatMap(row=>{const r=record(row);const url=publicSourceUrl(String(r.url??''));const excerpt=typeof r.description==='string'?r.description:'';return url&&excerpt?[item(input,category,'Firecrawl Search',url,excerpt,null,{channel:input.args.channel,quality:'snippet'})]:[];});
  return {...result(evidence,{sources:evidence.map(e=>({id:e.id,url:e.sourceRef,excerpt:e.detail})),next:'Read original sources with web.scrape_page. Search snippets alone cannot satisfy coverage.'},'Public search results retrieved; snippets require original-source review.'),usage:providerUsage('firecrawl',response)};
});
const scrapeTool=define('web.scrape_page','Firecrawl read an allowlisted original public source',z.object({url:z.string().max(1200),category:categorySchema,channel:z.string().max(40).optional()}).strict(),async input=>{
  const url=publicSourceUrl(input.args.url);if(!url)return unavailable('URL is outside the public source allowlist (no credentials, query strings, IPs or private hosts).','skipped');
  if(!process.env.FIRECRAWL_API_KEY){
    const response=await fetch(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12_000),headers:{Accept:'text/html, text/plain'}});
    if(!/text\/(html|plain)/i.test(response.headers.get('content-type') ?? '')) return unavailable('Public source is not readable HTML/plain text; configure extraction for this format.');
    const raw=await boundedResponse(response);
    // Read machine-declared publication dates; never substitute fetch time.
    const published=date(raw.match(/<meta[^>]+(?:property|name)=["']article:published_time["'][^>]+content=["']([^"']+)/i)?.[1]
      ?? raw.match(/["']datePublished["']\s*:\s*["']([^"']+)/i)?.[1]);
    const body=raw.match(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/i)?.[1]??raw;
    const text=redact(body.replace(/<(script|style|noscript|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim());
    if(!text)return unavailable('No readable public text.');
    if(/incapsula incident id|request unsuccessful|access denied|verify (?:that )?you are (?:a )?human|enable javascript and cookies to continue/i.test(text.slice(0,1200)))return unavailable('Public source returned an access challenge, not research content.');
    const evidence=[item(input,input.args.category as ResearchCategory,'Public source text',url,text,published,{channel:input.args.channel,transformation:'Bounded public main/article text; scripts/navigation removed. First 2400 characters only. Publication date from declared article metadata/JSON-LD when present; otherwise unknown.'})];
    return result(evidence,{sources:evidence},'Public text retrieved directly; relevance and publication date require review.');
  }
  const response=record(await json('https://api.firecrawl.dev/v2/scrape',{method:'POST',headers:{Authorization:`Bearer ${process.env.FIRECRAWL_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({url,formats:['markdown'],onlyMainContent:true,timeout:10000})}));
  const data=record(response.data),metadata=record(data.metadata);const finalUrl=publicSourceUrl(String(metadata.sourceURL??url));
  if(!finalUrl || new URL(finalUrl).hostname!==new URL(url).hostname)return unavailable('Redirected source rejected.','skipped');
  const content=typeof data.markdown==='string'?data.markdown:'';if(!content)return unavailable('Source has no readable content.');
  if(/incapsula incident id|request unsuccessful|access denied|verify (?:that )?you are (?:a )?human|enable javascript and cookies to continue/i.test(content.slice(0,1200)))return unavailable('Extractor returned an access challenge, not research content.');
  const evidence=[item(input,input.args.category as ResearchCategory,'Firecrawl Scrape',finalUrl,content,date(metadata.publishedTime??metadata['article:published_time']),{channel:input.args.channel,transformation:'First 2400 characters; not the full report. Assess sampling and methodology.'})];
  return {...result(evidence,{sources:evidence},'Original public text retrieved; publication date remains unknown when absent.'),usage:providerUsage('firecrawl',response)};
});
const trendsTool=define('web.search_trends','Google Trends relative search interest; never sales volume',z.object({kind:z.enum(['TIMESERIES','RELATED_QUERIES'])}).strict(),async input=>{
  if(!process.env.SERPAPI_API_KEY)return unavailable('SerpApi key is not configured.');
  const url=new URL('https://serpapi.com/search.json');const q=safePublicTerm(input.campaign.product);
  for(const [k,v] of Object.entries({engine:'google_trends',q,geo:input.campaign.country==='UK'?'GB':input.campaign.country,date:'today 12-m',data_type:input.args.kind,api_key:process.env.SERPAPI_API_KEY}))url.searchParams.set(k,v);
  const response=record(await json(url.href));if(response.error)return unavailable('Trends returned no usable series.');
  const timeline=record(response.interest_over_time).timeline_data;
  const related=record(response.related_queries);
  const data=input.args.kind==='TIMESERIES'?(Array.isArray(timeline)?timeline.slice(-60):[]):related;
  if(Array.isArray(data)?!data.length:!Object.keys(data).length)return unavailable('Trends returned empty data.');
  const category=input.args.kind==='TIMESERIES'?'historical_market':'customer_interest';
  const ref=`https://trends.google.com/trends/explore?geo=${input.campaign.country==='UK'?'GB':input.campaign.country}&q=${encodeURIComponent(q)}&date=today%2012-m`;
  const excerpt=JSON.stringify(data);
  return {...result([item(input,category,'SerpApi Google Trends',ref,excerpt,null,{transformation:'Relative interest over trailing 12 months, not sales; partial periods may be incomplete.'})],{records:data},'Relative search interest retrieved. Search interest is not purchase preference.'),usage:providerUsage('serpapi',response)};
});
const holidaysTool=define('calendar.public_holidays','Nager.Date public holidays in the campaign year and country',z.object({year:z.string().regex(/^\d{4}$/)}).strict(),async input=>{
  const {campaign:c}=input;if(![c.startDate.slice(0,4),c.endDate.slice(0,4)].includes(input.args.year))return unavailable('Year is outside the campaign.','skipped');
  const url=`https://nagerholidays.com/api/v3/publicholidays/${input.args.year}/${c.country==='UK'?'GB':c.country}`;
  const rows=await json(url);if(!Array.isArray(rows))return unavailable('Invalid calendar response.');
  const data=rows.map(record).filter(r=>typeof r.date==='string'&&r.date>=c.startDate&&r.date<=c.endDate);
  const excerpt= data.length?JSON.stringify(data):'No public holidays in the requested campaign window. This does not mean there are no cultural events.';
  return result([item(input,'cultural','Nager.Date',url,excerpt,null,{transformation:'National and subdivision calendar records; subdivision relevance and cultural significance require review.'})],{holidays:data},'Calendar retrieved; a holiday alone does not establish consumer preference.');
});
const cities:Record<string,[number,number,string]>={AU:[-33.87,151.21,'Sydney'],NZ:[-36.85,174.76,'Auckland'],UK:[51.51,-0.13,'London'],US:[40.71,-74.01,'New York']};
const historicalWeather=define('web.historical_weather','Open-Meteo historical weather for the same calendar window one year earlier',z.object({}).strict(),async input=>{
 const c=input.campaign,city=cities[c.country];if(!city)return unavailable('Unsupported country.');
 const previous=(d:string)=>`${Number(d.slice(0,4))-1}${d.slice(4)}`;const start=previous(c.startDate),end=previous(c.endDate);
 if(end>=input.at.slice(0,10)||new Date(start).toISOString().slice(0,10)!==start||new Date(end).toISOString().slice(0,10)!==end)return unavailable('Historical dates unsupported; no future-day climate substitution.');
 const url=`https://archive-api.open-meteo.com/v1/archive?latitude=${city[0]}&longitude=${city[1]}&start_date=${start}&end_date=${end}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;
 const response=record(await json(url)),daily=record(response.daily);if(!Array.isArray(daily.time)||!daily.time.length)return unavailable('Historical weather returned no daily records.');
 const evidence=item(input,'seasonal','Open-Meteo Historical Weather',url,JSON.stringify(daily),null,{transformation:`Previous-year comparison for ${city[2]} only, not a national observation or future forecast.`});evidence.coverage={start,end,location:city[2]};return result([evidence],{daily,units:response.daily_units},'Historical city weather retrieved for comparison.');
});
/** CSV parsing handles quoted labels, commas and escaped quotes; reject ragged rows. */
export function parseCsv(text:string):string[][] {const rows:string[][]=[];let row:string[]=[],value='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(value);value='';}else if(c==='\n'&&!quoted){row.push(value.replace(/\r$/,''));rows.push(row);row=[];value='';}else value+=c;}if(quoted)throw Error('Invalid CSV');if(value||row.length){row.push(value);rows.push(row);}return rows.filter(r=>r.some(Boolean));}
function attribute(tag: string, key: string): string { return tag.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1] ?? ''; }
function xmlName(xml: string): string { return xml.match(/<common:Name[^>]*>([^<]*)<\/common:Name>/)?.[1]?.replaceAll('&amp;', '&') ?? ''; }
export function absFlows(xml: string) {
  return [...xml.matchAll(/<structure:Dataflow\b([^>]*)>([\s\S]*?)<\/structure:Dataflow>/g)].map(m => ({id:attribute(m[1],'id'),version:attribute(m[1],'version'),name:xmlName(m[2]),nonProduction:/<common:AnnotationType>NonProductionDataflow<\/common:AnnotationType>\s*<common:AnnotationText[^>]*>true</.test(m[2])}));
}
export function absDimensions(xml: string) {
 const lists=new Map([...xml.matchAll(/<structure:Codelist\b([^>]*)>([\s\S]*?)<\/structure:Codelist>/g)].map(m=>[attribute(m[1],'id'),[...m[2].matchAll(/<structure:Code\b([^>]*)>([\s\S]*?)<\/structure:Code>/g)].map(c=>({id:attribute(c[1],'id'),name:xmlName(c[2])}))]));
 return [...xml.matchAll(/<structure:Dimension\b([^>]*)>([\s\S]*?)<\/structure:Dimension>/g)].map(m=>{const ref=[...m[2].matchAll(/<Ref\b([^>]*)\/>/g)].find(r=>attribute(r[1],'class')==='Codelist');return {id:attribute(m[1],'id'),position:Number(attribute(m[1],'position')),codes:ref?lists.get(attribute(ref[1],'id'))??[]:[]};}).sort((a,b)=>a.position-b.position);
}
const absTool=define('stats.abs_spending','ABS spending: discover current dataflows and ordered dimensions before a bounded series query',z.object({mode:z.enum(['metadata','series']),flow:z.string().max(60).regex(/^[A-Z0-9_]*$/),key:z.string().max(180).regex(/^[A-Za-z0-9_.-]*$/)}).strict(),async input=>{
 if(input.campaign.country!=='AU')return unavailable('ABS series covers Australia only.');
 const flow=input.args.flow;
 const metadataUrl=`https://data.api.abs.gov.au/rest/dataflow/ABS/${flow||'all'}/latest?references=${flow?'all':'none'}`;
 const metadata=await boundedResponse(await fetch(metadataUrl,{headers:{Accept:'application/vnd.sdmx.structure+xml;version=2.1'},redirect:'error',signal:AbortSignal.timeout(12000)}), 4_000_000);
 const flows=absFlows(metadata);
 if(!flow) return {status:'ok',summary:'ABS spending dataflow discovery; no measurement yet.',evidence:[],data:{metadataUrl,flows:flows.filter(f=>/spend|household/i.test(f.name)),instruction:'Select a production spending flow, then request its metadata to discover dimension order and codes.'}};
 const selected=flows.find(f=>f.id===flow);
 if(!selected || selected.nonProduction || !/spend|household/i.test(selected.name))return unavailable('ABS dataflow is not a verified production household/spending dataset. Discover current flows first.');
 const dimensions=absDimensions(metadata);
 if(!dimensions.length||dimensions.some(d=>!d.codes.length))return unavailable('ABS series dimension metadata is incomplete.');
 if(input.args.mode==='metadata')return {status:'ok',summary:'ABS dimension metadata retrieved; no spending measurement yet.',evidence:[],data:{flow,metadataUrl,dimensions,instruction:'Select one code from each dimension in position order. Original labels and units must remain visible.'}};
 const keyParts=input.args.key.split('.');
 if(keyParts.length!==dimensions.length||keyParts.some((code,i)=>!dimensions[i].codes.some(c=>c.id===code)))return unavailable('Series key does not match verified dimension codes.');
 const url=`https://data.api.abs.gov.au/rest/data/ABS,${flow},${selected.version}/${input.args.key}?lastNObservations=12&dimension_at_observation=AllDimensions`;
 const raw=await boundedResponse(await fetch(url,{headers:{Accept:'text/csv'},redirect:'error',signal:AbortSignal.timeout(12000)}));const [header,...rows]=parseCsv(raw);
 const ti=header?.indexOf('TIME_PERIOD')??-1,vi=header?.indexOf('OBS_VALUE')??-1;
 if(ti<0||vi<0||!rows.length||rows.some(r=>r.length!==header.length)||rows.length>100)return unavailable('Unexpected or too broad ABS series.');
 const data=rows.filter(r=>r[vi]!==''&&Number.isFinite(Number(r[vi]))).map(r=>Object.fromEntries(header.map((h,i)=>[h,r[i]])));if(!data.length)return unavailable('ABS series has no numeric observations.');
 const selection=dimensions.map((d,i)=>({dimension:d.id,code:keyParts[i],label:d.codes.find(c=>c.id===keyParts[i])!.name}));
 return result([item(input,'historical_market','ABS Data API',url,JSON.stringify({selection,records:data}),null,{transformation:`Production metadata-verified ${flow} v${selected.version}; codes, units and periods retained. Release date unknown. Macro spending is not individual preference.`})],{metadataUrl,flow,selection,records:data},'ABS observations retrieved with original labels; verify population, units and revisions.');
});
// Verified against WhichGrocer OpenAPI 2.7.0 on 21 October 2026.
const productSchema=z.object({id:z.string(),name:z.string().nullable(),store:z.string().nullable(),price:z.number().finite().nullable(),currency:z.literal('AUD'),url:z.string().nullable().optional(),updated_at:z.string().nullable().optional(),last_seen_at:z.string().optional(),is_stale:z.boolean().optional(),weight:z.number().nullable().optional(),uom:z.string().nullable().optional(),unit_price:z.number().nullable().optional(),unit_measure:z.string().nullable().optional(),is_special:z.boolean().optional(),price_stats:z.object({average_30d:z.number().nullable().optional(),lowest_30d:z.number().nullable().optional(),highest_30d:z.number().nullable().optional(),is_below_average:z.boolean().optional(),discount_pct:z.number().nullable().optional()}).optional()});
async function groceryRecords(input:ToolInput, stats:boolean):Promise<ToolOutcome>{
 if(input.campaign.country!=='AU')return unavailable('WhichGrocer covers Australian catalogue data only.','skipped');
 if(!process.env.WHICHGROCER_API_KEY)return unavailable('WhichGrocer API key is not configured.');
 if(stats && !input.campaign.evidence.some(e=>e.sourceName==='WhichGrocer'&&e.research?.category==='competitor'&&e.detail.includes(`"id":"${input.args.productId}"`)))return unavailable('Select a product ID from this campaign’s retrieved WhichGrocer evidence first.','skipped');
 const query=safePublicTerm(input.campaign.product);
 if(!stats&&query.trim().length<2)return unavailable('Product name is too short.');
 const url=stats?`https://api.whichgrocer.com/v2/products/${encodeURIComponent(input.args.productId)}`:`https://api.whichgrocer.com/v2/specials/search?q=${encodeURIComponent(query)}&page=1&page_size=5`;
 const response=record(await json(url,{headers:{Authorization:`Bearer ${process.env.WHICHGROCER_API_KEY}`,Accept:'application/json'}}));
 const rows=stats?[response.data]:Array.isArray(response.data)?response.data.slice(0,5):[];
 const evidence=rows.flatMap(raw=>{const parsed=productSchema.safeParse(raw);if(!parsed.success)return [];const r=parsed.data;
  const observed=date(r.last_seen_at??r.updated_at);const age=observed?(Date.parse(input.at.slice(0,10))-Date.parse(observed))/86400000:Infinity;
  const archived=Boolean(r.last_seen_at),stale=archived||r.is_stale===true||age>7||age<0;
  const detail=JSON.stringify({...r,scope:'Australian national catalogue; not store stock or a binding offer',offerWindow:'Unknown: provider supplies no retailer offer start/end',freshness:stale?'Historical/stale; not current':'Recent catalogue record',statistics:'Trailing 30-day summary, not a full historical series'});
  const ev=item(input,'competitor','WhichGrocer',r.url&&publicSourceUrl(r.url)?r.url:url,detail,observed,{transformation:'Product data by WhichGrocer. Preserve pack/unit measures; compare like units only. is_special means below 30-day average, not a retailer promotion flag.'});
  if(stale)ev.status='stale';
  if(r.price===null||r.price<=0||!r.name||!r.store){ev.status='unavailable';}
  return [ev];
 });
 return {...result(evidence,{products:evidence.map(e=>({id:e.id,excerpt:e.detail})),attribution:'Product data by WhichGrocer',provider:'https://www.whichgrocer.com/'},'WhichGrocer catalogue and 30-day statistics retrieved; offer window unknown. Only records observed within 7 days may support recent catalogue comparisons; no binding promotion inferred.'),usage:providerUsage('whichgrocer',response)};
}
const specialsTool=define('retail.specials','WhichGrocer specials matching the approved campaign product',z.object({}).strict(),input=>groceryRecords(input,false));
const priceStatsTool=define('retail.price_stats','WhichGrocer product detail including trailing 30-day price statistics',z.object({productId:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)}).strict(),input=>groceryRecords(input,true));
export const researchTools=[searchTool,scrapeTool,trendsTool,holidaysTool,historicalWeather,absTool,specialsTool,priceStatsTool];
