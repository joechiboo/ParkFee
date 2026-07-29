// 配位結果地圖檢視 result.html：/allocate 執行抽籤後自動寫 localStorage，本頁讀出並在 B1 圖上色。
//   顏色＝配位方式（志願分發/電腦選號/志願小位/無障礙/物業指派）；鎖定灰、公益金框、剩餘淡黃。
//   點座位 → 右欄顯示 戶號/車號/輪次/順序號。資料只在瀏覽器 localStorage、頁面本身無個資。
// 用法：node scripts/build-result-tool.mjs → 開 public/demo/result.html（先去 /allocate 跑一次抽籤）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const OUT = 'public/demo'
mkdirSync(OUT, { recursive: true })

// live 鎖定清單（鎖定變動後重跑本腳本重生）
const env = {}
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = line.trim().match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const { data: lockedRows, error: lockErr } = await sb.from('locked_seat').select('車位編號')
if (lockErr) throw new Error('讀取 locked_seat 失敗：' + lockErr.message)
const lockedIds = lockedRows.map((r) => String(r.車位編號))

const cls = JSON.parse(readFileSync('src/map/b1-classification.json', 'utf8'))
const { dispW, dispH } = cls.meta
// 全機車位（大/小/無障礙，含公益旗標）— 結果含志願小位/無障礙，都要能顯示。
const CAT = { motor: '大', small: '小', access: '無障礙' }
const seats = cls.seats
  .filter((s) => s.cat in CAT)
  .map((s) => ({ id: s.id, x: s.x, y: s.y, t: CAT[s.cat], ...(s.public ? { p: 1 } : {}) }))

const SEATS_JSON = JSON.stringify(seats)
const LOCKED_JSON = JSON.stringify(lockedIds)

