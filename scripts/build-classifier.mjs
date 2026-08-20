// 產生「車位分類工具」：B1 底圖 + 928 個自動抽出的點，
// 讓使用者框選→標記車種（機車/汽車/腳踏車/排除），匯出 ground-truth JSON。
// 點位抽法與座標轉換與 seat-demo.mjs 完全一致，確保兩邊對得起來。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import * as mupdf from 'mupdf'
import { BASE_PDF, renderBaseMap } from './lib/basemap.mjs'

const dispW = 2384
const dispH = 1684
const OUT = 'public/demo'

const data = readFileSync(BASE_PDF)

mkdirSync(OUT, { recursive: true })
const page = mupdf.Document.openDocument(data, 'application/pdf').loadPage(0)
renderBaseMap(`${OUT}/b1.png`)

const raw = data.toString('latin1')
const blockRe = /\/Subtype\s*\/Square\s*\/Rect\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\][^>]*?\/Contents\s*(<[0-9a-fA-F]*>|\([^)]*\))/g
const decode = (s) => {
  if (s.startsWith('<')) {
    let hex = s.slice(1, -1)
    if (hex.toLowerCase().startsWith('feff')) hex = hex.slice(4)
    let o = ''
    for (let i = 0; i + 3 < hex.length + 1; i += 4) o += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16))
    return o
  }
  return s.slice(1, -1)
}
const seats = []
let idx = 0
for (const m of raw.matchAll(blockRe)) {
  const t = decode(m[5])
  if (!/^\d{1,3}$/.test(t)) continue
  const [x1, y1, x2, y2] = m.slice(1, 5).map(Number)
  const x = (x1 + x2) / 2
  const y = (y1 + y2) / 2
  seats.push({ key: idx++, id: t, x: +(dispW - y).toFixed(1), y: +(dispH - x).toFixed(1) })
}

writeFileSync(`${OUT}/seats.json`, JSON.stringify(seats))

// 預設分類 zones（矩形規則，後者覆蓋前者）。點未落任何 zone → 機車。
// 這是「先幫你分好、再微調」的起點；座標可在 render-classified.mjs 調整後同步。
const DEFAULT_ZONES = [
  { cat: 'excl', x1: 900, y1: 0, x2: 2384, y2: 540 },     // 右上 細部剖面圖
  { cat: 'excl', x1: 1850, y1: 0, x2: 2384, y2: 1684 },   // 右側 標題欄
  { cat: 'excl', x1: 1640, y1: 1040, x2: 2010, y2: 1320 },// 右下 圖例
  { cat: 'excl', x1: 200, y1: 1520, x2: 1850, y2: 1684 }, // 最底 尺寸線/道路
  { cat: 'car', x1: 1430, y1: 1040, x2: 1660, y2: 1390 }, // 汽車區
  { cat: 'bike', x1: 620, y1: 550, x2: 1310, y2: 1140 },  // 腳踏車區（中）
  { cat: 'bike', x1: 400, y1: 340, x2: 800, y2: 580 },    // 腳踏車區（左上）
]

