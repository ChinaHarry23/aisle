/** Offline fixture for the DNS-guarded Node HTTPS transport. Never contacts a host. */
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
export function installPublicPageFixture(page:(url:string)=>{text:string;status?:number;contentType?:string;location?:string}) {
  const original=https.request;
  https.request=((_url:unknown,_options:unknown,receive:(response:IncomingMessage)=>void)=>{
    const request=new EventEmitter() as EventEmitter & {end:()=>void};
    request.end=()=>{const value=page(String(_url));const response=Readable.from([Buffer.from(value.text)]) as IncomingMessage;
      response.statusCode=value.status??(value.location?302:200);response.headers={'content-type':value.contentType??'text/html',...(value.location?{location:value.location}:{})};receive(response);};
    return request;
  }) as typeof https.request;
  return ()=>{https.request=original;};
}