const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ParkFee 配位結果地圖</title><style>
 *{box-sizing:border-box}
 body{margin:0;font-family:system-ui,"Microsoft JhengHei",sans-serif;display:flex;height:100vh;overflow:hidden}
 #stage{flex:1;overflow:auto;background:#0f172a;position:relative;user-select:none}
 #wrap{position:relative;width:max-content}
 #plan{display:block;-webkit-user-drag:none}
 svg{position:absolute;inset:0;width:100%;height:100%}
 .seat{cursor:pointer}
 .seat circle{r:7;stroke-width:.7;fill:rgba(253,230,138,.25);stroke:#a16207}
 .seat text{font-size:6px;fill:#475569;text-anchor:middle;pointer-events:none;user-select:none}
 .seat.sel circle{stroke:#2563eb!important;stroke-width:2.6!important}
 .seat.pub circle{stroke:#ca8a04;stroke-width:2}
 .seat.lk{cursor:not-allowed}
 .seat.lk circle{fill:rgba(100,116,139,.35)!important;stroke:#475569!important;stroke-dasharray:2 2}
 .v-wish circle{fill:rgba(16,185,129,.75);stroke:#047857}
 .v-comp circle{fill:rgba(14,165,233,.75);stroke:#0369a1}
 .v-small circle{fill:rgba(139,92,246,.75);stroke:#6d28d9}
 .v-acc circle{fill:rgba(217,70,239,.75);stroke:#a21caf}
 .v-preset circle{fill:rgba(245,158,11,.8);stroke:#b45309}
 .seat.hit text{fill:#fff;font-weight:800;paint-order:stroke;stroke:#000;stroke-width:1.4}
 #panel{width:290px;flex:none;border-left:1px solid #e2e8f0;padding:14px;overflow:auto;background:#fff}
 h1{font-size:15px;margin:0 0 4px}.sub{font-size:12px;color:#64748b;line-height:1.5;margin:0 0 10px}
 .lg{display:flex;align-items:center;gap:6px;font-size:12px;color:#475569;margin:2px 0}
 .dot{width:11px;height:11px;border-radius:50%;flex:none;border:1px solid rgba(0,0,0,.25)}
 .stat{font-size:13px;margin:3px 0;display:flex;justify-content:space-between}
 button{font-size:13px;padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;cursor:pointer}
 button:hover{background:#eef2f7}
 hr{border:none;border-top:1px solid #e2e8f0;margin:12px 0}
 #detail{font-size:13px;color:#334155;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;min-height:64px}
 #meta{font-size:11px;color:#94a3b8;line-height:1.5}
 .warn{font-size:12px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px}
</style></head><body>
 <div id="stage"><div id="wrap"><img id="plan" src="b1.png" draggable="false">
   <svg id="svg" viewBox="0 0 ${dispW} ${dispH}"></svg></div></div>
 <div id="panel">
   <h1>配位結果地圖</h1>
   <p class="sub">到 <a href="../#/allocate" target="_blank">配位頁</a>執行抽籤後回來按「重新載入」。結果只存你這台瀏覽器。</p>
   <div id="nores" class="warn" style="display:none">尚無結果 — 請先到配位頁「執行抽籤」，再回來按重新載入。</div>
   <div class="stat"><span>已配位</span><b id="n-as">—</b></div>
   <div class="stat"><span>落選</span><b id="n-lo">—</b></div>
   <div class="stat"><span>剩餘可租</span><b id="n-re">—</b></div>
   <div class="row" style="margin-top:8px"><button id="reload">🔄 重新載入結果</button></div>
   <hr>
   <div class="lg"><span class="dot" style="background:rgba(16,185,129,.75)"></span>志願分發</div>
   <div class="lg"><span class="dot" style="background:rgba(14,165,233,.75)"></span>電腦選號</div>
   <div class="lg"><span class="dot" style="background:rgba(139,92,246,.75)"></span>志願小位</div>
   <div class="lg"><span class="dot" style="background:rgba(217,70,239,.75)"></span>無障礙</div>
   <div class="lg"><span class="dot" style="background:rgba(245,158,11,.8)"></span>物業指派</div>
   <div class="lg"><span class="dot" style="background:rgba(100,116,139,.35);border-style:dashed"></span>鎖定（不出租）</div>
   <div class="lg"><span class="dot" style="background:rgba(253,230,138,.25);border-color:#ca8a04;border-width:2px"></span>金框＝公益</div>
   <hr>
   <div id="detail">點地圖上的座位看明細。</div>
   <div id="meta" style="margin-top:8px">—</div>
 </div>
<script>
 const SEATS=${SEATS_JSON}, DISPW=${dispW}, DISPH=${dispH};
 const LOCKED=new Set(${LOCKED_JSON});
 const KEY='parkfee_alloc_result_v1';
 const NS='http://www.w3.org/2000/svg';
 const VIA_CLASS={'志願分發':'v-wish','電腦選號':'v-comp','志願小位':'v-small','無障礙':'v-acc','物業指派':'v-preset'};
 const svg=document.getElementById('svg'),stage=document.getElementById('stage'),plan=document.getElementById('plan');
 const el=id=>document.getElementById(id);
 const nodes=new Map();let selId=null,byId={};
 for(const s of SEATS){byId[s.id]=s;const g=document.createElementNS(NS,'g');
   const c=document.createElementNS(NS,'circle');c.setAttribute('cx',s.x);c.setAttribute('cy',s.y);
   const t=document.createElementNS(NS,'text');t.setAttribute('x',s.x);t.setAttribute('y',s.y+2.5);t.textContent=s.id;
   g.appendChild(c);g.appendChild(t);svg.appendChild(g);nodes.set(s.id,g);
   g.setAttribute('data-id',s.id);}
 let assign=new Map(),summary=null,meta=null,lost=[];
 function load(){assign=new Map();summary=null;meta=null;lost=[];
   try{const raw=localStorage.getItem(KEY);if(raw){const r=JSON.parse(raw);summary=r.summary;lost=r.落選||[];meta={seed:r.seed,runAt:r.runAt};
     for(const a of r.assigned||[]){for(const id of String(a.車位編號).split('、')){if(id)assign.set(id.trim(),a)}}}}catch(e){}
   render();}
 function render(){el('nores').style.display=summary?'none':'block';
   el('n-as').textContent=summary?summary.assigned:'—';
   el('n-lo').textContent=summary?summary['落選']:'—';
   el('n-re').textContent=summary?summary.remaining:'—';
   el('meta').textContent=meta?('種子「'+meta.seed+'」 · '+String(meta.runAt||'').slice(0,19).replace('T',' ')):'—';
   for(const s of SEATS){const g=nodes.get(s.id);const a=assign.get(String(s.id));
     let cl='seat';
     if(LOCKED.has(s.id))cl+=' lk';
     else if(a)cl+=' '+(VIA_CLASS[a.配位方式]||'v-preset')+' hit';
     if(s.p)cl+=' pub';
     if(selId===s.id)cl+=' sel';
     g.setAttribute('class',cl);}}
 function select(id){selId=id;render();const s=byId[id];const a=assign.get(String(id));
   let h='<b>車位 '+id+'</b> <span style="color:#94a3b8">'+s.t+(s.p?'·公益':'')+(LOCKED.has(id)?'·鎖定':'')+'</span><br>';
   if(a){h+='車號 <span style="font-family:monospace">'+(a.車號||'—')+'</span><br>'  // 戶號不顯示（公開投影防個資）
     +'方式 '+a.配位方式+(a.輪次!=null?'　輪次 '+a.輪次:'')+(a.順序號!=null?'　順序號 '+a.順序號:'');}
   else if(LOCKED.has(id))h+='<span style="color:#64748b">鎖定中（維修/凍結/預留），不出租。</span>';
   else h+='<span style="color:#64748b">未配出（仍在池中）。</span>';
   el('detail').innerHTML=h;}
 // 平移（左鍵拖曳）＋縮放（Ctrl+滾輪）
 let zoom=0.62;function applyZoom(){plan.style.width=(DISPW*zoom)+'px'}
 let mode=null,sx,sy,sl,st,moved=0,downId=null;
 stage.addEventListener('pointerdown',e=>{if(e.button!==0&&e.button!==2)return;
   const sg=e.target.closest?e.target.closest('.seat'):null;downId=sg?sg.getAttribute('data-id'):null;
   mode='pan';moved=0;sx=e.clientX;sy=e.clientY;sl=stage.scrollLeft;st=stage.scrollTop;stage.setPointerCapture(e.pointerId);});
 stage.addEventListener('pointermove',e=>{if(mode==='pan'){const dx=e.clientX-sx,dy=e.clientY-sy;moved=Math.max(moved,Math.abs(dx)+Math.abs(dy));stage.scrollLeft=sl-dx;stage.scrollTop=st-dy;}});
 stage.addEventListener('pointerup',()=>{if(moved<=6&&downId)select(downId);mode=null;downId=null;});
 stage.addEventListener('contextmenu',e=>e.preventDefault());
 stage.addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();zoom=Math.max(0.3,Math.min(3,zoom*(e.deltaY<0?1.1:0.9)));applyZoom();},{passive:false});
 el('reload').onclick=load;
 applyZoom();load();
</script></body></html>`
writeFileSync(`${OUT}/result.html`, html)
console.log(`wrote ${OUT}/result.html — seats ${seats.length}, locked ${lockedIds.length}`)