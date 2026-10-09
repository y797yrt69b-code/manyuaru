import { route,ok } from '@/lib/http';
import { providerId,integer } from '@/lib/config';
import { getProvider } from '@/lib/providers';
export const runtime='nodejs';
export async function GET(req:Request){return route(req,async()=>{
  const id=providerId();return ok({provider:getProvider(id).capabilities,liveEnabled:process.env.LIVE_API_ENABLED==='true',
    consentVersion:process.env.LIVE_CONSENT_VERSION??'',maxCostJpy:id==='mock'?0:integer('LIVE_MAX_COST_JPY'),
    maxCalls:integer('LIVE_MAX_CALLS'),totalBudgetJpy:integer('LIVE_TOTAL_BUDGET_JPY'),generationsEnabled:process.env.GENERATIONS_ENABLED!=='false'});
});}
