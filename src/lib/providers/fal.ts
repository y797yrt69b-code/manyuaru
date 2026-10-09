import { z } from 'zod';
import { assertLiveAllowed,integer } from '../config';
import { fail,type TryonInput } from '../contracts';
import { imageBytes } from '../images';
import type { Provider,PollResult } from './types';
// REST shape verified against official fal-js source; actual paid execution NOT verified.
// No SDK retry logic: a POST is sent at most once by this process.
export class FalProvider implements Provider {
  readonly capabilities;
  constructor(readonly variant:'fal-fashn'|'fal-nano'){
    this.capabilities={id:variant,mode:'live',model:variant==='fal-fashn'?'fal-ai/fashn/tryon/v1.6':'fal-ai/nano-banana-2/edit',
      maxGarments:variant==='fal-fashn'?1:Math.max(0,Math.min(14,integer('LIVE_MAX_REFERENCE_IMAGES'))-1),
      categories:variant==='fal-fashn'?['tops','bottoms','outer']:['tops','bottoms','outer','shoes','other'],
      multiGarment:variant==='fal-nano',cancel:true,validatedLive:false} as const;
  }
  validateInputs(input:TryonInput){
    assertLiveAllowed();
    if(input.liveConsentVersion!==process.env.LIVE_CONSENT_VERSION)fail(422,'LIVE_CONSENT','現在の事業者・保持条件の説明を確認して同意してください');
    if(input.items.length>this.capabilities.maxGarments||input.items.length+1>integer('LIVE_MAX_REFERENCE_IMAGES'))fail(422,'PROVIDER_LIMIT','APIの画像数上限を超えています。選んだ服は省略しません');
    if(input.items.some(x=>!this.capabilities.categories.includes(x.category)))fail(422,'UNSUPPORTED_CATEGORY','このAPIは靴・その他に対応していません');
  }
  estimateMaxCost(){assertLiveAllowed();return integer('LIVE_MAX_COST_JPY');}
  private base(){return `https://queue.fal.run/${this.variant==='fal-fashn'?'fal-ai/fashn':'fal-ai/nano-banana-2'}`;}
  private async request(url:string,method='GET',body?:unknown){
    const response=await fetch(url,{method,headers:{Authorization:`Key ${process.env.FAL_KEY}`,'Content-Type':'application/json',
      'X-Fal-Store-IO':'0','X-Fal-Object-Lifecycle-Preference':JSON.stringify({expiration_duration_seconds:3600,initial_acl:{default:'forbid',rules:[]}})},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30_000),redirect:'error'});
    if(!response.ok)throw new Error(`FAL_HTTP_${response.status}`); // No response bodies/URLs in logs.
    const text=await response.text();if(text.length>20*1024*1024)throw new Error('FAL_RESPONSE_SIZE');
    return JSON.parse(text);
  }
  async submit(input:TryonInput,prompt:string){
    this.validateInputs(input);
    const dataURL=async(id:string)=>`data:image/jpeg;base64,${(await imageBytes(id)).toString('base64')}`;
    const sorted=[...input.items].sort((a,b)=>a.layer-b.layer);
    const payload=this.variant==='fal-fashn'?{
      model_image:await dataURL(input.personId),garment_image:await dataURL(sorted[0].assetId),
      category:sorted[0].category==='bottoms'?'bottoms':'tops',num_samples:1,mode:'quality',output_format:'jpeg',moderation_level:'conservative',sync_mode:true,
    }:{
      image_urls:await Promise.all([input.personId,...sorted.map(x=>x.assetId)].map(dataURL)),
      prompt,num_images:1,resolution:'1K',output_format:'jpeg',limit_generations:true,enable_web_search:false,safety_tolerance:'2',sync_mode:true,
    };
    const result=await this.request(`https://queue.fal.run/${this.capabilities.model}`,'POST',payload);
    return z.object({request_id:z.string().regex(/^[A-Za-z0-9_-]{1,200}$/)}).parse(result).request_id;
  }
  async getStatus(externalId:string):Promise<PollResult>{
    // Polling is read-only and safe to repeat. Submission is never repeated.
    const id=encodeURIComponent(externalId),status=await this.request(`${this.base()}/requests/${id}/status?logs=0`);
    if(status.status!=='COMPLETED')return {state:'pending'};
    const result=await this.request(`${this.base()}/requests/${id}`);
    const url=z.object({images:z.array(z.object({url:z.string()})).length(1)}).parse(result).images[0].url;
    if(url.startsWith('data:image/')){
      const match=/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(url);
      if(!match||match[1].length>14*1024*1024)throw new Error('FAL_RESULT_INVALID');
      return {state:'succeeded',image:Buffer.from(match[1],'base64')};
    }
    const u=new URL(url);
    // Fail closed instead of fetching arbitrary provider-supplied hosts or redirects (SSRF).
    if(u.protocol!=='https:'||u.port||u.username||u.password||u.hostname!=='v3b.fal.media')throw new Error('FAL_OUTPUT_HOST_UNVERIFIED');
    const token=z.object({token:z.string()}).parse(await this.request('https://rest.fal.ai/storage/auth/token?storage_type=fal-cdn-v3','POST',{})).token;
    const r=await fetch(u,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30_000)});
    if(!r.ok)throw new Error('FAL_RESULT_DOWNLOAD');
    const reader=r.body!.getReader();let size=0;const chunks:Uint8Array[]=[];
    while(true){const v=await reader.read();if(v.done)break;size+=v.value.length;if(size>10*1024*1024){await reader.cancel();throw new Error('FAL_RESULT_SIZE');}chunks.push(v.value);}
    return {state:'succeeded',image:Buffer.concat(chunks)};
  }
  async cancel(externalId:string){
    try{
      const r=await fetch(`${this.base()}/requests/${encodeURIComponent(externalId)}/cancel`,{method:'PUT',headers:{Authorization:`Key ${process.env.FAL_KEY}`},signal:AbortSignal.timeout(15_000),redirect:'error'});
      return r.ok; // Acceptance is NOT proof of no charge or completed cancellation.
    }catch{return false;}
  }
}
