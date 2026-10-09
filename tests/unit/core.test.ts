import { describe,it,expect,vi,afterEach } from 'vitest';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { inputSchema,tokyoPeriod } from '../../src/lib/contracts';
import { normalizeImage } from '../../src/lib/images';
import { guard } from '../../src/lib/http';
import { summarize } from '../../src/lib/evaluation';
import { buildPrompt } from '../../src/lib/providers';
import { FalProvider } from '../../src/lib/providers/fal';
import { assertLiveAllowed } from '../../src/lib/config';
import { rateLimit } from '../../src/lib/rate-limit';
const input=()=>({personId:randomUUID(),items:[{assetId:randomUUID(),category:'tops' as const,layer:0}],idempotencyKey:randomUUID(),consent:true as const,layersConfirmed:true as const});
function configure(){
  for(const [key,value] of Object.entries({LIVE_API_ENABLED:'true',LIVE_TERMS_REVIEWED:'true',LIVE_BUDGET_APPROVED:'true',FAL_KEY:'TEST-NOT-A-KEY',LIVE_CONSENT_VERSION:'terms-1',LIVE_APPROVAL_ID:'test-approval',LIVE_PRICE_CHECKED_AT:'2026-10-09',LIVE_MAX_CALLS:'2',LIVE_TOTAL_BUDGET_JPY:'40',LIVE_MONTHLY_BUDGET_JPY:'40',LIVE_MAX_COST_JPY:'20',LIVE_MAX_REFERENCE_IMAGES:'14',LIVE_USD_JPY:'150',LIVE_PRICE_USD:'0.08'}))vi.stubEnv(key,value);
}
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('入力とAPI制約',()=>{
  it('重ね順・画像の重複と未同意を拒否する',()=>{
    const i=input();expect(inputSchema.safeParse({...i,consent:false}).success).toBe(false);
    expect(inputSchema.safeParse({...i,items:[...i.items,...i.items]}).success).toBe(false);
  });
  it('FASHNで複数着・靴を無断省略しない',()=>{
    configure();const p=new FalProvider('fal-fashn'),i={...input(),liveConsentVersion:'terms-1'};
    expect(()=>p.validateInputs({...i,items:[...i.items,{assetId:randomUUID(),category:'bottoms',layer:1}]})).toThrow('上限');
    expect(()=>p.validateInputs({...i,items:[{...i.items[0],category:'shoes'}]})).toThrow('対応していません');
  });
  it('Nanoの公式上限14参照を設定で広げられない',()=>{
    configure();vi.stubEnv('LIVE_MAX_REFERENCE_IMAGES','100');const p=new FalProvider('fal-nano');
    expect(p.capabilities.maxGarments).toBe(13);
    expect(()=>p.validateInputs({...input(),liveConsentVersion:'terms-1',items:Array.from({length:14},(_,layer)=>({assetId:randomUUID(),category:'tops',layer}))})).toThrow('上限');
  });
  it('価格・件数・同意・承認が未設定なら送信できない',()=>{
    configure();vi.stubEnv('LIVE_BUDGET_APPROVED','false');expect(assertLiveAllowed).toThrow('未承認');
    configure();vi.stubEnv('LIVE_MAX_COST_JPY','1');expect(assertLiveAllowed).toThrow('最大見積');
    configure();expect(()=>new FalProvider('fal-nano').validateInputs(input())).toThrow('同意');
  });
  it('全服と指定順をプロンプトに含む',()=>{
    const i=input();i.items=[{assetId:randomUUID(),category:'tops',layer:1},{assetId:randomUUID(),category:'tops',layer:0}];
    const text=buildPrompt(i);expect(text).toContain('Image 2: selected tops, layer 1');expect(text).toContain('Image 3: selected tops, layer 2');expect(text).toContain('ALL');
  });
});
describe('写真・境界保護',()=>{
  it('壊れた画像と容量超過を拒否する',async()=>{
    await expect(normalizeImage(Buffer.from('not an image'))).rejects.toThrow();
    await expect(normalizeImage(Buffer.alloc(10*1024*1024+1))).rejects.toThrow('10MB');
  });
  it('EXIFを除去し2048px以内へ再エンコード',async()=>{
    const buffer=await sharp({create:{width:2500,height:1800,channels:3,background:'white'}}).withMetadata({exif:{IFD0:{Artist:'private-person'}}}).jpeg().toBuffer();
    const normalized=await normalizeImage(buffer),meta=await sharp(normalized.data).metadata();expect(meta.width).toBe(2048);expect(meta.exif).toBeUndefined();
  });
  it('宣言MIMEと実体が違う画像を拒否する',async()=>{
    const png=await sharp({create:{width:10,height:10,channels:3,background:'white'}}).png().toBuffer();
    await expect(normalizeImage(png,'image/jpeg')).rejects.toThrow('実体');
  });
  it('偽ホストとクロスサイト送信を拒否',()=>{
    expect(()=>guard(new Request('http://evil.example/api/history',{headers:{host:'evil.example'}}))).toThrow('ローカル');
    expect(()=>guard(new Request('http://localhost:3000/api/tryon',{method:'POST',headers:{host:'localhost:3000',origin:'http://evil.example'}}))).toThrow('同じ画面');
    expect(()=>guard(new Request('http://127.0.0.1:3000/api/tryon',{method:'POST',headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000'}}))).not.toThrow();
  });
});
describe('評価・費用期間',()=>{
  it('モックを除外し最終評価の分母と重大欠落を保持',()=>{
    const base={case_id:'P01-C01',split:'holdout',evaluator:'operator',identity_score:4,garment_score:5,natural_score:4,major_missing:false};
    const s=summarize([{...base,provider:'mock'},{...base,provider:'fal-nano'},{...base,case_id:'P02-C01',provider:'fal-nano',major_missing:true}]);
    expect(s.mockExcluded).toBe(1);expect(s.holdoutLive).toEqual({ratings:2,cases:2,useful:1,usefulRate:.5});expect(summarize([]).allLive.usefulRate).toBeNull();
  });
  it('日本時間の月境界を使用',()=>{expect(tokyoPeriod(new Date('2026-10-31T15:00:00Z'))).toBe('2026-11');});
  it('短時間の操作を拒否し1分後に再開できる',()=>{
    const key=randomUUID();rateLimit(key,1,1000);expect(()=>rateLimit(key,1,2000)).toThrow('1分');expect(()=>rateLimit(key,1,61_000)).not.toThrow();
  });
});
describe('実Providerの契約試験（HTTPもモック、課金なし）',()=>{
  it('結果URLがlocalhostなら取得せず拒否',async()=>{
    const fetchMock=vi.fn().mockResolvedValueOnce(Response.json({status:'COMPLETED'})).mockResolvedValueOnce(Response.json({images:[{url:'http://127.0.0.1:5555/private'}]}));
    vi.stubGlobal('fetch',fetchMock);
    await expect(new FalProvider('fal-nano').getStatus('test-request')).rejects.toThrow('FAL_OUTPUT_HOST_UNVERIFIED');expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('データURI結果を取得（liveの品質証明にはならない）',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({status:'COMPLETED'})).mockResolvedValueOnce(Response.json({images:[{url:'data:image/jpeg;base64,YWJj'}]})));
    const status=await new FalProvider('fal-nano').getStatus('test-request');expect(status.state).toBe('succeeded');
  });
});
