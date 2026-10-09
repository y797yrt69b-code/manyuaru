import { z } from 'zod';
export const categories=['tops','bottoms','outer','shoes','other'] as const;
export const inputSchema=z.object({
  personId:z.uuid(),
  items:z.array(z.object({assetId:z.uuid(),category:z.enum(categories),layer:z.number().int().min(0)})).min(1),
  idempotencyKey:z.uuid(),
  consent:z.literal(true), layersConfirmed:z.literal(true),
  liveConsentVersion:z.string().max(200).optional(),
}).strict().superRefine((v,ctx)=>{
  if(new Set(v.items.map(x=>x.assetId)).size!==v.items.length) ctx.addIssue({code:'custom',message:'同じ服画像を二重選択できません'});
  if(new Set(v.items.map(x=>x.layer)).size!==v.items.length) ctx.addIssue({code:'custom',message:'重ね順が重複しています'});
});
export type TryonInput=z.infer<typeof inputSchema>;
export type ProviderId='mock'|'fal-fashn'|'fal-nano';
export const feedbackSchema=z.object({
  jobId:z.uuid(), identity:z.number().int().min(1).max(5), garment:z.number().int().min(1).max(5), natural:z.number().int().min(1).max(5),
  helpful:z.enum(['yes','partly','no']), majorMissing:z.boolean(),
  tags:z.array(z.enum(['face','color','pattern','shape','missing','other'])).max(6),
  comment:z.string().max(1000), caseId:z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  split:z.enum(['tuning','holdout']), evaluator:z.enum(['operator','self']),
}).strict();
export class PocError extends Error {
  constructor(public status:number,public code:string,message:string){super(message);}
}
export function fail(status:number,code:string,message:string):never{throw new PocError(status,code,message);}
export function tokyoPeriod(now=new Date()):string{
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit'}).format(now);
}
