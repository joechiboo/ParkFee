// 棟別指定工具：655 個機車位塗上 AB/CD/EF/GH 棟。
// 預設用「最近梯廳核心」種好，使用者框選微調分界。匯出 tower 指定 JSON。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const OUT = 'public/demo'
mkdirSync(OUT, { recursive: true })
const cls = JSON.parse(readFileSync('src/map/b1-classification.json', 'utf8'))
const { dispW, dispH } = cls.meta
const motor = cls.seats.filter((s) => s.cat === 'motor').map((s) => ({ id: s.id, x: s.x, y: s.y }))

const CORES = [
  { name: 'AB', x: 581, y: 424 },
  { name: 'CD', x: 563, y: 1168 },
  { name: 'EF', x: 1102, y: 1375 },
  { name: 'GH', x: 1378, y: 1375 },
]
const SEATS_JSON = JSON.stringify(motor)
const CORES_JSON = JSON.stringify(CORES)

const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ParkFee 棟別指定工具（B1）</title><style>
 *{box-sizing:border-box}
 body{margin:0;font-family:system-ui,"Microsoft JhengHei",sans-serif;display:flex;height:100vh;overflow:hidden}
 #stage{flex:1;overflow:auto;background:#0f172a;position:relative;user-select:none}
 #wrap{position:relative;width:max-content}
 #plan{display:block;-webkit-user-drag:none}
 svg{position:absolute;inset:0;width:100%;height:100%}
 .seat circle{r:7;stroke-width:.7}
 .seat text{font-size:6px;fill:#0f172a;text-anchor:middle;pointer-events:none;user-select:none}
 .seat.sel circle{stroke:#000;stroke-width:2.5}
 .t-AB circle{fill:rgba(220,38,38,.6);stroke:#991b1b}
 .t-CD circle{fill:rgba(37,99,235,.6);stroke:#1e40af}
 .t-EF circle{fill:rgba(22,163,74,.6);stroke:#15803d}
 .t-GH circle{fill:rgba(234,88,12,.65);stroke:#9a3412}
 .core{pointer-events:none}.core circle{stroke:#000;stroke-width:3}.core text{font-size:22px;font-weight:800;fill:#fff;text-anchor:middle;paint-order:stroke;stroke:#000;stroke-width:3}
 #band{position:fixed;border:1.5px dashed #38bdf8;background:rgba(56,189,248,.12);pointer-events:none;display:none;z-index:9}
 #panel{width:250px;flex:none;border-left:1px solid #e2e8f0;padding:14px;overflow:auto;background:#fff}
 h1{font-size:15px;margin:0 0 4px}.sub{font-size:12px;color:#64748b;line-height:1.5;margin:0 0 10px}
 .row{display:flex;gap:6px;margin:6px 0;flex-wrap:wrap}
 button{font-size:13px;padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;cursor:pointer}
 button:hover{background:#eef2f7}
 .b-AB{border-color:#991b1b;color:#991b1b}.b-CD{border-color:#1e40af;color:#1e40af}
 .b-EF{border-color:#15803d;color:#15803d}.b-GH{border-color:#9a3412;color:#9a3412}
 .stat{font-size:13px;margin:3px 0;display:flex;justify-content:space-between}
 .dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle}
 kbd{background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;padding:0 4px;font-size:11px}
 hr{border:none;border-top:1px solid #e2e8f0;margin:12px 0}#coord{font-size:11px;color:#94a3b8}
</style></head><body>
 <div id="stage"><div id="wrap"><img id="plan" src="b1.png" draggable="false">
   <svg id="svg" viewBox="0 0 ${dispW} ${dispH}"></svg></div><div id="band"></div></div>
 <div id="panel">
   <h1>棟別指定工具（B1）</h1>
   <p class="sub">框選機車位→指定棟別。預設已用最近核心種好。<br>
     <kbd>左鍵拖曳</kbd>框選　<kbd>Shift</kbd>加選<br>
     <kbd>空白/右鍵+拖曳</kbd>平移　<kbd>Ctrl+滾輪</kbd>縮放</p>
   <div class="row">
     <button class="b-AB" data-t="AB">AB 棟</button>
     <button class="b-CD" data-t="CD">CD 棟</button>
     <button class="b-EF" data-t="EF">EF 棟</button>
     <button class="b-GH" data-t="GH">GH 棟</button>
   </div>
   <div class="row"><button id="clearSel">清除選取 (Esc)</button></div>
   <hr>
   <div class="stat"><span><span class="dot" style="background:#dc2626"></span>AB 棟</span><b id="n-AB">0</b></div>
   <div class="stat"><span><span class="dot" style="background:#2563eb"></span>CD 棟</span><b id="n-CD">0</b></div>
   <div class="stat"><span><span class="dot" style="background:#16a34a"></span>EF 棟</span><b id="n-EF">0</b></div>
   <div class="stat"><span><span class="dot" style="background:#ea580c"></span>GH 棟</span><b id="n-GH">0</b></div>
   <div class="stat" style="margin-top:6px"><span>已選取</span><b id="n-sel">0</b></div>
   <div class="stat"><span>合計</span><b id="n-all">0</b> / 655</div>
   <p class="sub" style="margin-top:4px">目標參考：AB·CD≈230、EF·GH≈130</p>
   <hr>
   <div class="row"><button id="export">⬇ 匯出 JSON</button><button id="reseed">重套最近核心</button></div>
   <div id="coord">—</div>
 </div>
<script>
 const SEATS=${SEATS_JSON}, CORES=${CORES_JSON}, DISPW=${dispW}, DISPH=${dispH};
 const LS='parkfee_b1_tower_v1';
 const NS='http://www.w3.org/2000/svg';
 const svg=document.getElementById('svg'),stage=document.getElementById('stage'),band=document.getElementById('band'),plan=document.getElementById('plan');
 function nearest(s){let bn='AB',bd=Infinity;for(const c of CORES){const d=(s.x-c.x)**2+(s.y-c.y)**2;if(d<bd){bd=d;bn=c.name}}return bn}
 let tw=localStorage.getItem(LS)?JSON.parse(localStorage.getItem(LS)):(()=>{const o={};for(const s of SEATS)o[s.id]=nearest(s);return o})();
 localStorage.setItem(LS,JSON.stringify(tw));
 const sel=new Set(),nodes=new Map();
 for(const s of SEATS){const g=document.createElementNS(NS,'g');g.setAttribute('class','seat t-'+tw[s.id]);
   const c=document.createElementNS(NS,'circle');c.setAttribute('cx',s.x);c.setAttribute('cy',s.y);
   const t=document.createElementNS(NS,'text');t.setAttribute('x',s.x);t.setAttribute('y',s.y+2.5);t.textContent=s.id;
   g.appendChild(c);g.appendChild(t);svg.appendChild(g);nodes.set(s.id,g);}
 for(const c of CORES){const g=document.createElementNS(NS,'g');g.setAttribute('class','core');
   const ci=document.createElementNS(NS,'circle');ci.setAttribute('cx',c.x);ci.setAttribute('cy',c.y);ci.setAttribute('r',24);ci.setAttribute('fill','rgba(15,23,42,.85)');
   const t=document.createElementNS(NS,'text');t.setAttribute('x',c.x);t.setAttribute('y',c.y+7);t.textContent=c.name;
   g.appendChild(ci);g.appendChild(t);svg.appendChild(g);}
 const el=id=>document.getElementById(id);
 function recount(){const n={AB:0,CD:0,EF:0,GH:0};for(const s of SEATS)n[tw[s.id]]++;
   el('n-AB').textContent=n.AB;el('n-CD').textContent=n.CD;el('n-EF').textContent=n.EF;el('n-GH').textContent=n.GH;
   el('n-sel').textContent=sel.size;el('n-all').textContent=n.AB+n.CD+n.EF+n.GH;}
 function setSel(id,on){const g=nodes.get(id);if(!g)return;if(on){sel.add(id);g.classList.add('sel')}else{sel.delete(id);g.classList.remove('sel')}}
 function clearSel(){for(const k of [...sel])setSel(k,false);recount()}
 function apply(t){if(!sel.size)return;for(const id of sel){tw[id]=t;nodes.get(id).setAttribute('class','seat sel t-'+t)}localStorage.setItem(LS,JSON.stringify(tw));recount()}
 function toPlan(cx,cy){const b=plan.getBoundingClientRect();return{x:(cx-b.left)/b.width*DISPW,y:(cy-b.top)/b.height*DISPH}}
 let space=false;addEventListener('keydown',e=>{if(e.code==='Space'){space=true;stage.style.cursor='grab'}});
 addEventListener('keyup',e=>{if(e.code==='Space'){space=false;stage.style.cursor=''}});
 let mode=null,sx,sy,sl,st,startCX,startCY;
 stage.addEventListener('pointerdown',e=>{const pan=space||e.button===2;
   if(pan){mode='pan';sx=e.clientX;sy=e.clientY;sl=stage.scrollLeft;st=stage.scrollTop;stage.setPointerCapture(e.pointerId);e.preventDefault();return}
   if(e.button!==0)return;mode='band';startCX=e.clientX;startCY=e.clientY;if(!e.shiftKey)clearSel();
   band.style.display='block';band.style.left=e.clientX+'px';band.style.top=e.clientY+'px';band.style.width='0';band.style.height='0';stage.setPointerCapture(e.pointerId);});
 stage.addEventListener('pointermove',e=>{const p=toPlan(e.clientX,e.clientY);el('coord').textContent='x:'+p.x.toFixed(0)+' y:'+p.y.toFixed(0);
   if(mode==='pan'){stage.scrollLeft=sl-(e.clientX-sx);stage.scrollTop=st-(e.clientY-sy);return}if(mode!=='band')return;
   band.style.left=Math.min(startCX,e.clientX)+'px';band.style.top=Math.min(startCY,e.clientY)+'px';band.style.width=Math.abs(e.clientX-startCX)+'px';band.style.height=Math.abs(e.clientY-startCY)+'px';
   const a=toPlan(startCX,startCY);const x0=Math.min(a.x,p.x),x1=Math.max(a.x,p.x),y0=Math.min(a.y,p.y),y1=Math.max(a.y,p.y);
   for(const s of SEATS)if(s.x>=x0&&s.x<=x1&&s.y>=y0&&s.y<=y1)setSel(s.id,true);recount();});
 stage.addEventListener('pointerup',()=>{if(mode==='band')band.style.display='none';mode=null;recount();});
 stage.addEventListener('contextmenu',e=>e.preventDefault());
 stage.addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();const k=e.deltaY<0?1.1:0.9;const r=stage.getBoundingClientRect();
   const ox=(stage.scrollLeft+e.clientX-r.left),oy=(stage.scrollTop+e.clientY-r.top);const cw=document.getElementById('wrap');
   const cur=parseFloat(cw.style.width)||cw.offsetWidth;},{passive:false});
 document.querySelectorAll('[data-t]').forEach(b=>b.addEventListener('click',()=>apply(b.dataset.t)));
 el('clearSel').onclick=clearSel;
 addEventListener('keydown',e=>{if(e.target.tagName==='INPUT')return;const m={a:'AB',c:'CD',e:'EF',g:'GH'};if(m[e.key.toLowerCase()])apply(m[e.key.toLowerCase()]);if(e.key==='Escape')clearSel();});
 el('reseed').onclick=()=>{if(!confirm('用最近核心重新指定？會覆蓋手動調整。'))return;tw={};for(const s of SEATS)tw[s.id]=nearest(s);for(const s of SEATS)nodes.get(s.id).setAttribute('class','seat t-'+tw[s.id]);sel.clear();localStorage.setItem(LS,JSON.stringify(tw));recount();};
 el('export').onclick=()=>{const n={AB:0,CD:0,EF:0,GH:0};for(const s of SEATS)n[tw[s.id]]++;
   const out={meta:{floor:'B1',cores:CORES,total:SEATS.length},counts:n,seats:SEATS.map(s=>({id:s.id,x:s.x,y:s.y,tower:tw[s.id]}))};
   const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(out,null,2)],{type:'application/json'}));a.download='b1-towers.json';a.click();};
 recount();
</script></body></html>`
writeFileSync(`${OUT}/towers.html`, html)
console.log(`wrote ${OUT}/towers.html — motor ${motor.length}, cores AB/CD/EF/GH`)