const SEATS_JSON = JSON.stringify(seats)
const ZONES_JSON = JSON.stringify(DEFAULT_ZONES)
const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ParkFee 車位分類工具（B1）</title><style>
 *{box-sizing:border-box}
 body{margin:0;font-family:system-ui,"Microsoft JhengHei",sans-serif;display:flex;height:100vh;overflow:hidden}
 #stage{flex:1;overflow:auto;background:#0f172a;position:relative;user-select:none}
 #wrap{position:relative;width:max-content;transform-origin:0 0}
 #plan{display:block;-webkit-user-drag:none}
 svg{position:absolute;inset:0;width:100%;height:100%}
 .seat circle{r:7;stroke-width:.7}
 .seat text{font-size:6px;fill:#0f172a;text-anchor:middle;pointer-events:none;user-select:none}
 .seat.sel circle{stroke:#000;stroke-width:2.5}
 .cat-motor circle{fill:rgba(59,130,246,.55);stroke:#1d4ed8}      /* 機車 藍 */
 .cat-car   circle{fill:rgba(16,185,129,.6);stroke:#047857}       /* 汽車 綠 */
 .cat-bike  circle{fill:rgba(249,115,22,.65);stroke:#c2410c}      /* 腳踏車 橘 */
 .cat-excl  circle{fill:rgba(148,163,184,.35);stroke:#64748b}     /* 排除 灰 */
 #band{position:fixed;border:1.5px dashed #38bdf8;background:rgba(56,189,248,.12);pointer-events:none;display:none;z-index:9}
 #panel{width:260px;flex:none;border-left:1px solid #e2e8f0;padding:14px;overflow:auto;background:#fff}
 h1{font-size:15px;margin:0 0 4px}.sub{font-size:12px;color:#64748b;line-height:1.5;margin:0 0 10px}
 .row{display:flex;gap:6px;margin:6px 0;flex-wrap:wrap}
 button{font-size:13px;padding:6px 9px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;cursor:pointer}
 button:hover{background:#eef2f7}
 .b-motor{border-color:#1d4ed8;color:#1d4ed8}.b-car{border-color:#047857;color:#047857}
 .b-bike{border-color:#c2410c;color:#c2410c}.b-excl{border-color:#64748b;color:#475569}
 .stat{font-size:13px;margin:3px 0;display:flex;justify-content:space-between}
 .dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle}
 kbd{background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;padding:0 4px;font-size:11px}
 hr{border:none;border-top:1px solid #e2e8f0;margin:12px 0}
 #coord{font-size:11px;color:#94a3b8;font-variant-numeric:tabular-nums}
</style></head><body>
 <div id="stage"><div id="wrap"><img id="plan" src="b1.png" draggable="false">
   <svg id="svg" viewBox="0 0 ${dispW} ${dispH}"></svg></div><div id="band"></div></div>
 <div id="panel">
   <h1>車位分類工具（B1）</h1>
   <p class="sub">框選一區，再按車種把選取點分類。<br>
     <kbd>左鍵拖曳</kbd>框選　<kbd>Shift</kbd>加選<br>
     <kbd>空白鍵+拖曳</kbd>或<kbd>右鍵拖曳</kbd>平移<br>
     <kbd>Ctrl+滾輪</kbd>縮放</p>
   <div class="row">
     <button class="b-motor" data-cat="motor">機車 (M)</button>
     <button class="b-car" data-cat="car">汽車 (C)</button>
     <button class="b-bike" data-cat="bike">腳踏車 (B)</button>
     <button class="b-excl" data-cat="excl">排除 (X)</button>
   </div>
   <div class="row"><button id="clearSel">清除選取 (Esc)</button><button id="selExcl">選同類:排除</button></div>
   <hr>
   <div class="stat"><span><span class="dot" style="background:#3b82f6"></span>機車</span><b id="n-motor">0</b></div>
   <div class="stat"><span><span class="dot" style="background:#10b981"></span>汽車</span><b id="n-car">0</b></div>
   <div class="stat"><span><span class="dot" style="background:#f97316"></span>腳踏車</span><b id="n-bike">0</b></div>
   <div class="stat"><span><span class="dot" style="background:#94a3b8"></span>排除</span><b id="n-excl">0</b></div>
   <div class="stat" style="margin-top:6px"><span>已選取</span><b id="n-sel">0</b></div>
   <div class="stat"><span>機車目標</span><b>655</b></div>
   <hr>
   <div class="row">
     <button id="export">⬇ 匯出 JSON</button>
     <button id="reseed">重套預設分類</button>
     <button id="reset">全部設機車</button>
   </div>
   <p class="sub" style="margin-top:10px">進度自動存於瀏覽器，重新整理不會遺失。匯出檔給開發接手。</p>
   <div id="coord">—</div>
 </div>
<script>
 const SEATS = ${SEATS_JSON};
 const ZONES = ${ZONES_JSON};
 const DISPW = ${dispW}, DISPH = ${dispH};
 const LS = 'parkfee_b1_class_v2';
 function zoneCat(s){let c='motor';for(const z of ZONES)if(s.x>=z.x1&&s.x<=z.x2&&s.y>=z.y1&&s.y<=z.y2)c=z.cat;return c}
 function seedDefault(){const o={};for(const s of SEATS){const c=zoneCat(s);if(c!=='motor')o[s.key]=c}return o}
 const svg = document.getElementById('svg');
 const stage = document.getElementById('stage');
 const wrap = document.getElementById('wrap');
 const band = document.getElementById('band');
 const NS = 'http://www.w3.org/2000/svg';
 // 首次開啟（無存檔）→ 用 zones 預設分類當起點
 let cls = localStorage.getItem(LS) ? JSON.parse(localStorage.getItem(LS)) : seedDefault();
 localStorage.setItem(LS, JSON.stringify(cls));
 const sel = new Set();
 const nodes = new Map();

 function catClass(c){return c==='car'?'cat-car':c==='bike'?'cat-bike':c==='excl'?'cat-excl':'cat-motor'}
 for(const s of SEATS){
   const g=document.createElementNS(NS,'g'); g.setAttribute('class','seat '+catClass(cls[s.key]||'motor'));
   const c=document.createElementNS(NS,'circle'); c.setAttribute('cx',s.x); c.setAttribute('cy',s.y);
   const t=document.createElementNS(NS,'text'); t.setAttribute('x',s.x); t.setAttribute('y',s.y+2.5); t.textContent=s.id;
   g.appendChild(c); g.appendChild(t); svg.appendChild(g); nodes.set(s.key,g);
 }

 function recount(){
   const n={motor:0,car:0,bike:0,excl:0};
   for(const s of SEATS) n[cls[s.key]||'motor']++;
   n_motor.textContent=n.motor; n_car.textContent=n.car; n_bike.textContent=n.bike; n_excl.textContent=n.excl;
   n_sel.textContent=sel.size;
 }
 const $=id=>document.getElementById(id.replace('-','_'));
 const n_motor=document.getElementById('n-motor'),n_car=document.getElementById('n-car'),
       n_bike=document.getElementById('n-bike'),n_excl=document.getElementById('n-excl'),n_sel=document.getElementById('n-sel');

 function setSel(key,on){const g=nodes.get(key); if(!g)return; if(on){sel.add(key);g.classList.add('sel')}else{sel.delete(key);g.classList.remove('sel')}}
 function clearSel(){for(const k of [...sel])setSel(k,false); recount()}
 function applyCat(cat){ if(!sel.size)return; for(const k of sel){cls[k]=cat; const g=nodes.get(k); g.setAttribute('class','seat sel '+catClass(cat));}
   localStorage.setItem(LS,JSON.stringify(cls)); recount(); }

 // 縮放
 let scale=1;
 function applyScale(){wrap.style.transform='scale('+scale+')'}
 stage.addEventListener('wheel',e=>{ if(!e.ctrlKey)return; e.preventDefault();
   const old=scale; scale=Math.min(4,Math.max(.25, scale*(e.deltaY<0?1.1:0.9)));
   const r=stage.getBoundingClientRect(); const ox=(stage.scrollLeft+e.clientX-r.left)/old, oy=(stage.scrollTop+e.clientY-r.top)/old;
   applyScale(); stage.scrollLeft=ox*scale-(e.clientX-r.left); stage.scrollTop=oy*scale-(e.clientY-r.top);
 },{passive:false});

 // 平移（空白鍵或右鍵）/ 框選（左鍵）
 let space=false; addEventListener('keydown',e=>{if(e.code==='Space'){space=true;stage.style.cursor='grab'}});
 addEventListener('keyup',e=>{if(e.code==='Space'){space=false;stage.style.cursor=''}});
 // 直接用底圖實際螢幕矩形換算圖面座標 → 自動吃掉縮放/捲動/2倍比例
 const plan=document.getElementById('plan');
 function toPlan(cx,cy){const b=plan.getBoundingClientRect();return{x:(cx-b.left)/b.width*DISPW,y:(cy-b.top)/b.height*DISPH}}
 let mode=null,sx,sy,sl,st,startCX,startCY;
 stage.addEventListener('pointerdown',e=>{
   const pan = space || e.button===2;
   if(pan){mode='pan';sx=e.clientX;sy=e.clientY;sl=stage.scrollLeft;st=stage.scrollTop;stage.setPointerCapture(e.pointerId);e.preventDefault();return}
   if(e.button!==0)return;
   mode='band'; startCX=e.clientX; startCY=e.clientY;
   if(!e.shiftKey)clearSel();
   band.style.display='block'; band.style.left=e.clientX+'px'; band.style.top=e.clientY+'px'; band.style.width='0'; band.style.height='0';
   stage.setPointerCapture(e.pointerId);
 });
 stage.addEventListener('pointermove',e=>{
   const p=toPlan(e.clientX,e.clientY);
   document.getElementById('coord').textContent='x:'+p.x.toFixed(0)+'  y:'+p.y.toFixed(0);
   if(mode==='pan'){stage.scrollLeft=sl-(e.clientX-sx);stage.scrollTop=st-(e.clientY-sy);return}
   if(mode!=='band')return;
   band.style.left=Math.min(startCX,e.clientX)+'px'; band.style.top=Math.min(startCY,e.clientY)+'px';
   band.style.width=Math.abs(e.clientX-startCX)+'px'; band.style.height=Math.abs(e.clientY-startCY)+'px';
   const a=toPlan(startCX,startCY);
   const x0=Math.min(a.x,p.x),x1=Math.max(a.x,p.x),y0=Math.min(a.y,p.y),y1=Math.max(a.y,p.y);
   for(const s of SEATS){if(s.x>=x0&&s.x<=x1&&s.y>=y0&&s.y<=y1)setSel(s.key,true);}
   recount();
 });
 stage.addEventListener('pointerup',e=>{ if(mode==='band'){band.style.display='none'} mode=null; recount(); });
 stage.addEventListener('contextmenu',e=>e.preventDefault());

 document.querySelectorAll('[data-cat]').forEach(b=>b.addEventListener('click',()=>applyCat(b.dataset.cat)));
 document.getElementById('clearSel').onclick=clearSel;
 document.getElementById('selExcl').onclick=()=>{ // 把目前選取裡同 id 的全選（少用，保留鈎子）
   recount(); };
 addEventListener('keydown',e=>{
   if(e.target.tagName==='INPUT')return;
   const m={m:'motor',c:'car',b:'bike',x:'excl'}; if(m[e.key]){applyCat(m[e.key])}
   if(e.key==='Escape')clearSel();
 });
 document.getElementById('export').onclick=()=>{
   const out={meta:{dispW:DISPW,dispH:DISPH,total:SEATS.length,generated:'b1-A2-5'},
     counts:{motor:+n_motor.textContent,car:+n_car.textContent,bike:+n_bike.textContent,excl:+n_excl.textContent},
     seats:SEATS.map(s=>({key:s.key,id:s.id,x:s.x,y:s.y,cat:cls[s.key]||'motor'}))};
   const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'});
   const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='b1-classification.json'; a.click();
 };
 function repaint(){for(const [k,g] of nodes)g.setAttribute('class','seat '+catClass(cls[k]||'motor')); sel.clear(); localStorage.setItem(LS,JSON.stringify(cls)); recount();}
 document.getElementById('reseed').onclick=()=>{ if(!confirm('用預設 zones 重新分類？會覆蓋你的手動調整。'))return; cls=seedDefault(); repaint(); };
 document.getElementById('reset').onclick=()=>{ if(!confirm('全部設為機車（清空分類）？'))return; cls={}; repaint(); };
 recount();
</script></body></html>`
writeFileSync(`${OUT}/classify.html`, html)
console.log(`wrote ${OUT}/classify.html + seats.json, seats ${seats.length}`)
