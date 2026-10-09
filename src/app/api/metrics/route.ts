import { route,ok } from '@/lib/http';
import { tx } from '@/lib/db';
import { summarize } from '@/lib/evaluation';
export const runtime='nodejs';
export async function GET(req:Request){return route(req,async()=>{
  const metrics=await tx(async db=>{
    const feedback=(await db.query(`select f.*,j.provider from poc.feedback f join poc.tryon_jobs j on j.id=f.job_id where j.deleted_at is null`)).rows;
    const byProvider=(await db.query(`select j.provider,count(*)::int as total,count(*) filter(where state='succeeded')::int as succeeded,
      count(*) filter(where state='failed')::int as failed,count(*) filter(where state='reconciling')::int as reconciling,
      count(*) filter(where state='cancelled')::int as cancelled,
      coalesce(sum(c.actual_jpy) filter(where c.status='settled'),0)::int as known_actual_jpy,
      coalesce(sum(c.max_jpy) filter(where c.status in ('reserved','unknown')),0)::int as held_max_jpy,
      count(*) filter(where c.status='unknown')::int as unknown_cost_count,
      percentile_cont(0.95) within group(order by extract(epoch from(j.finished_at-j.created_at))) filter(where j.state='succeeded') as success_wait_p95_seconds
      from poc.tryon_jobs j join poc.cost_reservations c on c.job_id=j.id group by j.provider`)).rows;
    return {evaluation:summarize(feedback),byProvider,note:'mockは品質・実費検証から除外。削除後も写真を含まない試行・費用は集計。成功待ち時間p95は完了分のみ、結果不明は別件数。'};
  });return ok(metrics);
});}
