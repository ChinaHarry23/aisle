/** Regression fixtures from the October chicken campaign. All HTTP bodies are synthetic. */
import assert from 'node:assert/strict';
import { blankCampaign, defaultBrand } from '../src/lib/seed';
import { defaultSettings } from '../src/lib/settings';
import { publicSourceUrl, queryFor, replacementQueryFor, replacementSource, researchTools } from '../src/lib/trend/source-tools';
import { clearPublicResearchCache } from '../src/lib/trend/public-cache';
import { installPublicPageFixture } from './public-page-fixture';
import type { Evidence } from '../src/lib/runtime/types';
const campaign=blankCampaign({name:'SYNTHETIC chicken regression',product:'Coles RSPCA Approved Chicken Breast Fillet',category:'Grocery',targetAudience:'People who try to eat healthy; private person jane@example.com',objective:'Build awareness',budget:8000,channels:['instagram','web','email'],startDate:'2026-11-02',endDate:'2026-11-16',country:'AU',notes:'PRIVATE_NOTES_DO_NOT_SEND'},defaultBrand,null,defaultSettings());
const input={campaign,brand:{...defaultBrand,retailerName:'Coles'},at:'2026-10-26T09:14:15Z',args:{}};
const tool=(name:string)=>researchTools.find(t=>t.name===name)!;
const originalFetch=globalThis.fetch,originalEnv={...process.env};
const restorePublicPage=installPublicPageFixture(()=>({text:'<main>SYNTHETIC original: poultry can be used in a meal with vegetables.</main>'}));
let checks=0;const pass=(message:string)=>{checks++;console.log('PASS '+message);};
try{
  const audience=queryFor(input,'customer_interest'),channel=queryFor(input,'channel','instagram'),season=queryFor(input,'seasonal');
  assert.match(audience,/chicken poultry.*healthy eating.*consumer needs survey Australia/);
  assert.doesNotMatch(audience,/Fillet|RSPCA|jane|PRIVATE|example/);
  assert.match(channel,/Instagram Reels food retail creative best practices/);assert.doesNotMatch(channel,/chicken|2026|AU/);
  assert.match(season,/November/);assert.doesNotMatch(season,/\b11\b|2026|seasonal adjustment/);
  assert.match(queryFor(input,'current_market'),/Coles RSPCA Approved Chicken Breast Fillet/);
  const drink={...input,campaign:{...campaign,product:'Iced Coffee Drink',category:'Beverages'}};
  assert.doesNotMatch(queryFor(drink,'customer_interest'),/fruit juice/);
  const footwear={...input,campaign:{...campaign,product:'Running Shoes',category:'Footwear',targetAudience:'Health-conscious runners'}};
  assert.doesNotMatch(queryFor(footwear,'customer_interest'),/healthy eating|meal/);
  pass('exact SKU substantiation, broad audience needs, named month and platform questions differ intentionally');
  const explicit=queryFor({...input,args:{query:'site:eatforhealth.gov.au "lean meats" -supplement'}},'customer_interest');
  assert.equal(explicit,'site:eatforhealth.gov.au "lean meats" -supplement Australia');
  assert.doesNotMatch(queryFor({...input,args:{query:'site:example.org token=PRIVATE_KEY jane@example.com poultry'}},'customer_interest'),/PRIVATE_KEY|jane@example/);
  const replacement=replacementQueryFor(input,'purchase_preference');
  assert.notEqual(replacement,queryFor(input,'purchase_preference'));
  assert.equal(queryFor({...input,args:{query:replacement}},'purchase_preference'),replacement);
  pass('explicit operators survive refinement; replacement questions differ without duplicating geography or private inputs');
  const source='https://www.eatforhealth.gov.au/food-essentials/five-food-groups/lean-meats-and-poultry-fish-eggs-tofu-nuts-and-seeds-and-legumesbeans';
  assert.equal(publicSourceUrl(source),source);
  assert.equal(publicSourceUrl('https://research.example.org/report?id=123&utm_source=search&utm_medium=web#results'),'https://research.example.org/report?id=123');
  for(const url of ['https://research.example.org/report?access_token=private','https://research.example.org/report?signature=signed','https://research.example.org/report?email=jane@example.com','https://localhost/research','https://127.0.0.1/','https://metadata.google.internal/','http://example.org/'])assert.equal(publicSourceUrl(url),null,url);
  pass('useful public sources and report IDs are eligible; tracking anchors normalize and account URLs remain private');
  process.env.FIRECRAWL_API_KEY='SYNTHETIC_ONLY';process.env.TREND_PUBLIC_CACHE_TTL_MS='0';
  globalThis.fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body));assert.equal(body.url,source);return Response.json({data:{markdown:'SYNTHETIC original poultry food group guidance.',metadata:{sourceURL:source}},creditsUsed:1});};
  const read=await tool('web.scrape_page').run({...input,args:{url:source,category:'customer_interest',question:'How can poultry fit in a balanced meal?'}});
  assert.equal(read.status,'ok');assert.equal(read.evidence[0].sourceRef,source);assert.equal(read.evidence[0].observedAt,null);
  delete process.env.FIRECRAWL_API_KEY;
  const direct=await tool('web.scrape_page').run({...input,args:{url:source,category:'customer_interest'}});
  assert.equal(direct.status,'ok');assert.match(direct.evidence[0].detail,/poultry/);
  pass('previously blocked original reaches both existing extraction paths with its provenance and unknown date intact');
  const original='https://research.example.org/poultry',resolved='https://www.example.org/research/poultry?id=7';
  let seen:string[]=[];
  const restoreRedirect=installPublicPageFixture(url=>{seen.push(url);return url===original?{text:'',location:resolved}:{text:'<main>SYNTHETIC canonical poultry research.</main>'};});
  try{
    const redirected=await tool('web.scrape_page').run({...input,args:{url:original,category:'customer_interest'}});
    assert.equal(redirected.status,'ok');assert.equal(redirected.evidence[0].sourceRef,resolved);assert.deepEqual(seen,[original,resolved]);
  }finally{restoreRedirect();}
  for(const destination of ['https://127.0.0.1/private','https://research.example.org/private?token=secret','http://research.example.org/insecure']){
    seen=[];const restorePrivateRedirect=installPublicPageFixture(url=>{seen.push(url);return {text:'',location:destination};});
    try{assert.notEqual((await tool('web.scrape_page').run({...input,args:{url:original,category:'customer_interest'}})).status,'ok');assert.deepEqual(seen,[original]);}finally{restorePrivateRedirect();}
  }
  process.env.FIRECRAWL_API_KEY='SYNTHETIC_ONLY';
  globalThis.fetch=async()=>Response.json({data:{markdown:'SYNTHETIC canonical poultry original.',metadata:{sourceURL:resolved}}});
  const extractedRedirect=await tool('web.scrape_page').run({...input,args:{url:original,category:'customer_interest'}});
  assert.equal(extractedRedirect.status,'ok');assert.equal(extractedRedirect.evidence[0].sourceRef,resolved);
  globalThis.fetch=async()=>Response.json({data:{markdown:'SYNTHETIC private response.',metadata:{sourceURL:'https://127.0.0.1/private'}}});
  assert.notEqual((await tool('web.scrape_page').run({...input,args:{url:original,category:'customer_interest'}})).status,'ok');
  pass('public redirects preserve resolved provenance; private, credential and insecure redirects never become sources');
  const candidate=(id:string,detail:string,url:string):Evidence=>({...read.evidence[0],id,detail,sourceRef:url,research:{...read.evidence[0].research!,category:'seasonal',quality:'snippet'}});
  const irrelevant=candidate('irrelevant','SYNTHETIC November seasonal adjustment methodology for household statistics.','https://www.abs.gov.au/methodology/seasonal-adjustment');
  const relevant=candidate('relevant','SYNTHETIC November chicken meal recipes for seasonal eating in Australia.','https://recipes.example.org/chicken-november');
  assert.equal(replacementSource([irrelevant,relevant],input,'seasonal')?.id,'relevant');
  const previouslyRead={...relevant,research:{...relevant.research!,quality:'unassessed' as const}};
  assert.equal(replacementSource([irrelevant,relevant],{...input,campaign:{...campaign,evidence:[previouslyRead]}},'seasonal'),undefined);
  pass('replacement selects a relevant original instead of the first result and does not buy a duplicate page read');
  process.env.FIRECRAWL_API_KEY='SYNTHETIC_ONLY';process.env.SERPAPI_API_KEY='SYNTHETIC_ONLY';process.env.TREND_PUBLIC_CACHE_TTL_MS='60000';clearPublicResearchCache();
  let calls=0;globalThis.fetch=async(url)=>{calls++;return String(url).includes('serpapi')?Response.json({interest_over_time:{timeline_data:[{date:'Oct 18 – 24, 2026',values:[{extracted_value:62}]}]}}):Response.json({data:{web:[{url:source,description:'SYNTHETIC public poultry guidance.'}]}});};
  await tool('web.search').run({...input,args:{category:'customer_interest'}});
  await tool('web.search').run({...input,args:{category:'customer_interest'}});assert.equal(calls,1);
  await tool('web.search').run({...input,campaign:{...campaign,targetAudience:'Busy people who value convenience'},args:{category:'customer_interest'}});assert.equal(calls,2);
  await tool('web.search_trends').run({...input,args:{kind:'TIMESERIES'}});
  await tool('web.search_trends').run({...input,args:{kind:'TIMESERIES'}});assert.equal(calls,3);
  await tool('web.search_trends').run({...input,at:'2026-10-27T09:14:15Z',args:{kind:'TIMESERIES'}});assert.equal(calls,4);
  pass('cache shares equivalent public questions but distinguishes audience need queries and Trends as-of dates');
  console.log(`${checks} discovery regression groups passed; all provider responses are synthetic.`);
}finally{restorePublicPage();globalThis.fetch=originalFetch;process.env=originalEnv;clearPublicResearchCache();}
