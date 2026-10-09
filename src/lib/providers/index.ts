import { MockProvider } from './mock';
import { FalProvider } from './fal';
import type { ProviderId,TryonInput } from '../contracts';
export function getProvider(id:ProviderId){return id==='mock'?new MockProvider():new FalProvider(id);}
export const PROMPT_VERSION='poc-1';
export function buildPrompt(input:TryonInput){
  return 'Produce exactly ONE front-facing full-body reference image. Image 1 is the consenting adult person. Preserve identity, body shape, background and unselected clothes. '
    +[...input.items].sort((a,b)=>a.layer-b.layer).map((item,i)=>`Image ${i+2}: selected ${item.category}, layer ${i+1} (inner to outer).`).join(' ')
    +' Use ALL selected garments; preserve colors, patterns, logos and shapes as closely as possible. Do not add absent clothes or accessories. Do not claim size or fit accuracy.';
}
