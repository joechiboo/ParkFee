// 重建「平面圖 + 可點車位」demo：底圖 b1.png + 標註座標(transform B) 疊可點選車位點。
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import * as mupdf from 'mupdf'

const dispW = 2384
const dispH = 1684
const OUT = 'public/demo' // 放進 public → 隨 GitHub Pages 部署，公開可玩

const dir = 'docs'
const name = readdirSync(dir).find((f) => f.includes('A2-5') || f.includes('平面'))
const data = readFileSync(`${dir}/${name}`)

// 確保底圖存在（mupdf render）
mkdirSync(OUT, { recursive: true })
const page = mupdf.Document.openDocument(data, 'application/pdf').loadPage(0)
writeFileSync(`${OUT}/b1.png`, page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false).asPNG())

// 從 PDF 的 Square 標註抽出數字編號 + /Rect 座標
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
for (const m of raw.matchAll(blockRe)) {
  const t = decode(m[5])
  if (!/^\d{1,3}$/.test(t)) continue
  const [x1, y1, x2, y2] = m.slice(1, 5).map(Number)
  const x = (x1 + x2) / 2
  const y = (y1 + y2) / 2
  // transform D：x'=dispW-y, y'=dispH-x（C 的垂直翻轉，修正上下顛倒）
  seats.push({ id: t, x: +(dispW - y).toFixed(1), y: +(dispH - x).toFixed(1) })
}

const dots = seats
  .map((s) => `<g class="seat" data-id="${s.id}"><circle cx="${s.x}" cy="${s.y}" r="7"/><text x="${s.x}" y="${s.y + 2.5}">${s.id}</text></g>`)
  .join('')

const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<title>ParkFee 選位 demo（B1）</title><style>
 body{margin:0;font-family:system-ui,"Microsoft JhengHei",sans-serif;display:flex;height:100vh}
 #stage{flex:1;overflow:auto;background:#0f172a;cursor:grab;user-select:none;touch-action:none}
 #stage.grabbing{cursor:grabbing}#wrap{position:relative;width:max-content}
 #plan{display:block;-webkit-user-drag:none}svg{position:absolute;inset:0;width:100%;height:100%}
 .seat{cursor:pointer}.seat circle{fill:rgba(59,130,246,.4);stroke:#1d4ed8;stroke-width:.7}
 .seat text{font-size:6px;fill:#0f172a;text-anchor:middle;pointer-events:none;user-select:none}
 .seat:hover circle{fill:rgba(59,130,246,.7)}
 .seat.sel circle{fill:#ef4444;stroke:#b91c1c}.seat.sel text{fill:#fff;font-weight:700}
 #panel{width:240px;border-left:1px solid #e2e8f0;padding:12px;overflow:auto}
 h1{font-size:15px;margin:0 0 8px}.hint{font-size:12px;color:#64748b;line-height:1.5}
 li{font-size:13px}label{font-size:13px;display:block;margin:8px 0}
</style></head><body>
 <div id="stage"><div id="wrap"><img id="plan" src="b1.png" draggable="false"><svg viewBox="0 0 ${dispW} ${dispH}">${dots}</svg></div></div>
 <div id="panel"><a href="../" style="font-size:13px;color:#2563eb;text-decoration:none">← 回首頁</a><h1 style="margin-top:6px">選位 demo（B1）</h1>
  <p class="hint">真實 B1 平面圖 + ${seats.length} 個車位編號(自動放點，含汽/機/自行車與部分尺寸標註，尚未分類)。點選＝高亮/取消；<b>按住拖曳平移</b>，Ctrl+滾輪縮放。</p>
  <label><input type="checkbox" id="show" checked> 顯示車位點</label>
  <div>已選 <b id="count">0</b></div><ul id="picked"></ul></div>
<script>
 // 拖曳平移（拖動超過門檻不觸發選位）
 const stage=document.getElementById('stage')
 let down=false,moved=false,sx,sy,sl,st
 stage.addEventListener('pointerdown',e=>{down=true;moved=false;sx=e.clientX;sy=e.clientY;sl=stage.scrollLeft;st=stage.scrollTop;stage.classList.add('grabbing')})
 window.addEventListener('pointermove',e=>{if(!down)return;const dx=e.clientX-sx,dy=e.clientY-sy;if(Math.abs(dx)>4||Math.abs(dy)>4)moved=true;stage.scrollLeft=sl-dx;stage.scrollTop=st-dy})
 window.addEventListener('pointerup',()=>{down=false;stage.classList.remove('grabbing')})
 const picked=new Set()
 document.querySelectorAll('.seat').forEach(g=>g.addEventListener('click',()=>{if(moved)return;const id=g.dataset.id;g.classList.toggle('sel');picked.has(id)?picked.delete(id):picked.add(id);count.textContent=picked.size;document.getElementById('picked').innerHTML=[...picked].map(x=>'<li>車位 '+x+'</li>').join('')}))
 show.addEventListener('change',e=>document.querySelector('svg').style.display=e.target.checked?'':'none')
</script></body></html>`
writeFileSync(`${OUT}/seat-select-demo.html`, html)
console.log(`wrote ${OUT}/seat-select-demo.html, seats ${seats.length}`)
