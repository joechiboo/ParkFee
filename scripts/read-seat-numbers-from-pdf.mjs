// 讀出竣工圖每個車位記號裡印的號碼。
// 圖上的數字是向量線段不是文字，抽不出 text；但同一個數字的字形完全一致，
// 因此把記號內的小路徑依 x 分組成「數字槽」，正規化後當指紋，
// 再用「位置無爭議」的車位當樣本學出 指紋->數字 對照表。
// 驗證：655 個機車位記號讀出來的號碼集合必須剛好是 1..655。
// 用法: node scripts/read-seat-numbers-from-pdf.mjs <paths.json> [out.json]
import fs from 'fs'

const S = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const isTri = s => s.curves === 0 && s.lines === 3 && s.w > 9.8 && s.w < 10.8 && s.h > 8.4 && s.h < 9.4
const isEll = s => s.curves === 0 && s.lines === 28 && s.w > 10.8 && s.w < 11.8 && s.h > 7.4 && s.h < 8.4
const marks = [
  ...S.filter(isTri).map(s => ({ shape: 'small', x: s.x, y: s.y, w: s.w, h: s.h, dy: 1.5, self: s })),
  ...S.filter(isEll).map(s => ({ shape: 'motor', x: s.x, y: s.y, w: s.w, h: s.h, dy: 0, self: s })),
]
console.log(`機車位記號 ${marks.length}（三角形 ${marks.filter(m => m.shape === 'small').length} / 橢圓 ${marks.filter(m => m.shape === 'motor').length}）`)

// 正規化路徑指紋
function pathSig(s) {
  const p = s.pts
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9
  for (let i = 0; i < p.length; i += 2) {
    if (p[i] < minX) minX = p[i]; if (p[i] > maxX) maxX = p[i]
    if (p[i + 1] < minY) minY = p[i + 1]; if (p[i + 1] > maxY) maxY = p[i + 1]
  }
  const w = maxX - minX, h = maxY - minY
  const out = []
  for (let i = 0; i < p.length; i += 2) {
    out.push(w < 0.25 ? 0 : Math.round((p[i] - minX) / w * 6))
    out.push(h < 0.25 ? 0 : Math.round((p[i + 1] - minY) / h * 6))
  }
  // 只保留線段數、粗略長寬比與正規化輪廓 —— 不含絕對尺寸，避免同一字因浮點誤差分裂成多種指紋
  return `${s.lines}:${w < 0.25 ? 'V' : Math.round(w / h * 3)}:${out.join('')}`
}
// 空間索引
const GRID = 20
const grid = new Map()
const small = S.filter(s => s.w < 3 && s.h < 6 && s.pts.length >= 4)
for (const g of small) {
  const k = (g.x / GRID | 0) + ':' + (g.y / GRID | 0)
  if (!grid.has(k)) grid.set(k, [])
  grid.get(k).push(g)
}
function slotsOf(m) {
  const padX = m.w / 2 - 0.5, padY = 2.2
  const cy = m.y + m.dy
  const got = []
  for (let gx = (m.x - padX) / GRID | 0; gx <= (m.x + padX) / GRID; gx++)
    for (let gy = (cy - padY) / GRID | 0; gy <= (cy + padY) / GRID; gy++)
      for (const g of grid.get(gx + ':' + gy) || [])
        if (g !== m.self && Math.abs(g.x - m.x) < padX && Math.abs(g.y - cy) < padY) got.push(g)
  got.sort((a, b) => a.x - b.x)
  // 依 x 間距切成數字槽
  const slots = []
  for (const g of got) {
    const last = slots[slots.length - 1]
    if (last && g.x - last.x < 1.3) { last.parts.push(g); last.x = Math.max(last.x, g.x) }
    else slots.push({ x: g.x, parts: [g] })
  }
  return slots.map(s => s.parts.map(pathSig).sort().join('+'))
}
for (const m of marks) m.slots = slotsOf(m)
const dist = {}
for (const m of marks) dist[m.slots.length] = (dist[m.slots.length] || 0) + 1
console.log('每個記號切出的數字槽數:', JSON.stringify(dist))

