import { z } from 'zod';
import { route,ok } from '@/lib/http';
import { getJob,deleteJob,cancelJob } from '@/lib/jobs';
export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
export async function GET(req:Request,c:Context){return route(req,async()=>ok(await getJob(z.uuid().parse((await c.params).id))));}
export async function DELETE(req:Request,c:Context){return route(req,async()=>ok(await deleteJob(z.uuid().parse((await c.params).id))));}
export async function PATCH(req:Request,c:Context){return route(req,async()=>ok(await cancelJob(z.uuid().parse((await c.params).id))));}
