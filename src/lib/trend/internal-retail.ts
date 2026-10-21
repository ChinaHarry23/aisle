import { z } from 'zod';
import { parseCsv } from './source-tools';
import type { ToolOutcome } from '@/lib/runtime/tools';
import type { Campaign } from '@/lib/types';
import { uid } from '@/lib/ids';
import { unavailable } from './contracts';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s);
const row = z.object({sku:z.string().regex(/^[A-Za-z0-9_-]{1,60}$/),category:z.string().regex(/^[A-Za-z &-]{1,80}$/),week:day,units:z.number().finite().min(0).max(1e9)}).strict();
export const retailUploadSchema = z.object({sha256:z.string().regex(/^[a-f0-9]{64}$/), importedAt:z.string().datetime(), rows:z.array(row).min(1).max(10000)}).strict();
export type RetailUpload = z.infer<typeof retailUploadSchema>;

/** Accept only aggregate POS exports. Reject extra columns rather than retaining customer information. */
export async function importRetailCsv(csv: string, at: string): Promise<RetailUpload> {
  if (new TextEncoder().encode(csv).byteLength > 1_000_000) throw Error('CSV exceeds 1 MB.');
  const [headers, ...rows] = parseCsv(csv.replace(/^\uFEFF/, ''));
  if (headers?.join(',') !== 'sku,category,week,units') throw Error('Use exactly sku,category,week,units. Customer-level columns are not accepted.');
  return retailUploadSchema.parse({sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(csv))),b=>b.toString(16).padStart(2,'0')).join(''),importedAt:at,rows:rows.map(r => {
    if(r.length !== 4 || !r[3].trim()) throw Error('Each row needs four values.');
    return {sku:r[0],category:r[1],week:r[2],units:Number(r[3])};
  })});
}

export function internalRetailOutcome(campaign: Campaign, at: string): ToolOutcome {
  if(!campaign.internalDataAuthorised) return unavailable('Internal retail data is not authorised — skipped.', 'skipped');
  const parsed = retailUploadSchema.safeParse(campaign.retailUpload);
  if(!parsed.success) return unavailable('No valid aggregate CSV/POS export connected.');
  const upload=parsed.data;
  const rows=upload.rows.filter(r => r.category.toLowerCase() === campaign.category.toLowerCase() && r.week <= at.slice(0,10));
  if(!rows.length) return unavailable('No observed rows match the campaign category.');
  const weeks = new Map<string,number>();
  for(const r of rows) weeks.set(r.week,(weeks.get(r.week) ?? 0)+r.units);
  const measurements=[...weeks.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([week,units])=>({week,units}));
  const detail=JSON.stringify({category:campaign.category,measurements,limitation:'Uploaded aggregate units; not causal preference or representative market demand. No customer or SKU rows sent to the model.'});
  const evidence = {id:uid('ev'),claim:'Uploaded category sales observations',detail,sourceName:'Authorised aggregate POS CSV',sourceRef:`upload:sha256:${upload.sha256}`,sourceKind:'internal_retail' as const,observedAt:measurements.at(-1)!.week,fetchedAt:at,status:'verified' as const,confidence:0,raisedBy:'trend' as const,usedFor:'Category-level purchase observations',research:{category:'purchase_preference' as const,geography:campaign.country,queryScope:campaign.category,permission:'allowed' as const,quality:'unassessed' as const,dateBasis:'observation' as const,transformation:'Sum units by week for matching category; SKU/customer rows excluded.'}};
  return {status:'ok',summary:`Read ${rows.length} authorised aggregate rows across ${weeks.size} weeks.`,data:{measurements},evidence:[evidence]};
}
