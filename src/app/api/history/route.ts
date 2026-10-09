import { route,ok } from '@/lib/http';
import { listJobs } from '@/lib/jobs';
export const runtime='nodejs';
export async function GET(req:Request){return route(req,async()=>ok(await listJobs()));}
