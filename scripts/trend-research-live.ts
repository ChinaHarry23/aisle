/** Free public-source probe only. Never calls an LLM or credentialed research API. */
import { writeFileSync } from 'node:fs';
import { blankCampaign, defaultBrand } from '../src/lib/seed';
import { defaultSettings } from '../src/lib/settings';
import { researchTools } from '../src/lib/trend/source-tools';
const now=new Date().toISOString();
const campaign=blankCampaign({name:'TA-03 public-source probe',product:'Rain jacket',category:'Apparel',targetAudience:'Adults',objective:'Awareness',budget:1000,channels:['web'],startDate:'2026-10-20',endDate:'2026-10-26',country:'AU',notes:''},defaultBrand,null,defaultSettings());
const results=[];
for(const [name,args] of [['calendar.public_holidays',{year:'2026'}],['web.historical_weather',{}],['stats.abs_spending',{mode:'metadata',flow:'',key:''}]] as [string,Record<string,string>][]){
 const outcome=await researchTools.find(t=>t.name===name)!.run({campaign,brand:defaultBrand,at:now,args});
 results.push({name,args,status:outcome.status,summary:outcome.summary,evidence:outcome.evidence,...(name==='stats.abs_spending'?{metadata:outcome.data}: {})});
 console.log(`${name}: ${outcome.status} — ${outcome.summary}`);
}
writeFileSync('docs/TA-03-PUBLIC-SOURCE-PROBE.json',JSON.stringify({at:now,mode:'LIVE PUBLIC DATA ONLY. No LLM and no paid API. Weather is optional context, not demand evidence.',results},null,2)+'\n');
