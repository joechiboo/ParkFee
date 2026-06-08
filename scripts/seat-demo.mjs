// 選位 demo（B1）：底圖 b1.png + 依車種上色的車位點。
// 點資料來源已改為人工分類後的 ground-truth：src/map/b1-classification.json
//   （機車 655 可點選 / 汽車 55 / 腳踏車 164 / 排除 54 預設隱藏）。
// 底圖 b1.png 仍由 PDF 重算，確保與座標系一致。
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import * as mupdf from 'mupdf'

const OUT = 'public/demo' // 放進 public → 隨 GitHub Pages 部署
mkdirSync(OUT, { recursive: true })

// 1) 底圖：mupdf render B1 平面圖
const dir = 'docs'
const name = readdirSync(dir).find((f) => f.includes('A2-5') || f.includes('平面'))
const page = mupdf.Document.openDocument(readFileSync(`${dir}/${name}`), 'application/pdf').loadPage(0)
writeFileSync(`${OUT}/b1.png`, page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false).asPNG())

// 2) 點：讀分類後的 ground-truth
const cls = JSON.parse(readFileSync('src/map/b1-classification.json', 'utf8'))
const { dispW, dispH } = cls.meta
const seats = cls.seats // {key,id,x,y,cat}

const order = { motor: 0, car: 1, bike: 2, excl: 3 }
const dots = seats
  .slice()
  .sort((a, b) => order[a.cat] - order[b.cat]) // 機車畫最上層
  .map(
    (s) =>
      `<g class="seat cat-${s.cat}" data-id="${s.id}" data-cat="${s.cat}"><circle cx="${s.x}" cy="${s.y}" r="7"/><text x="${s.x}" y="${s.y + 2.5}">${s.id}</text></g>`,
  )
  .join('')

const n = seats.reduce((a, s) => ((a[s.cat] = (a[s.cat] || 0) + 1), a), {})

const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ParkFee 選位 demo（B1）</title><style>
 body{margin:0;font-family:system-ui,"Microsoft JhengHei",sans-serif;display:flex;height:100vh}
 #stage{flex:1;overflow:auto;background:#0f172a;cursor:grab;user-select:none;touch-action:none}
 #stage.grabbing{cursor:grabbing}#wrap{position:relative;width:max-content}
 #plan{display:block;-webkit-user-drag:none}svg{position:absolute;inset:0;width:100%;height:100%}
 .seat text{font-size:6px;text-anchor:middle;pointer-events:none;user-select:none;fill:#0f172a}
 /* 機車：可點選 */
 .cat-motor{cursor:pointer}
 .cat-motor circle{fill:rgba(59,130,246,.45);stroke:#1d4ed8;stroke-width:.7}
 .cat-motor:hover circle{fill:rgba(59,130,246,.75)}
 .cat-motor.sel circle{fill:#ef4444;stroke:#b91c1c}.cat-motor.sel text{fill:#fff;font-weight:700}
 /* 汽車 / 腳踏車：僅參考、不可點 */
 .cat-car circle{fill:rgba(16,185,129,.5);stroke:#047857;stroke-width:.7}.cat-car{pointer-events:none}
 .cat-bike circle{fill:rgba(249,115,22,.55);stroke:#c2410c;stroke-width:.7}.cat-bike{pointer-events:none}
 .cat-excl circle{fill:rgba(148,163,184,.4);stroke:#64748b;stroke-width:.7}.cat-excl{pointer-events:none}
 .hide{display:none}
 #panel{width:240px;border-left:1px solid #e2e8f0;padding:14px;overflow:auto}
 h1{font-size:15px;margin:0 0 8px}.hint{font-size:12px;color:#64748b;line-height:1.5}
 li{font-size:13px}label{font-size:13px;display:flex;align-items:center;gap:6px;margin:7px 0;cursor:pointer}
 .dot{display:inline-block;width:11px;height:11px;border-radius:50%;flex:none}
 .m{background:#3b82f6}.c{background:#10b981}.b{background:#f97316}.x{background:#94a3b8}
 a{font-size:13px;color:#2563eb;text-decoration:none}
</style></head><body>
 <div id="stage"><div id="wrap"><img id="plan" src="b1.png" draggable="false">
   <svg viewBox="0 0 ${dispW} ${dispH}">${dots}</svg></div></div>
 <div id="panel"><a href="../">← 回首頁</a><h1 style="margin-top:6px">選位 demo（B1）</h1>
  <p class="hint">真實 B1 平面圖。<b>機車位可點選</b>（${n.motor} 個，藍）；汽車/腳踏車為參考。<br><b>按住拖曳平移</b>，Ctrl+滾輪縮放。</p>
  <label><input type="checkbox" data-cat="motor" checked><span class="dot m"></span>機車 ${n.motor}</label>
  <label><input type="checkbox" data-cat="car"><span class="dot c"></span>汽車 ${n.car || 0}</label>
  <label><input type="checkbox" data-cat="bike"><span class="dot b"></span>腳踏車 ${n.bike || 0}</label>
  <label><input type="checkbox" data-cat="excl"><span class="dot x"></span>排除（雜訊）${n.excl || 0}</label>
  <hr>
  <div>已選機車位 <b id="count">0</b></div><ul id="picked"></ul></div>
<script>
 // 拖曳平移（拖動超過門檻不觸發選位）
 const stage=document.getElementById('stage')
 let down=false,moved=false,sx,sy,sl,st
 stage.addEventListener('pointerdown',e=>{down=true;moved=false;sx=e.clientX;sy=e.clientY;sl=stage.scrollLeft;st=stage.scrollTop;stage.classList.add('grabbing')})
 window.addEventListener('pointermove',e=>{if(!down)return;const dx=e.clientX-sx,dy=e.clientY-sy;if(Math.abs(dx)>4||Math.abs(dy)>4)moved=true;stage.scrollLeft=sl-dx;stage.scrollTop=st-dy})
 window.addEventListener('pointerup',()=>{down=false;stage.classList.remove('grabbing')})
 // 只允許點選機車
 const picked=new Set()
 document.querySelectorAll('.cat-motor').forEach(g=>g.addEventListener('click',()=>{if(moved)return;const id=g.dataset.id;g.classList.toggle('sel');picked.has(id)?picked.delete(id):picked.add(id);count.textContent=picked.size;document.getElementById('picked').innerHTML=[...picked].map(x=>'<li>機車位 '+x+'</li>').join('')}))
 // 車種顯示開關
 const initHidden={car:true,bike:true,excl:true}
 document.querySelectorAll('[data-cat]').forEach(cb=>{const c=cb.dataset.cat;const apply=()=>document.querySelectorAll('.cat-'+c).forEach(g=>g.classList.toggle('hide',!cb.checked));if(initHidden[c]){cb.checked=false}apply();cb.addEventListener('change',apply)})
</script></body></html>`
writeFileSync(`${OUT}/seat-select-demo.html`, html)
console.log(`wrote ${OUT}/seat-select-demo.html — 機車 ${n.motor} / 汽車 ${n.car} / 腳踏車 ${n.bike} / 排除 ${n.excl}`)
