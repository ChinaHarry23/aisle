/** Synthetic provider contract matrix. No live network, credentials or model spend. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { blankCampaign, defaultBrand } from '../src/lib/seed';
import { defaultSettings } from '../src/lib/settings';
import { researchTools } from '../src/lib/trend/source-tools';
import { clearPublicResearchCache } from '../src/lib/trend/public-cache';
import { setShelfPriceLookup, shelfPriceTool, seasonWeatherTool, toolByName } from '../src/lib/runtime/tools';
import { loadCatalogue } from '../src/lib/retail/whichgrocer/api';
import { lookupShelfPrices } from '../src/lib/retail/whichgrocer/connection';
import { createTrendResearch } from '../src/lib/agents/trend-research';
import { stubComplete } from '../src/lib/llm/stub';
import { runSeatAgent } from '../src/lib/agents/agent-runtime';
import { runEngine } from '../src/lib/runtime/engine';
import type { ToolOutcome } from '../src/lib/runtime/tools';
const originalFetch=globalThis.fetch, originalEnv={...process.env};
const at='2026-10-25T10:00:00Z', settings=defaultSettings();settings.agents.trend={provider:'local',modelId:'local:custom'};
const campaign=()=>blankCampaign({name:'SYNTHETIC SCRUM-124',product:'Apple juice',category:'Grocery',country:'AU',targetAudience:'Adult shoppers',objective:'Awareness',budget:1000,channels:['web'],startDate:'2026-11-01',endDate:'2026-12-26',notes:'PRIVATE_NOTES_DO_NOT_CACHE'},defaultBrand,null,settings);
const product={id:'coles_123',name:'Apple juice 1L',store:'coles',price:3,currency:'AUD',url:'https://www.coles.com.au/product/123',updated_at:'2026-10-24',weight:1,uom:'l',unit_price:3,unit_measure:'l',is_special:true,price_stats:{average_30d:4,lowest_30d:3,highest_30d:5,discount_pct:25}};
const xml='<structure:Dataflow id="HSI_M" version="1.0"><common:Name>Household Spending</common:Name></structure:Dataflow><structure:Dimension id="MEASURE" position="1"><Ref id="CL_M" class="Codelist" /></structure:Dimension><structure:Codelist id="CL_M"><structure:Code id="1"><common:Name>Index</common:Name></structure:Code></structure:Codelist>';
const args:Record<string,Record<string,string>>={'web.search':{category:'current_market'},'web.scrape_page':{url:'https://www.abs.gov.au/statistics/synthetic',category:'current_market'},'web.search_trends':{kind:'TIMESERIES'},'stats.abs_spending':{mode:'series',flow:'HSI_M',key:'1'},'calendar.public_holidays':{year:'2026'},'web.historical_weather':{},'retail.specials':{},'retail.price_stats':{productId:'coles_123'},'web.shelf_prices':{query:'Apple juice'},'web.season_weather':{country:'AU',start:'2026-11-01',end:'2026-12-26'}};
const keys:Record<string,string>={'web.search':'FIRECRAWL_API_KEY','web.scrape_page':'FIRECRAWL_API_KEY','web.search_trends':'SERPAPI_API_KEY','retail.specials':'WHICHGROCER_API_KEY','retail.price_stats':'WHICHGROCER_API_KEY','web.shelf_prices':'WHICHGROCER_API_KEY'};
function fixture(name:string,url:string):Response {
 if(name==='web.search')return Response.json({creditsUsed:2,data:{web:[{url:'https://www.abs.gov.au/statistics/synthetic',description:'SYNTHETIC primary source snippet'}]}});
 if(name==='web.scrape_page')return Response.json({data:{markdown:'SYNTHETIC source observation.',metadata:{sourceURL:'https://www.abs.gov.au/statistics/synthetic',publishedTime:'2026-10-01',creditsUsed:1}}});
 if(name==='web.search_trends')return Response.json({interest_over_time:{timeline_data:[{date:'Oct 2026',values:[{query:'Apple juice',extracted_value:42}]}]}});
 if(name==='calendar.public_holidays')return Response.json([{date:'2026-12-25',name:'Synthetic holiday',global:false,counties:['AU-NSW']}]);
 if(name==='stats.abs_spending')return url.includes('/dataflow/')?new Response(xml):new Response('TIME_PERIOD,OBS_VALUE,UNIT_MEASURE\n2026-08,12,INDEX\n');
 if(name.includes('weather'))return Response.json({daily:{time:[name==='web.season_weather'?'2026-11-02':'2025-11-02'],temperature_2m_max:[24],temperature_2m_min:[12],precipitation_sum:[0]},daily_units:{temperature_2m_max:'C'}});
 return Response.json({meta:{credits_charged:1},data:name==='retail.price_stats'?product:[product]});
}
function input(name:string,c=campaign()){if(name==='retail.price_stats')c.evidence=[{id:'prior-product',claim:'SYNTHETIC',detail:JSON.stringify(product),sourceName:'WhichGrocer',sourceRef:product.url,sourceKind:'external_public',observedAt:'2026-10-24',fetchedAt:at,status:'verified',confidence:0,raisedBy:'trend',usedFor:'candidate',research:{category:'competitor',geography:'AU',queryScope:'Grocery',permission:'allowed',quality:'unassessed'}}];return {campaign:c,brand:defaultBrand,at,args:args[name]};}
let checks=0;const matrix:unknown[]=[];
function pass(label:string){checks++;console.log('PASS '+label);}
try{
 process.env.TREND_PUBLIC_CACHE_TTL_MS='0';delete process.env.LANGSMITH_TRACING;delete process.env.LANGCHAIN_TRACING_V2;
 for(const key of Object.values(keys))process.env[key]='SYNTHETIC_NOT_REAL';
 setShelfPriceLookup(lookupShelfPrices);
 for(const tool of [...researchTools,shelfPriceTool,seasonWeatherTool]){
  let calls=0;
  globalThis.fetch=async(url,init)=>{calls++;assert.ok(init?.signal,'HTTP timeout signal required');return fixture(tool.name,String(url));};
  const succeeded=await tool.run(input(tool.name));assert.equal(succeeded.status,'ok',tool.name+' success');assert.ok(succeeded.evidence.length);
  assert.ok(succeeded.evidence.every(e=>e.sourceRef&&e.fetchedAt));
  const expected=tool.name==='web.search'||tool.name==='web.shelf_prices'?2:tool.name==='web.scrape_page'||tool.name.startsWith('retail.')||tool.name==='web.shelf_prices'?1:null;
  if(succeeded.usage){assert.equal(succeeded.usage.credits,expected);assert.equal(succeeded.usage.creditsBasis,expected===null?'unknown':'reported');}
  const cases=['success'];
  const credential=keys[tool.name];if(credential){delete process.env[credential];calls=0;const missing=await tool.run(input(tool.name));if(tool.name!=='web.scrape_page'){assert.notEqual(missing.status,'ok');assert.equal(calls,0);}else{assert.notEqual(missing.status,'ok');}process.env[credential]='SYNTHETIC_NOT_REAL';cases.push('missing-key/direct-public-alternative');}
  for(const failure of ['http','timeout','malformed','empty']){
   globalThis.fetch=async()=>{if(failure==='http')return new Response('private error detail',{status:429});if(failure==='timeout')throw new DOMException('secret timeout payload','TimeoutError');if(failure==='malformed')return new Response('{');return Response.json({});};
   const result=await tool.run(input(tool.name));assert.notEqual(result.status,'ok',tool.name+' '+failure);assert.ok(result.gap);assert.ok(!JSON.stringify(result).includes('secret timeout payload'));cases.push(failure);
  }
  calls=0;globalThis.fetch=async()=>{calls++;throw Error('No forbidden I/O');};
  const denied=input(tool.name);denied.campaign.dataAccessPolicy={externalSources:[]};assert.equal((await tool.run(denied)).status,'skipped');assert.equal(calls,0);cases.push('permission');
  matrix.push({tool:tool.name,cases});pass(tool.name+' HTTP/permission/credential matrix');
 }
 // All raw HTTP credits from search + equivalents are counted, never guessed.
 let apiCalls=0;globalThis.fetch=async()=>{apiCalls++;return Response.json({meta:{credits_charged:apiCalls},data:[{...product,store:apiCalls===1?'coles':'woolworths'}]});};
 const credits:(number|null)[]=[];await loadCatalogue('Apple juice',fetch,v=>credits.push(v));assert.deepEqual(credits,[1,2]);
 const lookup=await lookupShelfPrices({product:'Apple juice',category:'Grocery',country:'AU',at});assert.ok(lookup.ok&&lookup.usage?.credits===7);pass('WhichGrocer multi-request actual credits and catalogue metadata');
 // Cross-run reuse: fresh IDs, immutable original dates, zero current credits, isolated accounts/scopes.
 process.env.TREND_PUBLIC_CACHE_TTL_MS='1000';clearPublicResearchCache();let http=0;
 globalThis.fetch=async url=>{http++;return fixture('web.search',String(url));};const search=toolByName('web.search')!;
 const first=await search.run(input('web.search')), secondInput=input('web.search');secondInput.at='2026-10-26T10:00:00Z';
 const second=await search.run(secondInput);assert.equal(http,1);assert.equal(second.usage?.credits,0);assert.equal(second.usage?.originalCredits,2);assert.equal(second.usage?.cache,'hit');assert.equal(second.evidence[0].fetchedAt,first.evidence[0].fetchedAt);assert.notEqual(second.evidence[0].id,first.evidence[0].id);assert.notEqual(secondInput.campaign.id,campaign().id);
 const denied=input('web.search');denied.campaign.dataAccessPolicy={externalSources:[]};assert.equal(await search.cached!(denied),null);
 const scoped=input('web.search');scoped.campaign.product='Rain jacket';await search.run(scoped);assert.equal(http,2);
 process.env.FIRECRAWL_API_KEY='SYNTHETIC_OTHER_ACCOUNT';await search.run(input('web.search'));assert.equal(http,3);delete process.env.FIRECRAWL_API_KEY;assert.equal(await search.cached!(input('web.search')),null);process.env.FIRECRAWL_API_KEY='SYNTHETIC_NOT_REAL';
 const now=Date.now;Date.now=()=>now()+2000;try{await search.run(input('web.search'));assert.equal(http,4);}finally{Date.now=now;}
 pass('TTL cache preserves provenance, rebinds evidence, isolates scope/accounts and rechecks permissions/credentials/expiry');
 // Revalidate prices on cached reads and make missing source dates stale.
 clearPublicResearchCache();globalThis.fetch=async()=>Response.json({meta:{credits_charged:1},data:[product]});
 const specials=toolByName('retail.specials')!;await specials.run(input('retail.specials'));const later=input('retail.specials');later.at='2026-11-02T00:00:00Z';assert.equal((await specials.run(later)).evidence[0].status,'stale');
 process.env.TREND_PUBLIC_CACHE_TTL_MS='0';for(const observed of ['2026-10-17',undefined,'2026-10-26']){globalThis.fetch=async()=>Response.json({data:[{...product,updated_at:observed}]});assert.equal((await specials.run(input('retail.specials'))).evidence[0].status,'stale');}
 globalThis.fetch=async()=>Response.json({data:[{...product,updated_at:'2026-10-01'}]});
 const oldShelf=await shelfPriceTool.run(input('web.shelf_prices'));assert.equal((oldShelf.data as {offers:unknown[]}).offers.length,0);assert.ok(oldShelf.evidence.every(e=>e.status==='stale'));
 pass('7-day catalogue gate rejects old/unknown/future dates, ages cached results and excludes stale prices from clearance inputs');
 // Shared executor gates include preliminary collection: deliberately tighten only in explicit mock mode.
 const seen:ToolOutcome[]=[];let actual=0;
 const runner=createTrendResearch(undefined,{mode:'mock',toolCallLimit:3,complete:async req=>({...stubComplete(req,'MOCK'),status:'error'})});
 await runner({campaign:campaign(),brand:defaultBrand,settings,at,allowed:async()=>true,onFailedUsage:()=>{},execute:async(_name,_args,override)=>{if(override){seen.push(override);return override;}actual++;return {status:'empty',summary:'SYNTHETIC missing',evidence:[],data:null};}});
 assert.equal(actual,3);assert.ok(seen.some(o=>o.summary.includes('cap reached')));pass('combined collection/enrichment executor cap blocks I/O before dispatch');
 const answer={priorities:[],angle:'SYNTHETIC partial',keyMessage:'Review',claimsAllowed:[],claimsAvoid:[],visualDirection:'Product only',limitations:['SYNTHETIC gaps']};
 const spans:{id:string;parent?:string;name:string}[]=[];let turns=0;
 const traced=createTrendResearch(undefined,{mode:'mock',complete:async req=>++turns===1?{...stubComplete(req,'MOCK'),status:'ok',text:null,toolCalls:[{id:'one',name:'web.scrape_page',args:args['web.scrape_page']},{id:'two',name:'calendar.public_holidays',args:args['calendar.public_holidays']}]}:{...stubComplete(req,'MOCK'),status:'ok',text:JSON.stringify(answer)}});
 globalThis.fetch=async url=>String(url).includes('nager')?fixture('calendar.public_holidays',String(url)):new Response('<main>SYNTHETIC original source</main>',{headers:{'Content-Type':'text/html'}});delete process.env.FIRECRAWL_API_KEY;
 const c=campaign();await runEngine({campaigns:[c],now:at},c,{type:'START',actor:'founder'},settings,defaultBrand,{llm:{request:async()=>{throw Error('Unexpected separate decision');},research:traced},traceConfig:{callbacks:[{name:'SCRUM124LocalObserver',handleChainStart(_chain:unknown,_inputs:unknown,id:string,parent?:string,_tags?:string[],_metadata?:unknown,_type?:string,name?:string){spans.push({id,parent,name:name??''});}}]},renderPoster:async()=>{throw Error('No handoff');}});
 const root=spans.find(s=>s.name.startsWith('aisle.operation.START')),trend=spans.find(s=>s.name==='trend'),seat=spans.find(s=>s.name==='aisle_trend');assert.ok(root&&trend&&seat,JSON.stringify(spans));
 const ancestor=(id:string,target:string):boolean=>{const s=spans.find(v=>v.id===id);return !!s&&(s.parent===target||!!s.parent&&ancestor(s.parent,target));};assert.ok(ancestor(seat.id,trend.id)&&ancestor(trend.id,root.id));
 pass('local real LangGraph callback hierarchy: operation START -> trend -> aisle_trend (mock model, not hosted acceptance)');

 for(const batch of [1,13]){
  let completed=0,dispatched=0;
  const limited=await runSeatAgent({seat:'trend',toolAgent:'trend',modelId:'local:custom',billing:undefined,task:'SYNTHETIC bound probe',tools:{names:['calendar.public_holidays'],execute:async()=>{dispatched++;return {status:'ok',summary:'Synthetic',evidence:[],data:null};}},complete:async req=>{completed++;return {...stubComplete(req,'MOCK'),status:'ok',text:null,toolCalls:Array.from({length:batch},(_,i)=>({id:`${completed}-${i}`,name:'calendar.public_holidays',args:{year:'2026'}}))};}});
  assert.equal(limited,null);assert.ok(completed<=6);assert.ok(dispatched<=12);
  assert.ok(completed>=1);if(batch===13)assert.equal(completed,1);
 }
 pass('shared middleware enforces six model turns and twelve agent tool executions, including over-cap batches');
 if(process.argv.includes('--record'))writeFileSync('docs/SCRUM-124-TEST-SUMMARY.json',JSON.stringify({mode:'SYNTHETIC mocked HTTP/model; no live provider or hosted LangSmith claim',checks,matrix,localTrace:spans.map(s=>({name:s.name,id:s.id,parent:s.parent})),hostedTrace:'PENDING existing LangSmith configuration'},null,2)+'\n');
 console.log(`${checks} SCRUM-124 acceptance groups passed.`);
}finally{globalThis.fetch=originalFetch;process.env=originalEnv;clearPublicResearchCache();}
