import { route,ok,json } from '@/lib/http';
import { submitJob } from '@/lib/jobs';
import { rateLimit } from '@/lib/rate-limit';
export const runtime='nodejs';
export async function POST(req:Request){return route(req,async()=>{rateLimit('tryon',30);return ok(await submitJob(await json(req)),202);});}
