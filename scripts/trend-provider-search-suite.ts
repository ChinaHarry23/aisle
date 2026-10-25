import assert from 'node:assert/strict';
import { runComplete } from '../src/lib/llm/metered-complete';
import { searchWithModel } from '../src/lib/llm/search';
const fetchBefore=globalThis.fetch, keyBefore=process.env.OPENAI_API_KEY;
const billing={kind:'unmetered' as const,reason:'offline fixtures only'};
try {
 process.env.OPENAI_API_KEY='fixture-not-a-key';
 let calls=0;
 globalThis.fetch=async(_url,init)=>{
  calls++;
  const body=JSON.parse(String(init?.body));
  assert.equal(body.tool_choice,'required');assert.equal(body.max_tool_calls,1);
  assert.deepEqual(body.tools[0].filters.allowed_domains,['abs.gov.au']);
  assert.deepEqual(body.include,['web_search_call.action.sources']);
  return Response.json({output:[{type:'web_search_call',action:{sources:[{url:'https://www.abs.gov.au/statistics',title:'ABS statistics'}]}},{type:'message',content:[{text:'Generated prose must not become a source excerpt.'}]}],usage:{input_tokens:10,output_tokens:10}});
 };
 const found=await searchWithModel('openai:gpt-6-luna','Public fixture query',billing,0.05,['abs.gov.au']);
 assert.equal(found.citations.length,1);assert.equal(found.citations[0].snippet,'');assert.equal(calls,1);
 console.log('PASS required bounded search returns source candidates independently of generated prose');
 globalThis.fetch=async()=>{calls++;return Response.json({error:{message:'web_search filters unsupported'}},{status:400});};
 const failed=await searchWithModel('openai:gpt-6-luna','Public fixture query',billing,0.05,['abs.gov.au']);
 assert.equal(failed.status,'error');assert.equal(calls,2);
 console.log('PASS unsupported domain filtering fails closed without unfiltered legacy retry');
 delete process.env.OPENAI_API_KEY;
 const missing=await searchWithModel('openai:gpt-6-luna','Public fixture query',billing,0.05,['abs.gov.au']);
 assert.equal(missing.status,'skipped');assert.equal(missing.costUsd,0);assert.equal(calls,2);
 console.log('PASS missing credential performs no request or charge');
 process.env.OPENAI_API_KEY='fixture-not-a-key';
 let round=0;
 globalThis.fetch=async(_url,init)=>{
  round++;
  const body=JSON.parse(String(init?.body));
  assert.equal(body.tools[0].function.name,round===1?'web_2e_search':'web_2e_scrape_page');
  if(round===1)assert.equal(body.tool_choice,'required');
  if(round===2){
   assert.equal(body.messages.find((m: {role:string})=>m.role==='assistant').tool_calls[0].function.name,'web_2e_search');
   assert.equal(body.messages.find((m: {role:string})=>m.role==='tool').name,'web_2e_search');
  }
  return Response.json({choices:[{message:{content:round===2?'Done':null,...(round===1?{tool_calls:[{id:'call_1',function:{name:'web_2e_search',arguments:'{"query":"public"}'}}]}:{})}}],usage:{prompt_tokens:20,completion_tokens:10}});
 };
 const req={agent:'trend' as const,modelId:'openai:gpt-6-luna',prompt:'Public fixture',toolChoice:'required' as const,tools:[{name:'web.search',description:'search',parameters:{type:'object',properties:{query:{type:'string'}}}}]};
 const first=await runComplete(req,billing);
 assert.equal(first.status,'ok');assert.equal(first.toolCalls?.[0].name,'web.search');
 const second=await runComplete({...req,toolChoice:'auto',tools:[{...req.tools[0],name:'web.scrape_page'}],history:[{role:'assistant',content:'',toolCalls:first.toolCalls},{role:'tool',name:'web.search',toolCallId:'call_1',content:'Public fixture result'}]},billing);
 assert.equal(second.status,'ok');assert.equal(round,2);
 console.log('PASS provider aliases round-trip across calls and tool-result history');

} finally {globalThis.fetch=fetchBefore;if(keyBefore===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=keyBefore;}
