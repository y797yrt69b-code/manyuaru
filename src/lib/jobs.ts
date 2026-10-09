import { createHash,randomUUID } from 'node:crypto';
import { tx,OWNER } from './db';
import { fail,inputSchema,tokyoPeriod,type ProviderId,type TryonInput } from './contracts';
import { getProvider,buildPrompt,PROMPT_VERSION } from './providers';
import { integer,providerId } from './config';
import { queueFileDeletions,flushFileDeletions } from './deletions';
export async function submitJob(raw:unknown){
  const input=inputSchema.parse(raw),id=providerId(),provider=getProvider(id);
  const canonical={...input,items:[...input.items].sort((a,b)=>a.layer-b.layer),idempotencyKey:undefined};
  const hash=createHash('sha256').update(JSON.stringify({id,input:canonical})).digest('hex');
  return tx(async db=>{
    // One PoC operator, transaction-wide lock covers idempotency, counts AND money.
    await db.query('select pg_advisory_xact_lock(797797)');
    const existing=(await db.query('select id,input_hash from poc.tryon_jobs where idempotency_key=$1',[input.idempotencyKey])).rows[0];
    if(existing){if(existing.input_hash!==hash)fail(409,'IDEMPOTENCY_CONFLICT','同じ送信キーで入力が変わっています');return {jobId:existing.id,reused:true};}
    if(id!=='mock'){
      const pending=(await db.query("select id from poc.tryon_jobs where input_hash=$1 and state in ('queued','running','reconciling')",[hash])).rows[0];
      if(pending)fail(409,'LIVE_INPUT_PENDING','同じ入力の実APIが未完了・照合待ちです。履歴を確認し、課金結果が分かるまで新規送信しないでください');
    }
    if(process.env.GENERATIONS_ENABLED==='false')fail(503,'GENERATION_STOPPED','生成は運営者が停止中です');
    provider.validateInputs(input);
    const ids=[input.personId,...input.items.map(x=>x.assetId)];
    const assets=(await db.query('select id,kind from poc.image_assets where id=any($1::uuid[]) and expires_at>now()', [ids])).rows;
    if(assets.length!==ids.length||!assets.some(x=>x.id===input.personId&&x.kind==='person')||input.items.some(x=>!assets.some(a=>a.id===x.assetId&&a.kind==='garment')))
      fail(404,'INPUT_NOT_FOUND','本人写真・服画像を再登録してください');
    const max=provider.estimateMaxCost(),period=tokyoPeriod();
    if(id!=='mock'){
      const used=(await db.query(`select count(*)::int as calls,coalesce(sum(case when c.status='released' then 0 when c.status='settled' then c.actual_jpy else c.max_jpy end),0)::int as total,
        coalesce(sum(case when c.status in ('reserved','unknown') then c.max_jpy when c.period=$1 and c.status='settled' then c.actual_jpy else 0 end),0)::int as monthly
        from poc.cost_reservations c join poc.tryon_jobs j on j.id=c.job_id where j.provider<>'mock'`,[period])).rows[0];
      if(used.calls>=integer('LIVE_MAX_CALLS'))fail(429,'CALL_LIMIT','承認された実API件数の上限です');
      if(used.total+max>integer('LIVE_TOTAL_BUDGET_JPY')||used.monthly+max>integer('LIVE_MONTHLY_BUDGET_JPY'))fail(429,'BUDGET_LIMIT','実費・未確定予約込みで予算上限を超えます');
    }
    const jobId=randomUUID();
    await db.query(`insert into poc.tryon_jobs(id,owner_id,idempotency_key,input_hash,provider,model,prompt_version,prompt,resolution,inputs,approval_id,consent_version)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[jobId,OWNER,input.idempotencyKey,hash,id,provider.capabilities.model,PROMPT_VERSION,buildPrompt(input),id==='fal-nano'?'1K':'input-max-2048',JSON.stringify(input),id==='mock'?null:process.env.LIVE_APPROVAL_ID,id==='mock'?'local-poc-v1':input.liveConsentVersion]);
    await db.query(`insert into poc.cost_reservations(id,job_id,owner_id,period,max_jpy,status,usd_jpy,unit_usd,price_checked_at) values($1,$2,$3,$4,$5,'reserved',$6,$7,$8)`,[randomUUID(),jobId,OWNER,period,max,id==='mock'?null:process.env.LIVE_USD_JPY,id==='mock'?null:process.env.LIVE_PRICE_USD,id==='mock'?null:process.env.LIVE_PRICE_CHECKED_AT]);
    await db.query('insert into poc.generation_attempts(id,job_id,owner_id) values($1,$2,$3)',[randomUUID(),jobId,OWNER]);
    return {jobId,reused:false};
  });
}
export async function getJob(id:string){
  return tx(async db=>{
    const row=(await db.query(`select j.id,j.state,j.provider,j.model,j.prompt_version,j.resolution,j.inputs,j.error_code,j.created_at,j.started_at,j.finished_at,
      c.max_jpy,c.actual_jpy,c.status as cost_status,c.currency,c.period,c.usd_jpy,c.unit_usd,c.price_checked_at,r.image_id,f.id as feedback_id
      from poc.tryon_jobs j join poc.cost_reservations c on c.job_id=j.id
      left join poc.tryon_results r on r.job_id=j.id left join poc.feedback f on f.job_id=j.id where j.id=$1 and j.deleted_at is null`,[id])).rows[0];
    if(!row)fail(404,'JOB_NOT_FOUND','履歴が見つかりません');return row;
  });
}
export async function deleteJob(id:string){
  await tx(async db=>{
    await db.query('select pg_advisory_xact_lock(797797)');
    const job=(await db.query('select * from poc.tryon_jobs where id=$1 for update',[id])).rows[0];
    if(!job)fail(404,'JOB_NOT_FOUND','履歴が見つかりません');
    const state=job.state==='queued'?'cancelled':job.state==='running'?'reconciling':job.state;
    await db.query("update poc.tryon_jobs set deleted_at=now(),inputs='{}'::jsonb,prompt='',state=$2 where id=$1",[id,state]);
    if(job.state==='queued')await db.query("update poc.cost_reservations set status='released' where job_id=$1",[id]);
    await db.query('delete from poc.feedback where job_id=$1',[id]);
    const inputs=job.inputs as TryonInput;
    const assetIds=[inputs.personId,...(inputs.items??[]).map(x=>x.assetId)].filter(Boolean);
    const result=(await db.query('select image_id from poc.tryon_results where job_id=$1',[id])).rows;
    assetIds.push(...result.map(x=>x.image_id));
    await db.query('delete from poc.tryon_results where job_id=$1',[id]);
    // Shared inputs are retained only when another nondeleted job needs them.
    const removable=(await db.query(`delete from poc.image_assets a where a.id=any($1::uuid[]) and not exists(
      select from poc.tryon_jobs j where j.deleted_at is null and (j.inputs->>'personId'=a.id::text or exists(select from jsonb_array_elements(coalesce(j.inputs->'items','[]'::jsonb)) i where i->>'assetId'=a.id::text))) returning path`,[assetIds])).rows;
    const paths=removable.map(x=>x.path as string);
    await queueFileDeletions(db,paths);
    return paths;
  });
  await flushFileDeletions();
  return {deleted:true,note:'入力・結果・評価を削除しました。共有中の入力と写真を含まない費用記録は残ります。外部AIの削除は未確認です。'};
}
export async function listJobs(){
  const ids=await tx(async db=>(await db.query('select id from poc.tryon_jobs where deleted_at is null order by created_at desc limit 100')).rows);
  return Promise.all(ids.map(x=>getJob(x.id)));
}
export async function cancelJob(id:string){
  return tx(async db=>{
    await db.query('select pg_advisory_xact_lock(797797)');
    const job=(await db.query('select state from poc.tryon_jobs where id=$1 and deleted_at is null for update',[id])).rows[0];
    if(!job)fail(404,'JOB_NOT_FOUND','履歴が見つかりません');
    if(job.state!=='queued')fail(409,'ALREADY_STARTED','開始済みです。停止・取消ができても課金なしとは保証できません');
    await db.query("update poc.tryon_jobs set state='cancelled',finished_at=now() where id=$1",[id]);
    await db.query("update poc.cost_reservations set status='released' where job_id=$1",[id]);
    return {cancelled:true};
  });
}