// ---------- 判讀 ----------
// 第一步：用「位置無爭議」的車位當樣本學字形（單次，不迭代 —— 迭代會被錯標樣本污染）
const seats = JSON.parse(fs.readFileSync('src/map/b1-classification.json', 'utf8')).seats
  .filter(s => ['small', 'motor', 'access'].includes(s.cat))
const T = [0.9789, 0, 0, 0.9803, 25.9, 13.6]
const P = seats.map(s => ({ id: +s.id, x: T[0] * s.x + T[4], y: T[3] * s.y + T[5], cat: s.cat }))
const learn = new Map()
let samples = 0
for (const m of marks) {
  const ds = P.map(p => ({ p, d: Math.hypot(p.x - m.x, p.y - m.y) })).sort((a, b) => a.d - b.d)
  if (ds[0].d > 1.5 || ds[1].d < 5) continue
  const label = String(ds[0].p.id)
  if (label.length !== m.slots.length) continue
  samples++
  m.slots.forEach((sg, i) => {
    const k = m.shape + '|' + sg
    if (!learn.has(k)) learn.set(k, {})
    const t = learn.get(k); t[label[i]] = (t[label[i]] || 0) + 1
  })
}
const table = new Map()
for (const [k, t] of learn) {
  const es = Object.entries(t).sort((a, b) => b[1] - a[1])
  const total = es.reduce((a, b) => a + b[1], 0)
  if (es[0][1] / total >= 0.9) table.set(k, es[0][0])
}
console.log(`字形樣本 ${samples} 格 -> 指紋 ${table.size} 種`)

const raw = marks.map(m => {
  if (!m.slots.length) return null
  let out = ''
  for (const sg of m.slots) { const d = table.get(m.shape + '|' + sg); if (d === undefined) return null; out += d }
  const n = +out
  return n >= 1 && n <= 655 ? n : null
})
const cnt = new Map()
raw.forEach(n => { if (n !== null) cnt.set(n, (cnt.get(n) || 0) + 1) })
const num = raw.map(n => (n !== null && cnt.get(n) === 1) ? n : null)
const readCount = num.filter(n => n !== null).length
console.log(`直接判讀 ${readCount}/655（唯一解，無重複）`)

// 第二步：沿著同一排（同一直行／同一橫列）做連號內插補完
// 車位在圖上成排排列且編號連續，因此用排內已確認的號碼推其餘 —— 比用座標猜可靠得多
function buildRuns(axis) {
  const key = axis === 'col' ? 'x' : 'y'
  const along = axis === 'col' ? 'y' : 'x'
  const groups = new Map()
  marks.forEach((m, i) => {
    const g = Math.round(m[key] / 3)
    for (const k of [g - 1, g, g + 1]) {
      if (!groups.has(k)) groups.set(k, new Set())
    }
    groups.get(g).add(i)
  })
  const runs = []
  for (const [, set] of groups) {
    const list = [...set].sort((a, b) => marks[a][along] - marks[b][along])
    let cur = []
    for (const i of list) {
      if (cur.length && Math.abs(marks[i][along] - marks[cur[cur.length - 1]][along]) > 16) {
        if (cur.length >= 3) runs.push(cur)
        cur = []
      }
      // 同一位置重複收錄時跳過
      if (cur.length && Math.abs(marks[i][along] - marks[cur[cur.length - 1]][along]) < 3) continue
      cur.push(i)
    }
    if (cur.length >= 3) runs.push(cur)
  }
  return runs
}
const runs = [...buildRuns('col'), ...buildRuns('row')]
function interpolate() {
  let n2 = 0
  for (let pass = 0; pass < 4; pass++) {
    for (const run of runs) {
      const anchors = run.map((idx, k) => ({ k, n: num[idx] })).filter(a => a.n !== null)
      if (anchors.length < 2) continue
      const step = (anchors[anchors.length - 1].n - anchors[0].n) / (anchors[anchors.length - 1].k - anchors[0].k)
      if (step !== 1 && step !== -1) continue
      if (!anchors.every(a => a.n === anchors[0].n + step * (a.k - anchors[0].k))) continue
      for (let k = 0; k < run.length; k++) {
        const idx = run[k]
        if (num[idx] !== null) continue
        const n = anchors[0].n + step * (k - anchors[0].k)
        if (n < 1 || n > 655 || num.includes(n)) continue
        num[idx] = n; n2++
      }
    }
  }
  return n2
}
let filled = interpolate()
// 回頭用「已確認」的結果擴充字形表再讀一次（此時的樣本已經過大小交叉驗證，不會像用座標猜那樣污染）
for (let round = 0; round < 4; round++) {
  const learn2 = new Map()
  num.forEach((n, i) => {
    if (n === null) return
    const m = marks[i], label = String(n)
    if (label.length !== m.slots.length) return
    m.slots.forEach((sg, k) => {
      const key = m.shape + '|' + sg
      if (!learn2.has(key)) learn2.set(key, {})
      const t = learn2.get(key); t[label[k]] = (t[label[k]] || 0) + 1
    })
  })
  const tbl2 = new Map()
  for (const [k, t] of learn2) {
    const es = Object.entries(t).sort((x, y) => y[1] - x[1])
    const tot = es.reduce((x, y) => x + y[1], 0)
    if (es[0][1] / tot >= 0.95) tbl2.set(k, es[0][0])
  }
  const taken = new Set(num.filter(n => n !== null))
  let got = 0
  marks.forEach((m, i) => {
    if (num[i] !== null || !m.slots.length) return
    let out = ''
    for (const sg of m.slots) { const d = tbl2.get(m.shape + '|' + sg); if (d === undefined) return; out += d }
    const n = +out
    if (n < 1 || n > 655 || taken.has(n)) return
    num[i] = n; taken.add(n); got++
  })
  filled += got + interpolate()
  if (!got) break
}
console.log(`沿排連號內插＋回頭擴充字形表，補上 ${filled} 格`)

