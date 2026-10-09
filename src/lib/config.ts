import { fail, type ProviderId } from './contracts';
export function integer(name:string,fallback=0){
  const n=Number(process.env[name]??fallback);
  if(!Number.isSafeInteger(n)||n<0) fail(503,'CONFIG_INVALID',`${name}の設定を確認してください`);
  return n;
}
export function providerId():ProviderId{
  const id=process.env.AI_PROVIDER??'mock';
  if(!['mock','fal-fashn','fal-nano'].includes(id)) fail(503,'PROVIDER_INVALID','Provider設定が不正です');
  return id as ProviderId;
}
export function assertLiveAllowed(){
  for(const name of ['LIVE_API_ENABLED','LIVE_TERMS_REVIEWED','LIVE_BUDGET_APPROVED']) {
    if(process.env[name]!=='true') fail(503,'LIVE_DISABLED','実APIは未承認です。料金・条件・上限・件数を運営者と決めてください');
  }
  for(const name of ['FAL_KEY','LIVE_CONSENT_VERSION','LIVE_APPROVAL_ID','LIVE_PRICE_CHECKED_AT']) {
    if(!process.env[name]) fail(503,'LIVE_CONFIG_MISSING',`${name}が未設定です。秘密値はチャットに貼らないでください`);
  }
  for(const name of ['LIVE_MAX_CALLS','LIVE_TOTAL_BUDGET_JPY','LIVE_MONTHLY_BUDGET_JPY','LIVE_MAX_COST_JPY','LIVE_MAX_REFERENCE_IMAGES']) {
    if(integer(name)<1) fail(503,'LIVE_LIMIT_MISSING',`${name}の上限を設定してください`);
  }
  const rate=Number(process.env.LIVE_USD_JPY), price=Number(process.env.LIVE_PRICE_USD);
  if(!Number.isFinite(rate)||rate<=0||!Number.isFinite(price)||price<=0||Math.ceil(rate*price)>integer('LIVE_MAX_COST_JPY'))
    fail(503,'LIVE_PRICE_INVALID','公式料金・為替・最大見積（税等込み）を確認してください');
}
