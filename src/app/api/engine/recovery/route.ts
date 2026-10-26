import {NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth/current';
import {recoveryStatus} from '@/lib/trend/persistence';
export const runtime='nodejs';
export async function GET(request:Request){
 const user=await getCurrentUser();if(!user)return NextResponse.json({error:'Sign in first.'},{status:401});
 const id=new URL(request.url).searchParams.get('campaignId');
 if(!id||!/^[a-zA-Z0-9_-]{1,150}$/.test(id))return NextResponse.json({error:'Invalid campaign.'},{status:400});
 try{return NextResponse.json(await recoveryStatus(user.id,id));}
 catch{return NextResponse.json({error:'Recovery storage is temporarily unavailable.'},{status:503});}
}
