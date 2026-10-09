'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
type Asset={id:string;kind:string};
type Item={assetId:string;category:string;layer:number;label:string};
type Job={id:string;state:string;provider:string;model:string;created_at:string;finished_at:string|null;started_at:string|null;error_code:string|null;max_jpy:number;actual_jpy:number|null;cost_status:string;image_id:string|null;inputs:{personId?:string;items?:Item[]};feedback_id?:string};
type Config={provider:{id:string;mode:string;model:string;maxGarments:number|null;validatedLive:boolean};liveEnabled:boolean;consentVersion:string;maxCostJpy:number;maxCalls:number;totalBudgetJpy:number;generationsEnabled:boolean};
const names:Record<string,string>={tops:'トップス',bottoms:'ボトムス',outer:'アウター',shoes:'靴',other:'その他'};
const states:Record<string,string>={queued:'受付済み・ワーカー待ち',running:'生成中',succeeded:'完了',failed:'失敗',cancelled:'取消',reconciling:'照合待ち・自動再送しません'};
async function api<T>(path:string,options?:RequestInit):Promise<T>{
  const r=await fetch(path,options),body=await r.json();if(!r.ok)throw new Error(`${body.error} (${body.code})`);return body.data;
}
function date(value:string){return new Date(value).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});}
function jsonPost(body:unknown){return {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};}
export default function PocScreen(){
  const [config,setConfig]=useState<Config|null>(null),[person,setPerson]=useState<string>(''),[items,setItems]=useState<Item[]>([]);
  const [consent,setConsent]=useState(false),[confirmed,setConfirmed]=useState(false),[liveConsent,setLiveConsent]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[job,setJob]=useState<Job|null>(null),[history,setHistory]=useState<Job[]>([]);
  const [metrics,setMetrics]=useState<unknown>(null),[now,setNow]=useState(Date.now());
  const [scores,setScores]=useState({identity:4,garment:4,natural:4}),[helpful,setHelpful]=useState('partly'),[majorMissing,setMajorMissing]=useState(false),[tags,setTags]=useState<string[]>([]),[comment,setComment]=useState(''),[caseId,setCaseId]=useState(''),[split,setSplit]=useState('tuning'),[evaluator,setEvaluator]=useState('operator');
  const key=useRef(''),fingerprint=useRef(''),inFlight=useRef(false);
  const [draftReady,setDraftReady]=useState(false);
  const refresh=useCallback(async()=>{const [h,m]=await Promise.all([api<Job[]>('/api/history'),api('/api/metrics')]);setHistory(h);setMetrics(m);},[]);
  useEffect(()=>{
    key.current=crypto.randomUUID();
    try{const s=sessionStorage.getItem('poc-inputs');if(s){const v=JSON.parse(s);setPerson(v.person??'');setItems(v.items??[]);key.current=v.idempotencyKey??key.current;fingerprint.current=JSON.stringify([v.person??'',v.items??[],v.providerId??'mock',v.consentVersion??'']);}}
    catch{/* old draft not recoverable */}setDraftReady(true);
    api<Config>('/api/config').then(setConfig).catch(e=>setError(e.message));refresh().catch(e=>setError(e.message));
  },[refresh]);
  useEffect(()=>{if(draftReady&&config){
    const next=JSON.stringify([person,items,config.provider.id,config.consentVersion]);
    if(next!==fingerprint.current){key.current=crypto.randomUUID();fingerprint.current=next;setConfirmed(false);}
    sessionStorage.setItem('poc-inputs',JSON.stringify({person,items,idempotencyKey:key.current,providerId:config.provider.id,consentVersion:config.consentVersion}));
  }},[person,items,draftReady,config]);
  useEffect(()=>{
    if(!job||!['queued','running','reconciling'].includes(job.state))return;
    const t=setInterval(()=>{setNow(Date.now());api<Job>(`/api/tryon/${job.id}`).then(j=>{setJob(j);if(['succeeded','failed','cancelled'].includes(j.state))refresh().catch(e=>setError(e.message));}).catch(e=>setError(e.message));},1500);
    return ()=>clearInterval(t);
  },[job?.id,job?.state,refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  async function task(fn:()=>Promise<void>){if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setMessage('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'操作に失敗しました');}finally{inFlight.current=false;setBusy(false);}}
  async function upload(file:File,kind:string){
    if(file.size>10*1024*1024)throw new Error('画像は1枚10MB以下にしてください');
    return api<Asset>(`/api/uploads?kind=${kind}`,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});
  }
  function move(i:number,d:number){setItems(old=>{const next=[...old];[next[i],next[i+d]]=[next[i+d],next[i]];return next.map((v,n)=>({...v,layer:n}));});}
  async function generate(regenerate=false){await task(async()=>{
    if(regenerate)key.current=crypto.randomUUID();
    sessionStorage.setItem('poc-inputs',JSON.stringify({person,items,idempotencyKey:key.current,providerId:config?.provider.id??'mock',consentVersion:config?.consentVersion??''}));
    const payload={personId:person,items:items.map(({assetId,category,layer})=>({assetId,category,layer})),idempotencyKey:key.current,consent,layersConfirmed:confirmed,
      ...(config?.provider.mode==='live'?{liveConsentVersion:liveConsent?config.consentVersion:''}:{})};
    const v=await api<{jobId:string}>('/api/tryon',jsonPost(payload));setJob(await api<Job>(`/api/tryon/${v.jobId}`));await refresh();setMessage('受付しました。別プロセスのワーカーが処理します。');
  });}
  const live=config?.provider.mode==='live',mock=job?job.provider==='mock':!live;
  const elapsed=job?Math.max(0,Math.round(((job.finished_at?new Date(job.finished_at).getTime():now)-new Date(job.created_at).getTime())/1000)):0;
  const canGenerate=!!config&&!!person&&items.length>0&&consent&&confirmed&&(!live||liveConsent)&&!busy;
  return <main className="shell">
    <header className="header"><div><div className="eyebrow">MANYUARU / PHASE A</div><h1>自分の写真で、服の組み合わせを検証。</h1><p className="muted">技術PoC · ローカル限定 · サイズやフィットは保証しません</p></div><span className="badge">{live?'実API候補・実送信未検証':'MOCK / 動作確認'}</span></header>
    <div className="notice" role="status">{!live?'デモ画像・実際のAI試着ではありません。モックは元の本人写真を返します。服は合成しません。品質・原価・購入の検証には使えません。':'実APIモードです。外部AIに写真を送信します。運営者の承認・上限設定が必要です。接続・料金・品質は初回実測まで未検証です。'}</div>
    {error&&<div className="error" role="alert">{error}<p>入力はそのままです。設定を確認してから再操作してください。</p></div>}{message&&<div className="success" role="status">{message}</div>}
    <div className="grid"><section className="card"><h2>01 / 入力と重ね順</h2><p className="muted">明るい場所の正面全身写真。本人または許可を得た18歳以上の方の写真だけを使ってください。JPEG / PNG / WebP、1枚10MB・2,500万画素まで。</p>
      {person?<img className="preview" src={`/api/images/${person}`} alt="登録した本人写真"/>:<div className="empty">本人写真を選択してください</div>}
      <label className="stack"><span>本人写真</span><input aria-label="本人写真" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)task(async()=>{const a=await upload(f,'person');setPerson(a.id);});e.target.value='';}}/></label>
      <h3>服の画像 · {items.length}着</h3><p className="muted">着数の固定上限はありません。実APIの制約超過は、服を省略せず拒否します。上から内側 → 外側の順です。</p>
      <label className="stack"><span>服を追加（複数選択できます）</span><input aria-label="服を追加" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={e=>{const files=Array.from(e.target.files??[]);task(async()=>{for(const f of files){const a=await upload(f,'garment');setItems(old=>[...old,{assetId:a.id,category:'tops',layer:old.length,label:f.name}]);}});e.target.value='';}}/></label>
      {items.map((item,i)=><div className="item" key={item.assetId}><img src={`/api/images/${item.assetId}`} alt={`服 ${i+1}`}/><div><div className="muted">{i+1} / {item.label}</div><label>カテゴリ<select aria-label={`服${i+1}のカテゴリ`} value={item.category} disabled={busy} onChange={e=>setItems(old=>old.map(v=>v.assetId===item.assetId?{...v,category:e.target.value}:v))}>{Object.entries(names).map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label><div className="controls"><button aria-label={`服${i+1}を内側へ`} disabled={busy||i===0} onClick={()=>move(i,-1)}>↑ 内側</button><button aria-label={`服${i+1}を外側へ`} disabled={busy||i===items.length-1} onClick={()=>move(i,1)}>↓ 外側</button><button disabled={busy} onClick={()=>setItems(old=>old.filter(v=>v.assetId!==item.assetId).map((v,n)=>({...v,layer:n})))}>選択解除</button></div></div></div>)}
      <label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>本人・服の利用許可と18歳以上を確認しました。ローカル保存に同意します。</label>
      <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>カテゴリ、重ね順、同時に着られる組み合わせを確認しました。</label>
      {live&&<><div className="notice">モデル: {config?.provider.model}<br/>最大見積 ¥{config?.maxCostJpy} / 受付上限 {config?.maxCalls}件 / 累計予算 ¥{config?.totalBudgetJpy}<br/>外部送信先: fal.ai。保持・学習条件は運営者の説明書を確認してください。</div><label><input type="checkbox" checked={liveConsent} onChange={e=>setLiveConsent(e.target.checked)}/>送信先・保存/学習条件の説明（{config?.consentVersion||'未設定'}）を読み、外部送信に同意します。</label></>}
      <div className="actions"><button className="primary" disabled={!canGenerate} onClick={()=>generate()}>1枚生成する</button><button disabled={busy} onClick={()=>{setPerson('');setItems([]);setConsent(false);setMessage('画面の入力をクリアしました。画像の完全削除は履歴削除またはREADMEの全削除手順を使ってください。');}}>入力をクリア</button></div><p className="muted">入力をクリア・選択解除しても保存画像は即削除されません。履歴削除または全削除手順を使ってください。保存期限は90日です。</p>
    </section><section className="card"><h2>02 / 結果と記録</h2>
      {!job?<div className="empty">生成した結果がここに表示されます</div>:<><div className="badge">{states[job.state]??job.state} / {job.provider}</div><p className="muted">{date(job.created_at)} · {job.model}</p>
      {job.provider==='mock'&&<div className="notice">デモ画像・実際のAI試着ではありません。元の本人写真です。</div>}
      {job.image_id?<a href={`/api/images/${job.image_id}`} target="_blank" rel="noreferrer" aria-label="結果を拡大"><img className="result-photo" src={`/api/images/${job.image_id}`} alt={mock?'モック結果：元の本人写真':'AI試着の参考画像'}/></a>:<div className="empty">{job.state==='queued'?'npm run worker でワーカーを起動してください':states[job.state]}</div>}
      <p>AIによる参考画像です。サイズや服の細部は実物と異なる場合があります。</p>
      <div className="stats"><div className="stat">受付からの所要時間<strong>{elapsed}秒</strong></div><div className="stat">費用（JPY）<strong>{job.actual_jpy===null?'実費未確定':`¥${job.actual_jpy}`}</strong><span>最大見積 ¥{job.max_jpy} / {job.cost_status}</span></div></div>
      {job.error_code&&<div className="error">{job.error_code}：ワーカーや外部の状態を確認してください。結果・課金が不明な実APIを再送しないでください。</div>}
      <div className="actions">{job.image_id&&<a href={`/api/images/${job.image_id}`} download="reference.jpg">画像を保存</a>}{job.state==='queued'&&<button disabled={busy} onClick={()=>task(async()=>{await api(`/api/tryon/${job.id}`,{method:'PATCH'});setJob(await api(`/api/tryon/${job.id}`));await refresh();})}>未開始の生成を取消</button>}{job.state==='succeeded'&&<button disabled={!canGenerate} onClick={()=>generate(true)}>現在の入力で再生成（新しい1件）</button>}</div>
      <p className="muted">成功結果は受付から90日で削除対象。ワーカー稼働中に定期削除します。低評価・失敗・不明課金も原価記録に残ります。</p>
      {job.state==='succeeded'&&<form onSubmit={e=>{e.preventDefault();task(async()=>{await api('/api/feedback',jsonPost({jobId:job.id,...scores,helpful,majorMissing,tags,comment,caseId,split,evaluator}));setMessage(mock?'モック評価を保存しました。実品質の集計から除外します。':'評価を保存しました。');await refresh();});}}><h3>品質評価 {mock&&'（モック練習）'}</h3><p className="muted">各1〜5。全項目4以上かつ重大欠落なしで「有用」。ケース番号・調整/最終区分は初回保存後に固定します。</p>
        <label className="stack"><span>ケース番号（例 P01-C01）</span><input aria-label="ケース番号" required pattern="[A-Za-z0-9_-]{1,80}" value={caseId} onChange={e=>setCaseId(e.target.value)}/></label>
        <label>評価セット<select aria-label="評価セット" value={split} onChange={e=>setSplit(e.target.value)}><option value="tuning">調整用40件</option><option value="holdout">最終評価20件</option></select></label>
        <label>採点者<select value={evaluator} onChange={e=>setEvaluator(e.target.value)}><option value="operator">運営者</option><option value="self">写真の本人</option></select></label>
        {Object.entries({identity:'本人らしさ',garment:'服の再現',natural:'自然さ'}).map(([k,n])=><label className="rating" key={k}>{n}<select aria-label={n} value={scores[k as keyof typeof scores]} onChange={e=>setScores(s=>({...s,[k]:Number(e.target.value)}))}>{[1,2,3,4,5].map(v=><option value={v} key={v}>{v}</option>)}</select></label>)}
        <label>購入判断に役立った<select aria-label="購入判断に役立った" value={helpful} onChange={e=>setHelpful(e.target.value)}><option value="yes">はい</option><option value="partly">一部</option><option value="no">いいえ</option></select></label>
        <label><input type="checkbox" checked={majorMissing} onChange={e=>setMajorMissing(e.target.checked)}/>服や部位の重大な欠落がある</label>
        <div className="tags">{Object.entries({face:'顔',color:'色',pattern:'柄',shape:'形',missing:'欠落',other:'その他'}).map(([k,n])=><label key={k}><input type="checkbox" checked={tags.includes(k)} onChange={e=>setTags(old=>e.target.checked?[...old,k]:old.filter(v=>v!==k))}/>{n}</label>)}</div>
        <label className="stack"><span>コメント（個人情報を入力しないでください）</span><textarea maxLength={1000} value={comment} onChange={e=>setComment(e.target.value)}/></label><button className="primary" disabled={busy}>評価を保存</button>
      </form>}</>}
    </section></div>
    <section className="card" style={{marginTop:24}}><h2>検証履歴</h2><p className="muted">最新100件。低評価でも保持します。履歴削除は写真・評価を削除し、費用記録を残します。</p>{history.length===0?<p className="muted">まだ履歴はありません。</p>:history.map(h=><div className="history-row" key={h.id}><div>{date(h.created_at)}<br/>{h.provider} · {states[h.state]} · 最大 ¥{h.max_jpy} / 実費 {h.actual_jpy===null?'未確定':`¥${h.actual_jpy}`}</div><div className="actions"><button disabled={busy} onClick={()=>task(async()=>{setJob(await api<Job>(`/api/tryon/${h.id}`));setCaseId('');setComment('');})}>開く</button><button className="danger" disabled={busy} onClick={()=>{if(confirm('この履歴の写真・評価を削除します。費用記録は残ります。よろしいですか？'))task(async()=>{const v=await api<{note:string}>(`/api/tryon/${h.id}`,{method:'DELETE'});if(job?.id===h.id)setJob(null);setPerson('');setItems([]);setMessage(v.note);await refresh();});}}>削除</button></div></div>)}
      <details><summary>品質・費用集計（モックと実APIを分離）</summary><pre className="metrics">{JSON.stringify(metrics,null,2)}</pre><div className="actions"><button disabled={busy} onClick={()=>task(refresh)}>集計を更新</button><button disabled={busy} onClick={()=>task(async()=>{const rows=await api<Record<string,unknown>[]>('/api/export');const columns=rows.length?Object.keys(rows[0]):['id','provider','state'];const cell=(v:unknown)=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';const csv=[columns.map(cell).join(','),...rows.map(r=>columns.map(c=>cell(r[c])).join(','))].join('\r\n');const u=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=u;a.download='poc-evaluation.csv';a.click();URL.revokeObjectURL(u);})}>記録CSVを保存</button></div></details>
    </section><footer>Phase A のみ。認証・クローゼット・決済・一般公開は未実装。写真はローカルの非公開領域へ保存します。実機・実API・事業品質の検証は別途必要です。</footer>
  </main>;
}