const finalOk = num.filter(n => n !== null)
const setF = new Set(finalOk)
const still = []; for (let n = 1; n <= 655; n++) if (!setF.has(n)) still.push(n)
console.log(`補完後 ${finalOk.length}/655　相異 ${setF.size}　缺號 ${still.length}` + (still.length ? ' -> ' + still.join(',') : ' ✓ 剛好是 1..655'))

// ---------- 與我方現有資料比對 ----------
const CN = { small: '小', motor: '大', access: '無障礙' }
const FIELD_TO_SMALL = new Set([...Array.from({ length: 21 }, (_, i) => 208 + i), 119, 95, 96, 596])
const mineCat = new Map(seats.map(s => [+s.id, FIELD_TO_SMALL.has(+s.id) ? 'small' : s.cat]))
const shapeDiff = []
marks.forEach((m, i) => {
  const n = num[i]; if (n === null) return
  const mc = mineCat.get(n); if (!mc || mc === 'access') return
  if (mc !== m.shape) shapeDiff.push({ n, mine: mc, pdf: m.shape })
})
console.log(`\n圖面大小 vs 現場實勘：不符 ${shapeDiff.length} 格 -> ` +
  shapeDiff.sort((a, b) => a.n - b.n).map(d => `${d.n}(實${CN[d.mine]}/圖${CN[d.pdf]})`).join(' '))

// 我方舊座標指到的號碼 vs 圖面實際號碼（差異＝舊底圖排列與竣工圖不同之處）
const posDiff = []
for (const p of P) {
  let best = null
  marks.forEach((m, i) => { const d = Math.hypot(m.x - p.x, m.y - p.y); if (!best || d < best.d) best = { d, i } })
  const at = num[best.i]
  if (at !== null && at !== p.id) posDiff.push({ id: p.id, at, d: +best.d.toFixed(1) })
}
console.log(`\n舊底圖位置指到的號碼與竣工圖不同：${posDiff.length} 格`)
console.log('  ' + posDiff.sort((a, b) => a.id - b.id).map(d => `${d.id}→圖上${d.at}`).join('  '))

if (process.argv[3]) {
  fs.writeFileSync(process.argv[3], JSON.stringify(
    marks.map((m, i) => ({ n: num[i], shape: m.shape, x: +m.x.toFixed(2), y: +m.y.toFixed(2) }))))
  console.log('\n已寫出', process.argv[3])
}
