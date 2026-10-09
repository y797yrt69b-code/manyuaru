import { randomUUID } from 'node:crypto';
import { tx,OWNER } from './db';
import { tokyoPeriod,type ProviderId,type TryonInput } from './contracts';
import { integer } from './config';
import { getProvider } from './providers';
import { saveImage } from './images';
import { queueFileDeletions,flushFileDeletions } from './deletions';
type Job={id:string;provider:ProviderId;inputs:TryonInput;prompt:string;external_id:string|null;submit_started_at:Date|null;started_at:Date;deleted_at:Date|null;approval_id:string|null};
export async function tick(){
  const job=await tx(async db=>{
    await db.query('select pg_advisory_xact_lock(797797)');
    // Expired send lease with no external ID is ambiguous; NEVER resubmit.
    await db.query(`update poc.tryon_jobs set state=case when provider='mock' then 'failed' else 'reconciling' end,error_code='WORKER_INTERRUPTED'
      where state='running' and external_id is null and submit_started_at is not null and lease_until<now()`);
    await db.query(`update poc.cost_reservations c set status='released' from poc.tryon_jobs j where c.job_id=j.id and j.state='failed' and j.provider='mock' and c.status='reserved'`);
    await db.query(`update poc.cost_reservations c set status='unknown' from poc.tryon_jobs j where c.job_id=j.id and j.state='reconciling' and j.provider<>'mock' and c.status='reserved'`);
    const row=(await db.query(`select * from poc.tryon_jobs where
      (state='queued' and deleted_at is null) or (state in ('running','reconciling') and external_id is not null and (lease_until is null or lease_until<now()))
      order by created_at for update skip locked limit 1`)).rows[0] as Job|undefined;
    if(!row)return null;
    await db.query("update poc.tryon_jobs set state=case when state='queued' then 'running' else state end,started_at=coalesce(started_at,now()),lease_until=now()+interval '120 seconds' where id=$1",[row.id]);
    return row;
  });
  if(!job)return false;
  const provider=getProvider(job.provider);
  try{
    if(!job.external_id){
      // Shutdown and config changes checked again immediately before network submission.
      if(process.env.GENERATIONS_ENABLED==='false')throw new Error('GENERATION_STOPPED');
      provider.validateInputs(job.inputs);
      if(job.provider!=='mock'){
        if(job.approval_id!==process.env.LIVE_APPROVAL_ID)throw new Error('APPROVAL_CHANGED');
        const reserve=await tx(async db=>(await db.query('select max_jpy from poc.cost_reservations where job_id=$1',[job.id])).rows[0]);
        if(provider.estimateMaxCost()>reserve.max_jpy)throw new Error('PRICE_CHANGED');
      }
      const send=await tx(async db=>{
        const row=(await db.query('select deleted_at from poc.tryon_jobs where id=$1 for update',[job.id])).rows[0];
        if(row.deleted_at)return false;
        await db.query('update poc.tryon_jobs set submit_started_at=now() where id=$1',[job.id]);
        await db.query('update poc.cost_reservations set period=$2 where job_id=$1',[job.id,tokyoPeriod()]);
        await db.query("update poc.generation_attempts set started_at=now(),billing=$2 where job_id=$1",[job.id,job.provider==='mock'?'mock_free':'unknown']);
        return true;
      });
      if(!send)return true;
      job.submit_started_at=new Date();
      job.external_id=await provider.submit(job.inputs,job.prompt);
      await tx(async db=>{
        await db.query('update poc.tryon_jobs set external_id=$2 where id=$1',[job.id,job.external_id]);
        await db.query('update poc.generation_attempts set external_id=$2 where job_id=$1',[job.id,job.external_id]);
      });
    }
    // Deleted jobs are never resubmitted. Cancellation is best effort; costs held.
    const deleted=await tx(async db=>(await db.query('select deleted_at from poc.tryon_jobs where id=$1',[job.id])).rows[0]?.deleted_at);
    if(deleted){
      await provider.cancel(job.external_id);
      await tx(async db=>{
        await db.query("update poc.tryon_jobs set state='cancelled',finished_at=now(),lease_until=null where id=$1",[job.id]);
        await db.query("update poc.cost_reservations set status=$2,actual_jpy=$3 where job_id=$1",[job.id,job.provider==='mock'?'settled':'unknown',job.provider==='mock'?0:null]);
      });
      return true;
    }
    const status=await provider.getStatus(job.external_id,job.inputs);
    if(status.state==='pending'){
      await tx(db=>db.query(`update poc.tryon_jobs set lease_until=now()+interval '2 seconds',
        state=case when started_at < now()-($2*interval '1 second') then 'reconciling' else state end,
        error_code=case when started_at < now()-($2*interval '1 second') then 'RESULT_TIMEOUT' else error_code end where id=$1`,[job.id,integer('JOB_TIMEOUT_SECONDS',180)]));
    }else if(status.state==='failed'){
      await endFailure(job,'PROVIDER_FAILED',true);
    }else{
      const image=await saveImage(status.image,'result');
      const discard=await tx(async db=>{
        const current=(await db.query('select deleted_at from poc.tryon_jobs where id=$1 for update',[job.id])).rows[0];
        if(current.deleted_at){
          await db.query('delete from poc.image_assets where id=$1',[image.id]);
          await queueFileDeletions(db,[`${OWNER}/${image.id}.jpg`]);
          await db.query("update poc.tryon_jobs set state='cancelled',finished_at=now(),lease_until=null where id=$1",[job.id]);
          await db.query("update poc.cost_reservations set status=$2,actual_jpy=$3 where job_id=$1",[job.id,job.provider==='mock'?'settled':'unknown',job.provider==='mock'?0:null]);
          return true;
        }
        await db.query('insert into poc.tryon_results(id,owner_id,job_id,image_id) values($1,$2,$3,$4)',[randomUUID(),OWNER,job.id,image.id]);
        await db.query("update poc.tryon_jobs set state='succeeded',finished_at=now(),lease_until=null where id=$1",[job.id]);
        await db.query('update poc.generation_attempts set finished_at=now() where job_id=$1',[job.id]);
        await db.query("update poc.cost_reservations set status=$2,actual_jpy=$3 where job_id=$1",[job.id,job.provider==='mock'?'settled':'unknown',job.provider==='mock'?0:null]);
        return false;
      });
      if(discard)await flushFileDeletions();
    }
  }catch(e){
    const sent=!!job.submit_started_at;
    const safe=e instanceof Error&&/^FAL_(HTTP_\d+|OUTPUT_HOST_UNVERIFIED|RESULT_INVALID|RESULT_SIZE|RESULT_DOWNLOAD|RESPONSE_SIZE)$/.test(e.message)?e.message:null;
    await endFailure(job,sent?(safe??'RESULT_UNKNOWN'):'PRE_SUBMIT_BLOCKED',sent);
  }
  return true;
}
async function endFailure(job:Job,code:string,sent:boolean){
  const ambiguous=sent&&job.provider!=='mock';
  await tx(async db=>{
    await db.query("update poc.tryon_jobs set state=$2,error_code=$3,finished_at=case when $2='failed' then now() else null end,lease_until=now()+interval '30 seconds' where id=$1",[job.id,ambiguous?'reconciling':'failed',code]);
    await db.query("update poc.cost_reservations set status=$2 where job_id=$1",[job.id,ambiguous?'unknown':'released']);
  });
}
export async function cleanupExpired(){
  await flushFileDeletions();
  const ids=await tx(async db=>(await db.query(`select distinct j.id from poc.tryon_jobs j where j.deleted_at is null and j.created_at<now()-interval '90 days'`)).rows);
  const {deleteJob}=await import('./jobs');
  for(const j of ids)await deleteJob(j.id);
  await tx(async db=>{
    const paths=(await db.query('delete from poc.image_assets where expires_at<now() returning path')).rows;
    await queueFileDeletions(db,paths.map(x=>x.path as string));
  });
  await flushFileDeletions();
}
