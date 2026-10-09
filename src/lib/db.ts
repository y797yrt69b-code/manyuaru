import { Pool, type PoolClient } from 'pg';
import { z } from 'zod';
const globalDb=globalThis as unknown as {pocPool?:Pool};
export const pool=globalDb.pocPool??new Pool({connectionString:process.env.DATABASE_URL,max:8});
globalDb.pocPool=pool;
export const OWNER=z.uuid().parse(process.env.POC_OWNER_ID??'11111111-1111-4111-8111-111111111111');
export async function tx<T>(fn:(db:PoolClient)=>Promise<T>,owner=OWNER):Promise<T> {
  const db=await pool.connect();
  try {
    await db.query('begin');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
    const result=await fn(db); await db.query('commit'); return result;
  } catch(e) {await db.query('rollback');throw e;} finally {db.release();}
}
