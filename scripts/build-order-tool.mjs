// 分棟順序工具：每棟點選座位，點擊順序＝電腦選位的填補順序。
// 手排的排前面、沒點到的用「離該棟電梯距離」補後面 → 只需點你在意的靠電梯前幾格。
// 匯出直接就是 src/map/tower-priority.json 的格式（towers 每棟有序 id + seatTower）。
// 用法：node scripts/build-order-tool.mjs → 開 public/demo/order.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const OUT = 'public/demo'
mkdirSync(OUT, { recursive: true })

// live 鎖定清單（凍結位在工具中灰掉、不可點；鎖定變動後重跑本腳本重生工具）
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
// 可承租大位（排除公益；小位走志願、無障礙走 R0，皆不進電腦選位）。
const motor = cls.seats.filter((s) => s.cat === 'motor' && !s.public).map((s) => ({ id: s.id, x: s.x, y: s.y }))

const CORES = [
  { name: 'AB', x: 581, y: 424 },
  { name: 'CD', x: 563, y: 1168 },
  { name: 'EF', x: 1102, y: 1375 },
  { name: 'GH', x: 1378, y: 1375 },
]
const SEATS_JSON = JSON.stringify(motor)
const LOCKED_JSON = JSON.stringify(lockedIds)

// 分界（與 build-tower-priority.mjs 同邏輯）：左欄 y 中位分 AB/CD；GH=右區(x≥1240)∪指定塊 419-442（EF 出口留 EF）
const lockedSet = new Set(lockedIds)
const usable = motor.filter((s) => !lockedSet.has(s.id))
const X_MID = 560
const X_RIGHT = 1240
const leftCol = usable.filter((s) => s.x < X_MID).sort((a, b) => a.y - b.y)
const Y_ABCD = leftCol[Math.floor(leftCol.length / 2)].y
console.log(`分界：Y_ABCD=${Y_ABCD}（左欄上下對半）、X_RIGHT=${X_RIGHT}＋GH塊419-442`)
const CORES_JSON = JSON.stringify(CORES)

