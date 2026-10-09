import { route,ok } from '@/lib/http';
import { tx } from '@/lib/db';
export const runtime='nodejs';
export async function GET(req:Request){return route(req,async()=>ok(await tx(async db=>(await db.query(`select j.id,j.provider,j.model,j.prompt_version,j.resolution,j.state,j.error_code,j.created_at,j.finished_at,
  extract(epoch from(j.finished_at-j.created_at)) as seconds,c.currency,c.max_jpy,c.actual_jpy,c.status as cost_status,c.usd_jpy,c.unit_usd,c.price_checked_at,
  f.case_id,f.split,f.evaluator,f.identity_score,f.garment_score,f.natural_score,f.helpful,f.major_missing,f.tags
  from poc.tryon_jobs j join poc.cost_reservations c on c.job_id=j.id left join poc.feedback f on f.job_id=j.id order by j.created_at`)).rows)));}
