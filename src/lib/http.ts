import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { PocError } from './contracts';
export function guard(req:Request){
  const url=new URL(req.url), host=req.headers.get('host')??url.host;
  if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) throw new PocError(403,'LOCAL_ONLY','Phase A はローカル専用です。公開しないでください');
  if(req.method!=='GET'&&req.method!=='HEAD'){
    if(req.headers.get('origin')!==`${url.protocol}//${host}`) throw new PocError(403,'ORIGIN_DENIED','同じ画面から操作してください');
  }
}
export async function route(req:Request,fn:()=>Promise<Response>):Promise<Response>{
  try{guard(req);return await fn();}
  catch(e){
    const known=e instanceof PocError; const invalid=e instanceof ZodError||e instanceof SyntaxError;
    return Response.json({data:null,error:known?e.message:invalid?'入力内容を確認してください':'処理できません。DB・ワーカーの起動状態を確認してください',code:known?e.code:invalid?'INVALID_INPUT':'INTERNAL_ERROR',requestId:randomUUID()},{status:known?e.status:invalid?422:500});
  }
}
export function ok(data:unknown,status=200){return Response.json({data,error:null,code:null,requestId:randomUUID()},{status,headers:{'Cache-Control':'no-store'}});}
export async function json(req:Request){
  if(!req.headers.get('content-type')?.startsWith('application/json')) throw new PocError(415,'CONTENT_TYPE','JSONで送信してください');
  const text=await readLimited(req,128*1024); return JSON.parse(text.toString('utf8'));
}
export async function readLimited(req:Request,limit:number){
  const chunks:Uint8Array[]=[];let size=0;
  const reader=req.body?.getReader();if(!reader)return Buffer.alloc(0);
  while(true){const v=await reader.read();if(v.done)break;size+=v.value.length;
    if(size>limit){await reader.cancel();throw new PocError(413,'TOO_LARGE','ファイル容量の上限を超えています');}chunks.push(v.value);
  }return Buffer.concat(chunks);
}
