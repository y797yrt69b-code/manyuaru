export type EvalRow={provider:string;case_id:string;split:string;evaluator:string;identity_score:number;garment_score:number;natural_score:number;major_missing:boolean;state?:string;duration_seconds?:number|null};
export function useful(row:EvalRow){return Math.min(row.identity_score,row.garment_score,row.natural_score)>=4&&!row.major_missing;}
export function summarize(rows:EvalRow[]){
  const live=rows.filter(x=>x.provider!=='mock');
  const cohort=(r:EvalRow[])=>({ratings:r.length,cases:new Set(r.map(x=>x.case_id)).size,useful:r.filter(useful).length,usefulRate:r.length?r.filter(useful).length/r.length:null});
  return {mockExcluded:rows.length-live.length,allLive:cohort(live),holdoutLive:cohort(live.filter(x=>x.split==='holdout'))};
}
