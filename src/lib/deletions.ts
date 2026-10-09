import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { tx,OWNER } from './db';
import { dataDir } from './images';
export async function queueFileDeletions(db:PoolClient,paths:string[]){
  for(const path of paths){
    if(!new RegExp(`^${OWNER}/[0-9a-f-]{36}\\.jpg$`).test(path))throw new Error('STORAGE_PATH_INVALID');
    await db.query('insert into poc.deletion_files(id,owner_id,path) values($1,$2,$3) on conflict(owner_id,path) do nothing',[randomUUID(),OWNER,path]);
  }
}
export async function flushFileDeletions(){
  const paths=await tx(async db=>(await db.query('select id,path from poc.deletion_files order by created_at limit 500')).rows);
  for(const row of paths){
    await unlink(join(dataDir,row.path)).catch(e=>{if(e.code!=='ENOENT')throw e;});
    await tx(db=>db.query('delete from poc.deletion_files where id=$1',[row.id]));
  }
}
