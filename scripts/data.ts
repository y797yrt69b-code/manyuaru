import { spawnSync } from 'node:child_process';
import { mkdir,writeFile,readFile,cp,rm } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { z } from 'zod';
import { tx,pool } from '../src/lib/db';
import { dataDir } from '../src/lib/images';
import { deleteJob } from '../src/lib/jobs';
const command=process.argv[2];
function dockerSQL(sql:string){const p=spawnSync('docker',['exec','-i','manyuaru-poc-db','psql','-U','postgres','-d','tryon','-v','ON_ERROR_STOP=1','--single-transaction'],{input:sql,encoding:'utf8'});if(p.status!==0)throw new Error('DB操作失敗');}
function dumpHasLive(sql:string){
  const section=/COPY poc\.tryon_jobs \(([^)]+)\) FROM stdin;\n([\s\S]*?)\\\./.exec(sql);
  if(!section)throw new Error('ジョブ台帳を検査できないバックアップです');
  const column=section[1].split(', ').indexOf('provider');if(column<0)throw new Error('Provider列がありません');
  return section[2].split('\n').filter(Boolean).some(line=>line.split('\t')[column]!=='mock');
}
async function idle(){
  const n=await tx(async db=>(await db.query("select count(*)::int as n from poc.tryon_jobs where state in ('queued','running','reconciling') and deleted_at is null")).rows[0].n);
  if(n)throw new Error('未完了ジョブがあります。モックは処理/未開始取消、実APIは照合を先に行ってください。Webとworkerを止めて操作してください。');
}
async function main(){
  if(command==='backup'){
    await idle();const dir=resolve('.backups',new Date().toISOString().replaceAll(':','-'));await mkdir(dir,{recursive:true,mode:0o700});
    const dump=spawnSync('docker',['exec','manyuaru-poc-db','pg_dump','-U','postgres','-d','tryon','--schema=poc','--no-owner','--no-privileges'],{encoding:'utf8',maxBuffer:100*1024*1024});
    if(dump.status!==0)throw new Error('バックアップ失敗');
    await writeFile(join(dir,'db.sql'),dump.stdout,{mode:0o600});
    await cp(dataDir,join(dir,'images'),{recursive:true}).catch(e=>{if(e.code!=='ENOENT')throw e;});
    await writeFile(join(dir,'manifest.json'),JSON.stringify({version:1,createdAt:new Date().toISOString(),includesPhotos:true}),{mode:0o600});
    console.log(`バックアップ保存: ${dir}（秘密鍵は含みません。写真を含むため非公開で管理）`);
  }else if(command==='purge'){
    if(process.env.DELETE_ALL_POC!=='YES')throw new Error('停止後 DELETE_ALL_POC=YES npm run purge を実行してください。バックアップ写真も削除します。');
    const jobs=await tx(async db=>(await db.query('select id from poc.tryon_jobs where deleted_at is null')).rows);
    for(const job of jobs)await deleteJob(job.id);
    // Preserve minimal cost/attempt records so deleting photos cannot reset budgets.
    await tx(async db=>{await db.query('delete from poc.tryon_results');await db.query('delete from poc.feedback');await db.query('delete from poc.image_assets');});
    await rm(dataDir,{recursive:true,force:true});await rm(resolve('.backups'),{recursive:true,force:true});
    await tx(db=>db.query('delete from poc.deletion_files'));
    console.log('ローカル写真・評価・バックアップを削除。費用台帳は保持。外部AI・クラウドのスナップショットは別途削除確認が必要。');
  }else if(command==='restore'){
    if(process.env.RESTORE_POC!=='YES')throw new Error('停止後 RESTORE_POC=YES npm run restore -- .backups/<日時> を実行してください。');
    await idle();const dir=resolve(process.argv[3]??'');if(!dir.startsWith(resolve('.backups')+'/'))throw new Error('復旧元は.backupsの日時ディレクトリを指定してください');
    const manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));if(manifest.version!==1)throw new Error('バックアップ形式が不正');
    // Rolling back a live ledger could permit duplicate charges / erased reservations.
    const live=await tx(async db=>(await db.query("select count(*)::int as n from poc.tryon_jobs where provider<>'mock'")).rows[0].n);
    const sql=await readFile(join(dir,'db.sql'),'utf8');
    if(live||dumpHasLive(sql))throw new Error('実API履歴を含むDBの巻き戻しは禁止。照合台帳を保持する個別復旧が必要です。');
    dockerSQL('drop schema poc cascade;\n'+sql+'\ngrant usage on schema poc to poc_server;grant select,insert,update,delete on all tables in schema poc to poc_server;grant execute on all functions in schema poc to poc_server;');
    await rm(dataDir,{recursive:true,force:true});await cp(join(dir,'images'),dataDir,{recursive:true}).catch(e=>{if(e.code!=='ENOENT')throw e;});
    console.log('モックDB・写真を復旧しました。npm run worker と npm run dev で確認してください。');
  }else if(command==='settle'){
    const id=z.uuid().parse(process.argv[3]),jpy=z.coerce.number().int().nonnegative().parse(process.argv[4]),evidence=process.argv[5];
    if(!evidence||evidence.length>300)throw new Error('請求確認根拠（画像や秘密値を含めない）を指定してください');
    await tx(async db=>{
      await db.query('select pg_advisory_xact_lock(797797)');
      const job=(await db.query('select provider,state from poc.tryon_jobs where id=$1 for update',[id])).rows[0];
      if(!job||job.provider==='mock'||job.state==='queued'||job.state==='running')throw new Error('実APIの完了・照合待ち履歴だけ確定できます');
      const prior=(await db.query('select status from poc.cost_reservations where job_id=$1',[id])).rows[0];
      if(prior.status==='settled')throw new Error('既に確定済みです。上書きせず別途監査してください');
      await db.query("update poc.cost_reservations set actual_jpy=$2,status='settled',evidence=$3 where job_id=$1",[id,jpy,evidence]);
      await db.query("update poc.generation_attempts set billing='confirmed',finished_at=coalesce(finished_at,now()) where job_id=$1",[id]);
    });console.log('請求実費を記録しました。画像結果不明の状態は変更しません。');
  }else throw new Error('backup/purge/restore/settle を指定してください');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool.end());