const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ParkFee 分棟順序工具（B1 電腦選位）</title><style>
 *{box-sizing:border-box}
 body{margin:0;font-family:system-ui,"Microsoft JhengHei",sans-serif;display:flex;height:100vh;overflow:hidden}
 #stage{flex:1;overflow:auto;background:#0f172a;position:relative;user-select:none}
 #wrap{position:relative;width:max-content}
 #plan{display:block;-webkit-user-drag:none}
 svg{position:absolute;inset:0;width:100%;height:100%}
 .seat{cursor:pointer}
 .seat.lk{cursor:not-allowed}
 .seat.lk circle{fill:rgba(100,116,139,.35)!important;stroke:#475569!important;stroke-dasharray:2 2}
 .seat.lk text{fill:#64748b}
 .seat circle{r:7;stroke-width:.7}
 .seat text{font-size:6px;fill:#0f172a;text-anchor:middle;pointer-events:none;user-select:none}
 .seat.ord circle{stroke:#000;stroke-width:1.8}
 .seat.ord text{font-size:8px;font-weight:800;fill:#fff;paint-order:stroke;stroke:#000;stroke-width:1.6}
 .t-AB circle{fill:rgba(220,38,38,.6);stroke:#991b1b}
 .t-CD circle{fill:rgba(37,99,235,.6);stroke:#1e40af}
 .t-EF circle{fill:rgba(22,163,74,.6);stroke:#15803d}
 .t-GH circle{fill:rgba(234,88,12,.65);stroke:#9a3412}
 .core{pointer-events:none}.core circle{stroke:#000;stroke-width:3}.core text{font-size:22px;font-weight:800;fill:#fff;text-anchor:middle;paint-order:stroke;stroke:#000;stroke-width:3}
 #panel{width:270px;flex:none;border-left:1px solid #e2e8f0;padding:14px;overflow:auto;background:#fff}
 h1{font-size:15px;margin:0 0 4px}.sub{font-size:12px;color:#64748b;line-height:1.5;margin:0 0 10px}
 .row{display:flex;gap:6px;margin:6px 0;flex-wrap:wrap}
 button{font-size:13px;padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;cursor:pointer}
 button:hover{background:#eef2f7}button.active{outline:2px solid #0f172a;outline-offset:1px}
 .b-AB{border-color:#991b1b;color:#991b1b}.b-CD{border-color:#1e40af;color:#1e40af}
 .b-EF{border-color:#15803d;color:#15803d}.b-GH{border-color:#9a3412;color:#9a3412}
 .stat{font-size:13px;margin:3px 0;display:flex;justify-content:space-between}
 .dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle}
 kbd{background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;padding:0 4px;font-size:11px}
 hr{border:none;border-top:1px solid #e2e8f0;margin:12px 0}#coord{font-size:11px;color:#94a3b8}
 #list{font-size:11px;color:#475569;line-height:1.6;max-height:160px;overflow:auto;font-family:ui-monospace,monospace}
</style></head><body>
 <div id="stage"><div id="wrap"><img id="plan" src="b1.png" draggable="false">
   <svg id="svg" viewBox="0 0 ${dispW} ${dispH}"></svg></div></div>
 <div id="panel">
   <h1>分棟順序工具（電腦選位）</h1>
   <p class="sub">選棟 → 依「想先配的順序」<b>逐格點選</b>座位（點擊序＝填補序）。<br>
     只需點靠電梯的前幾格，其餘自動用距離補在後面。<br>
     <kbd>a/c/e/g</kbd>切棟　<kbd>點座位</kbd>加入/移除　<kbd>拖曳</kbd>平移　<kbd>Ctrl+滾輪</kbd>縮放</p>
   <div class="row">
     <button class="b-AB" data-t="AB">AB 棟</button>
     <button class="b-CD" data-t="CD">CD 棟</button>
     <button class="b-EF" data-t="EF">EF 棟</button>
     <button class="b-GH" data-t="GH">GH 棟</button>
   </div>
   <div class="stat"><span><span class="dot" style="background:#dc2626"></span>AB 已排</span><b id="n-AB">0</b></div>
   <div class="stat"><span><span class="dot" style="background:#2563eb"></span>CD 已排</span><b id="n-CD">0</b></div>
   <div class="stat"><span><span class="dot" style="background:#16a34a"></span>EF 已排</span><b id="n-EF">0</b></div>
   <div class="stat"><span><span class="dot" style="background:#ea580c"></span>GH 已排</span><b id="n-GH">0</b></div>
   <div class="stat" style="margin-top:6px"><span>目前棟</span><b id="cur">AB</b></div>
   <hr>
   <div class="row"><button id="clearCur">清除本棟順序</button><button id="clearAll">全部清除</button></div>
   <div id="list">—</div>
   <hr>
   <div class="row"><button id="export">⬇ 匯出 tower-priority.json</button></div>
   <p class="sub">存到 <b>d:\\tmp\\tower-priority.json</b> 給 Claude 回灌。</p>
   <div id="coord">—</div>
 </div>
<script>
 const SEATS=${SEATS_JSON}, CORES=${CORES_JSON}, DISPW=${dispW}, DISPH=${dispH};
 const LOCKED=new Set(${LOCKED_JSON}); // 凍結位：灰、不可點、不進順序
 const LS='parkfee_b1_order_v1';
 const NS='http://www.w3.org/2000/svg';
 const TS=['AB','CD','EF','GH'];
 const svg=document.getElementById('svg'),stage=document.getElementById('stage'),plan=document.getElementById('plan');
 const byId={};for(const s of SEATS)byId[s.id]=s;
 function nearest(s){let bn='AB',bd=Infinity;for(const c of CORES){const d=(s.x-c.x)**2+(s.y-c.y)**2;if(d<bd){bd=d;bn=c.name}}return bn}
 // 分區規則（與 build-tower-priority.mjs 一致）：右=GH、中=EF、左欄上(y<900)=AB、左欄下=CD
 function region(s){const n=+s.id;if(n>=419&&n<=442)return 'GH';return s.x>=${X_RIGHT}?'GH':s.x>=${X_MID}?'EF':s.y<${Y_ABCD}?'AB':'CD'}
 let order=(localStorage.getItem(LS)?JSON.parse(localStorage.getItem(LS)):{AB:[],CD:[],EF:[],GH:[]});
 for(const B of TS)if(!Array.isArray(order[B]))order[B]=[];
 for(const B of TS)order[B]=order[B].filter(id=>!LOCKED.has(id)); // 清掉先前誤點的凍結位
 const ordTower={};for(const B of TS)for(const id of order[B])ordTower[id]=B;
 let cur='AB';
 function save(){localStorage.setItem(LS,JSON.stringify(order))}
 const nodes=new Map();
 for(const s of SEATS){const g=document.createElementNS(NS,'g');
   const c=document.createElementNS(NS,'circle');c.setAttribute('cx',s.x);c.setAttribute('cy',s.y);
   const t=document.createElementNS(NS,'text');t.setAttribute('x',s.x);t.setAttribute('y',s.y+2.5);
   g.appendChild(c);g.appendChild(t);svg.appendChild(g);nodes.set(s.id,g);
   if(!LOCKED.has(s.id))g.addEventListener('click',ev=>{ev.stopPropagation();clickSeat(s.id)});}
 for(const c of CORES){const g=document.createElementNS(NS,'g');g.setAttribute('class','core');
   const ci=document.createElementNS(NS,'circle');ci.setAttribute('cx',c.x);ci.setAttribute('cy',c.y);ci.setAttribute('r',24);ci.setAttribute('fill','rgba(15,23,42,.85)');
   const t=document.createElementNS(NS,'text');t.setAttribute('x',c.x);t.setAttribute('y',c.y+7);t.textContent=c.name;
   g.appendChild(ci);g.appendChild(t);svg.appendChild(g);}
 const el=id=>document.getElementById(id);
 function towerOf(id){return ordTower[id]||region(byId[id])}
 function renderSeat(id){const g=nodes.get(id);
   if(LOCKED.has(id)){g.setAttribute('class','seat lk');g.querySelector('text').textContent=id;return}
   const B=towerOf(id);const idx=order[B].indexOf(id);
   g.setAttribute('class','seat t-'+B+(idx>=0?' ord':''));
   g.querySelector('text').textContent=idx>=0?(idx+1):id;}
 function renderAll(){for(const s of SEATS)renderSeat(s.id)}
 function recount(){for(const B of TS)el('n-'+B).textContent=order[B].length;el('cur').textContent=cur;
   el('list').textContent=order[cur].length?(cur+'：'+order[cur].join(' → ')):'（'+cur+' 尚未排，點座位開始）';}
 function clickSeat(id){if(moved>6)return; // 拖曳平移後放開，不算點座位
   const B=ordTower[id];
   if(B===cur){order[cur].splice(order[cur].indexOf(id),1);delete ordTower[id];}
   else{if(B)order[B].splice(order[B].indexOf(id),1);order[cur].push(id);ordTower[id]=cur;}
   save();renderAll();recount();}
 function setCur(t){cur=t;document.querySelectorAll('[data-t]').forEach(b=>b.classList.toggle('active',b.dataset.t===t));recount();}
 // 平移（左鍵直接拖曳；拖>6px 就不觸發點選）+ 縮放（Ctrl+滾輪）
 let zoom=0.62;function applyZoom(){plan.style.width=(DISPW*zoom)+'px'}
 let mode=null,sx,sy,sl,st,moved=0;
 stage.addEventListener('pointerdown',e=>{if(e.button!==0&&e.button!==2)return;
   mode='pan';moved=0;sx=e.clientX;sy=e.clientY;sl=stage.scrollLeft;st=stage.scrollTop;stage.setPointerCapture(e.pointerId);});
 stage.addEventListener('pointermove',e=>{const b=plan.getBoundingClientRect();el('coord').textContent='x:'+((e.clientX-b.left)/b.width*DISPW).toFixed(0)+' y:'+((e.clientY-b.top)/b.height*DISPH).toFixed(0);
   if(mode==='pan'){const dx=e.clientX-sx,dy=e.clientY-sy;moved=Math.max(moved,Math.abs(dx)+Math.abs(dy));stage.scrollLeft=sl-dx;stage.scrollTop=st-dy;}});
 stage.addEventListener('pointerup',()=>{mode=null});
 stage.addEventListener('contextmenu',e=>e.preventDefault());
 stage.addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();zoom=Math.max(0.3,Math.min(3,zoom*(e.deltaY<0?1.1:0.9)));applyZoom();},{passive:false});
 document.querySelectorAll('[data-t]').forEach(b=>b.addEventListener('click',()=>setCur(b.dataset.t)));
 addEventListener('keydown',e=>{const m={a:'AB',c:'CD',e:'EF',g:'GH'};if(m[e.key.toLowerCase()])setCur(m[e.key.toLowerCase()]);});
 el('clearCur').onclick=()=>{for(const id of order[cur])delete ordTower[id];order[cur]=[];save();renderAll();recount();};
 el('clearAll').onclick=()=>{if(!confirm('清除所有棟的順序？'))return;for(const B of TS){for(const id of order[B])delete ordTower[id];order[B]=[]}save();renderAll();recount();};
 el('export').onclick=()=>{const seatTower={},towers={AB:[],CD:[],EF:[],GH:[]};
   for(const B of TS)for(const id of order[B]){towers[B].push(id);seatTower[id]=B;}
   const placed=new Set(Object.keys(seatTower));const rest=SEATS.filter(s=>!placed.has(s.id)&&!LOCKED.has(s.id));
   for(const s of rest)seatTower[s.id]=region(s);
   for(const c of CORES){const rb=rest.filter(s=>seatTower[s.id]===c.name);
     if(c.name==='AB')rb.sort((a,b)=>a.y-b.y||a.x-b.x);           // 上→下
     else if(c.name==='CD')rb.sort((a,b)=>b.y-a.y||a.x-b.x);      // 下→上
     else rb.sort((a,b)=>((a.x-c.x)**2+(a.y-c.y)**2)-((b.x-c.x)**2+(b.y-c.y)**2)); // 靠電梯
     for(const s of rb)towers[c.name].push(s.id);}
   const cores={},counts={};for(const c of CORES)cores[c.name]={x:c.x,y:c.y};for(const B of TS)counts[B]=towers[B].length;
   const out={meta:{generated:'manual-order',note:'手排前段(點擊序)＋距離補後段。棟內順序＝電腦選位填補序。',cores:cores,counts:counts,total:SEATS.length},towers:towers,seatTower:seatTower};
   const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(out)],{type:'application/json'}));a.download='tower-priority.json';a.click();};
 applyZoom();setCur('AB');renderAll();recount();
</script></body></html>`
writeFileSync(`${OUT}/order.html`, html)
console.log(`wrote ${OUT}/order.html — motor(非公益) ${motor.length}, cores AB/CD/EF/GH`)
