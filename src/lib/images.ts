import sharp from 'sharp';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tx,OWNER } from './db';
import { fail } from './contracts';
// Runtime files are deliberately outside the Next build artifact.
export const dataDir=resolve(/* turbopackIgnore: true */process.env.POC_DATA_DIR??'.poc-data');
export async function normalizeImage(buffer:Buffer,expectedMime?:string){
  if(buffer.length>10*1024*1024)fail(413,'IMAGE_TOO_LARGE','画像は10MB以下にしてください');
  try{
    const image=sharp(buffer,{limitInputPixels:25_000_000,animated:false,failOn:'error'});
    const m=await image.metadata();
    if(expectedMime&&expectedMime!==`image/${m.format==='jpeg'?'jpeg':m.format}`)fail(422,'MIME_MISMATCH','宣言された形式と画像の実体が一致しません');
    if(!['jpeg','png','webp'].includes(m.format??'')||(m.pages??1)>1)fail(422,'IMAGE_FORMAT','JPEG・PNG・WebPの静止画を使ってください。HEICは写真アプリでJPEGに書き出してください');
    const {data,info}=await image.rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toBuffer({resolveWithObject:true});
    return {data,width:info.width,height:info.height};
  }catch(e){if(e instanceof Error&&'code' in e)throw e;fail(422,'IMAGE_INVALID','画像が壊れているか形式・画素数が非対応です');}
}
export async function saveImage(buffer:Buffer,kind:'person'|'garment'|'result',expectedMime?:string){
  const image=await normalizeImage(buffer,expectedMime),id=randomUUID(),path=`${OWNER}/${id}.jpg`;
  await mkdir(join(/* turbopackIgnore: true */dataDir,OWNER),{recursive:true,mode:0o700});
  await writeFile(join(/* turbopackIgnore: true */dataDir,path),image.data,{mode:0o600,flag:'wx'});
  try{await tx(db=>db.query('insert into poc.image_assets(id,owner_id,kind,path,width,height,bytes) values($1,$2,$3,$4,$5,$6,$7)',[id,OWNER,kind,path,image.width,image.height,image.data.length]));}
  catch(e){await unlink(join(dataDir,path));throw e;}
  return {id,kind,width:image.width,height:image.height};
}
export async function imageBytes(id:string){
  const asset=await tx(async db=>(await db.query('select path from poc.image_assets where id=$1 and expires_at>now()',[id])).rows[0]);
  if(!asset)fail(404,'IMAGE_NOT_FOUND','画像が見つかりません');
  return readFile(join(/* turbopackIgnore: true */dataDir,asset.path));
}
