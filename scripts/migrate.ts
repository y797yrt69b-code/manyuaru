import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
for (const file of readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql')).sort()) {
  const check=spawnSync('docker',['exec','manyuaru-poc-db','psql','-U','postgres','-d','tryon','-tAc',"select to_regclass('poc.tryon_jobs') is not null"],{encoding:'utf8'});
  if(check.status!==0) throw new Error('DB接続失敗');
  if(file==='001_phase_a.sql'&&check.stdout.trim()==='t') { console.log('001 適用済み（再実行では変更しません）'); continue; }
  const p=spawnSync('docker',['exec','-i','manyuaru-poc-db','psql','-U','postgres','-d','tryon','-v','ON_ERROR_STOP=1','--single-transaction'],{input:readFileSync(`supabase/migrations/${file}`),stdio:['pipe','inherit','inherit']});
  if(p.status!==0) process.exit(p.status??1);
}
