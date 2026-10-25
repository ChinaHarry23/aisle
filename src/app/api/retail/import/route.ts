import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current';
import { importRetailCsv } from '@/lib/trend/internal-retail';
export const runtime='nodejs';
export async function POST(request: Request) {
  if(!await getCurrentUser()) return NextResponse.json({error:'Sign in first.'},{status:401});
  if(Number(request.headers.get('content-length') ?? 0)>1_100_000) return NextResponse.json({error:'CSV exceeds 1 MB.'},{status:413});
  const form=await request.formData().catch(()=>null);
  if(form?.get('authorised')!=='true') return NextResponse.json({error:'Explicit permission is required.'},{status:403});
  const file=form.get('file');
  if(!(file instanceof File)||file.size>1_000_000) return NextResponse.json({error:'Choose an aggregate CSV under 1 MB.'},{status:400});
  try {return NextResponse.json({upload:await importRetailCsv(await file.text(),new Date().toISOString())});}
  catch {return NextResponse.json({error:'Invalid aggregate CSV. Required columns: sku,category,week,units. Dates: YYYY-MM-DD; units: non-negative numbers; no personal-data columns.'},{status:422});}
}
