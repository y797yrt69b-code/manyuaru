import type { TryonInput,ProviderId } from '../contracts';
export interface Capabilities {
  id:ProviderId; model:string; mode:'mock'|'live'; maxGarments:number|null;
  categories:readonly string[]; multiGarment:boolean; cancel:boolean; validatedLive:boolean;
}
export type PollResult={state:'pending'}|{state:'succeeded';image:Buffer}|{state:'failed';code:string};
export interface Provider {
  capabilities:Capabilities;
  validateInputs(input:TryonInput):void;
  estimateMaxCost():number;
  submit(input:TryonInput,prompt:string):Promise<string>;
  getStatus(externalId:string,input:TryonInput):Promise<PollResult>;
  cancel(externalId:string):Promise<boolean>;
}
