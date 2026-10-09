import { randomUUID } from 'node:crypto';
import type { Provider } from './types';
import { imageBytes } from '../images';
export class MockProvider implements Provider {
  capabilities={id:'mock',model:'identity-demo-v1',mode:'mock',maxGarments:null,categories:['tops','bottoms','outer','shoes','other'],multiGarment:true,cancel:true,validatedLive:false} as const;
  validateInputs(){/* No garment-count cap: all inputs persist, no actual try-on. */}
  estimateMaxCost(){return 0;}
  async submit(){return `mock-${randomUUID()}`;}
  async getStatus(_id:string,input:Parameters<Provider['getStatus']>[1]){
    return {state:'succeeded',image:await imageBytes(input.personId)} as const;
  }
  async cancel(){return true;}
}
