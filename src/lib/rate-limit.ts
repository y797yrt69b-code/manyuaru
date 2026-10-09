import { fail } from './contracts';
const globalRate=globalThis as unknown as {pocRates?:Map<string,{start:number;count:number}>};
const rates=globalRate.pocRates??new Map<string,{start:number;count:number}>();globalRate.pocRates=rates;
// Local single-process PoC throttle. Monetary limits are separately persistent.
export function rateLimit(key:string,limit:number,now=Date.now()){
  const prior=rates.get(key),record=prior&&now-prior.start<60_000?prior:{start:now,count:0};
  if(record.count>=limit)fail(429,'RATE_LIMIT','短時間の操作が多すぎます。1分待って再操作してください');
  record.count++;rates.set(key,record);
}
