import { randomUUID } from 'node:crypto';
import { route,ok,json } from '@/lib/http';
import { feedbackSchema,fail } from '@/lib/contracts';
import { tx,OWNER } from '@/lib/db';
export const runtime='nodejs';
export async function POST(req:Request){return route(req,async()=>{
  const f=feedbackSchema.parse(await json(req));
  await tx(async db=>{
    const job=(await db.query('select state,deleted_at from poc.tryon_jobs where id=$1 for update',[f.jobId])).rows[0];
    if(!job||job.deleted_at)fail(404,'JOB_NOT_FOUND','対象が見つかりません');
    if(job.state!=='succeeded')fail(409,'RESULT_NOT_READY','成功した結果を評価してください');
    const conflict=(await db.query('select case_id,split from poc.feedback where job_id=$1',[f.jobId])).rows[0];
    if(conflict&&(conflict.case_id!==f.caseId||conflict.split!==f.split))fail(409,'EVALUATION_SET_LOCKED','評価ケース・調整/最終区分は保存後に変更できません');
    await db.query(`insert into poc.feedback(id,owner_id,job_id,identity_score,garment_score,natural_score,helpful,major_missing,tags,comment,case_id,split,evaluator)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict(job_id) do update set
      identity_score=excluded.identity_score,garment_score=excluded.garment_score,natural_score=excluded.natural_score,helpful=excluded.helpful,
      major_missing=excluded.major_missing,tags=excluded.tags,comment=excluded.comment,evaluator=excluded.evaluator`,
      [randomUUID(),OWNER,f.jobId,f.identity,f.garment,f.natural,f.helpful,f.majorMissing,f.tags,f.comment,f.caseId,f.split,f.evaluator]);
  });return ok({saved:true});
});}
