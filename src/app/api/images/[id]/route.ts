import { z } from 'zod';
import { route } from '@/lib/http';
import { imageBytes } from '@/lib/images';
export const runtime='nodejs';
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){return route(req,async()=>{
  const id=z.uuid().parse((await params).id);
  return new Response(new Uint8Array(await imageBytes(id)),{headers:{'Content-Type':'image/jpeg','Cache-Control':'no-store','Content-Disposition':'inline; filename="reference.jpg"'}});
});}
