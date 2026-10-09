import { tick,cleanupExpired } from '../src/lib/worker';
import { pool } from '../src/lib/db';
let stopping=false;
process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
async function main(){
  console.log('PoC worker started (no image/key/payload logging)');
  let lastCleanup=0;
  while(!stopping){
    try{if(Date.now()-lastCleanup>60_000){await cleanupExpired();lastCleanup=Date.now();}await tick();}
    catch{console.error('WORKER_DB_OR_STORAGE_ERROR: DBとローカル保存領域を確認してください');}
    await new Promise(r=>setTimeout(r,1000));
  }
  await pool.end();
}
main().catch(()=>{process.exitCode=1;});
