import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
// Isolate tests from the operator's records. No real credentials or external calls.
process.env.POC_OWNER_ID=randomUUID();process.env.AI_PROVIDER='mock';process.env.GENERATIONS_ENABLED='true';
const {tx,pool,OWNER}=await import('../src/lib/db');
const {saveImage}=await import('../src/lib/images');
const {submitJob,getJob,deleteJob,cancelJob}=await import('../src/lib/jobs');
const {tick}=await import('../src/lib/worker');
const image=await sharp({create:{width:64,height:128,channels:3,background:'#aaa'}}).jpeg().toBuffer();
let passed=0;
async function test(name:string,fn:()=>Promise<void>){await fn();passed++;console.log(`PASS ${name}`);}
async function clear(){
  await tx(async db=>{await db.query('delete from poc.feedback');await db.query('delete from poc.tryon_results');await db.query('delete from poc.generation_attempts');await db.query('delete from poc.cost_reservations');await db.query('delete from poc.tryon_jobs');});
  const paths=await tx(async db=>(await db.query("delete from poc.image_assets where kind='result' returning path")).rows);
  const {unlink}=await import('node:fs/promises');const {join}=await import('node:path');const {dataDir}=await import('../src/lib/images');
  for(const p of paths)await unlink(join(dataDir,p.path)).catch(()=>{});
}
async function input(){const p=await saveImage(image,'person'),g=await saveImage(image,'garment');return {personId:p.id,items:[{assetId:g.id,category:'tops',layer:0}],idempotencyKey:randomUUID(),consent:true,layersConfirmed:true};}
function live(){Object.assign(process.env,{AI_PROVIDER:'fal-nano',LIVE_API_ENABLED:'true',LIVE_TERMS_REVIEWED:'true',LIVE_BUDGET_APPROVED:'true',FAL_KEY:'TEST-NOT-A-KEY',LIVE_CONSENT_VERSION:'test-only',LIVE_APPROVAL_ID:'test-only',LIVE_MAX_REFERENCE_IMAGES:'14',LIVE_MAX_CALLS:'10',LIVE_MAX_COST_JPY:'20',LIVE_TOTAL_BUDGET_JPY:'20',LIVE_MONTHLY_BUDGET_JPY:'20',LIVE_USD_JPY:'150',LIVE_PRICE_USD:'0.08',LIVE_PRICE_CHECKED_AT:'2026-10-09'});}
const actualFetch=globalThis.fetch;
try{
  const base=await input();
  await test('RLS: 所有者BはAの画像をSELECT/UPDATEできない、A所有のINSERTも拒否',async()=>{
    const other=randomUUID();
    assert.equal(await tx(async db=>(await db.query('select * from poc.image_assets where id=$1',[base.personId])).rowCount,other),0);
    assert.equal(await tx(async db=>(await db.query("update poc.image_assets set kind='garment' where id=$1",[base.personId])).rowCount,other),0);
    await assert.rejects(tx(db=>db.query('insert into poc.image_assets(id,owner_id,kind,path,width,height,bytes) values($1,$2,$3,$4,1,1,1)',[randomUUID(),OWNER,'person',randomUUID()]),other),/row-level security/);
    const role=await tx(async db=>(await db.query('select rolsuper,rolbypassrls from pg_roles where rolname=current_user')).rows[0]);assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);
  });
  await test('冪等: 同時6送信で1ジョブ・1予約、入力違いは409',async()=>{
    const jobs=await Promise.all(Array.from({length:6},()=>submitJob(base)));assert.equal(new Set(jobs.map(x=>x.jobId)).size,1);
    const count=await tx(async db=>(await db.query('select count(*)::int as n from poc.cost_reservations')).rows[0].n);assert.equal(count,1);
    await assert.rejects(submitJob({...base,items:[{...base.items[0],category:'outer'}]}),e=>(e as {status:number}).status===409);
    // Two competing workers must not both take the same queued job.
    await Promise.all([tick(),tick()]);assert.equal((await getJob(jobs[0].jobId)).state,'succeeded');
  });
  await test('モック成功費用0、未開始取消は解放、入力不足は拒否',async()=>{
    const j=(await tx(async db=>(await db.query('select id from poc.tryon_jobs limit 1')).rows))[0];assert.equal((await getJob(j.id)).actual_jpy,0);
    const queued=await submitJob({...base,idempotencyKey:randomUUID()});await cancelJob(queued.jobId);assert.equal((await getJob(queued.jobId)).cost_status,'released');
    await assert.rejects(submitJob({...base,personId:randomUUID(),idempotencyKey:randomUUID()}));
  });
  await clear();
  await test('予算競合: 20円枠・見積20円の同時受付で1件だけ成功',async()=>{
    live();const v={...base,liveConsentVersion:'test-only'};
    const results=await Promise.allSettled([submitJob({...v,idempotencyKey:randomUUID()}),submitJob({...v,items:[{...v.items[0],category:'outer'}],idempotencyKey:randomUUID()})]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected'&&x.reason.status===429).length,1);
    process.env.LIVE_TOTAL_BUDGET_JPY='100';
    await tx(db=>db.query("update poc.cost_reservations set period='2000-01'"));
    await assert.rejects(submitJob({...v,items:[{...v.items[0],category:'bottoms'}],idempotencyKey:randomUUID()}),e=>(e as {code:string}).code==='BUDGET_LIMIT');
  });
  await clear();
  await test('承認件数競合: 1件枠でも同時受付で1件だけ成功',async()=>{
    live();process.env.LIVE_TOTAL_BUDGET_JPY='100';process.env.LIVE_MONTHLY_BUDGET_JPY='100';process.env.LIVE_MAX_CALLS='1';
    const results=await Promise.allSettled([submitJob({...base,liveConsentVersion:'test-only',idempotencyKey:randomUUID()}),submitJob({...base,items:[{...base.items[0],category:'outer'}],liveConsentVersion:'test-only',idempotencyKey:randomUUID()})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected'&&x.reason.status===429).length,1);
  });
  await clear();
  await test('送信後通信断: 1POSTのみ、照合待ち・費用保留、再tickで再送しない',async()=>{
    live();const v=await submitJob({...base,liveConsentVersion:'test-only',idempotencyKey:randomUUID()});let calls=0;
    globalThis.fetch=async()=>{calls++;throw new Error('simulated lost response');};await tick();await tick();assert.equal(calls,1);
    const j=await getJob(v.jobId);assert.equal(j.state,'reconciling');assert.equal(j.cost_status,'unknown');assert.equal(j.actual_jpy,null);
    await assert.rejects(submitJob({...base,liveConsentVersion:'test-only',idempotencyKey:randomUUID()}),e=>(e as {code:string}).code==='LIVE_INPUT_PENDING');
  });
  await clear();
  await test('送信中ワーカー停止: リース切れでもPOSTを再送しない',async()=>{
    live();const v=await submitJob({...base,liveConsentVersion:'test-only',idempotencyKey:randomUUID()});
    await tx(db=>db.query("update poc.tryon_jobs set state='running',submit_started_at=now()-interval '1 hour',lease_until=now()-interval '1 hour' where id=$1",[v.jobId]));let calls=0;
    globalThis.fetch=async()=>{calls++;throw new Error('must not call');};await tick();assert.equal(calls,0);assert.equal((await getJob(v.jobId)).state,'reconciling');
  });
  await clear();
  await test('実API成功でも請求は未確定、履歴削除でも原価を消さない（HTTPモック）',async()=>{
    live();const v=await submitJob({...base,liveConsentVersion:'test-only',idempotencyKey:randomUUID()});let count=0;
    globalThis.fetch=async(_url,init)=>{count++;if(init?.method==='POST')return Response.json({request_id:'test-external'});if(String(_url).includes('/status'))return Response.json({status:'COMPLETED'});return Response.json({images:[{url:'data:image/jpeg;base64,'+image.toString('base64')}]});};
    await tick();const j=await getJob(v.jobId);assert.equal(j.state,'succeeded');assert.equal(j.cost_status,'unknown');assert.equal(j.actual_jpy,null);assert.equal(count,3);
    await deleteJob(v.jobId);await assert.rejects(getJob(v.jobId));
    const costs=await tx(async db=>(await db.query('select count(*)::int as n from poc.cost_reservations')).rows[0].n);assert.equal(costs,1);
    assert.equal(await tx(async db=>(await db.query('select count(*)::int as n from poc.tryon_results')).rows[0].n),0);
  });
  await clear();
  await test('削除中に後着した結果を保存しない（HTTPモック）',async()=>{
    live();const b=await input(),v=await submitJob({...b,liveConsentVersion:'test-only'});
    globalThis.fetch=async(url,init)=>{if(init?.method==='POST')return Response.json({request_id:'late-result'});if(String(url).includes('/status'))return Response.json({status:'COMPLETED'});await deleteJob(v.jobId);return Response.json({images:[{url:'data:image/jpeg;base64,'+image.toString('base64')}]});};
    await tick();assert.equal(await tx(async db=>(await db.query('select count(*)::int as n from poc.tryon_results')).rows[0].n),0);
    assert.equal(await tx(async db=>(await db.query("select count(*)::int as n from poc.image_assets where kind='result'")).rows[0].n),0);
  });
  await test('ファイル削除失敗はDBに残り、再試行で完了する',async()=>{
    const {queueFileDeletions,flushFileDeletions}=await import('../src/lib/deletions');
    const {mkdir,rm}=await import('node:fs/promises'),{join}=await import('node:path'),{dataDir}=await import('../src/lib/images');
    const path=`${OWNER}/${randomUUID()}.jpg`;await mkdir(join(dataDir,path),{recursive:true});
    await tx(db=>queueFileDeletions(db,[path]));await assert.rejects(flushFileDeletions());
    assert.equal(await tx(async db=>(await db.query('select count(*)::int as n from poc.deletion_files')).rows[0].n),1);
    await rm(join(dataDir,path),{recursive:true});await flushFileDeletions();
    assert.equal(await tx(async db=>(await db.query('select count(*)::int as n from poc.deletion_files')).rows[0].n),0);
  });
  console.log(`${passed} DB integration tests passed; external requests=0 (fetch stubbed for live tests).`);
}finally{
  globalThis.fetch=actualFetch;
  // Cleanup only this test owner's rows/files; other owners' rows remain protected.
  const paths=await tx(async db=>{await db.query('delete from poc.deletion_files');await db.query('delete from poc.feedback');await db.query('delete from poc.tryon_results');await db.query('delete from poc.generation_attempts');await db.query('delete from poc.cost_reservations');await db.query('delete from poc.tryon_jobs');return (await db.query('delete from poc.image_assets returning path')).rows;});
  const {unlink,rm}=await import('node:fs/promises');const {dataDir}=await import('../src/lib/images');const {join}=await import('node:path');
  for(const p of paths)await unlink(join(dataDir,p.path)).catch(()=>{});await rm(join(dataDir,OWNER),{recursive:true,force:true});await pool.end();
}
