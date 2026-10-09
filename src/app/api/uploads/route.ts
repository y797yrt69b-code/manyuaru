import { route,ok,readLimited } from '@/lib/http';
import { saveImage } from '@/lib/images';
import { fail } from '@/lib/contracts';
import { rateLimit } from '@/lib/rate-limit';
export const runtime='nodejs';
export async function POST(req:Request){return route(req,async()=>{
  rateLimit('uploads',60);
  const kind=new URL(req.url).searchParams.get('kind');
  if(kind!=='person'&&kind!=='garment')fail(422,'KIND_INVALID','画像の用途を指定してください');
  const mime=req.headers.get('content-type')?.split(';')[0];
  if(!['image/jpeg','image/png','image/webp'].includes(mime??''))fail(422,'IMAGE_FORMAT','JPEG・PNG・WebPを使ってください。HEICはJPEGに書き出してください');
  return ok(await saveImage(await readLimited(req,10*1024*1024),kind,mime),201);
});}
