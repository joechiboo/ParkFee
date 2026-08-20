// 依竣工圖 (docs/A205_B1平面圖.pdf) 重建 seat-select-demo.html 的車位座標。
//
// 竣工圖每個車位都畫了記號：三角形=175*75 小車位、橢圓=200*100 大車位、六邊形=185*60 自行車位。
// 本腳本抽出這些向量記號的中心點，用最佳指派 (Hungarian) 把現有 seat 編號一對一綁上去，
// 之後座標就等於圖面記號中心（CAD 精度），不再是人工點放。
//
// 用法: node scripts/rebuild-seat-coords.mjs [--write]
//   不加 --write 只做分析與驗證，不動檔案。
import * as mupdf from 'mupdf'
import fs from 'fs'

const PDF = 'docs/A205_B1平面圖.pdf'
const DEMO = 'public/demo/seat-select-demo.html'
const WRITE = process.argv.includes('--write')

// ---------- 1. 抽出圖面記號 ----------
function extractShapes(src) {
  const doc = mupdf.Document.openDocument(fs.readFileSync(src), 'application/pdf')
  const page = doc.loadPage(0)
  const shapes = []
  const record = (path, ctm) => {
    let lines = 0, curves = 0
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9
    const push = (x, y) => {
      const a = ctm[0] * x + ctm[2] * y + ctm[4], b = ctm[1] * x + ctm[3] * y + ctm[5]
      if (a < minX) minX = a; if (a > maxX) maxX = a
      if (b < minY) minY = b; if (b > maxY) maxY = b
    }
    try {
      path.walk({
        moveTo: push, lineTo: (x, y) => { lines++; push(x, y) },
        curveTo(x1, y1, x2, y2, x3, y3) { curves++; push(x1, y1); push(x2, y2); push(x3, y3) },
        closePath() {},
      })
    } catch { return }
    if (maxX < minX) return
    shapes.push({ lines, curves, x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY })
  }
  const noop = () => {}
  const dev = new mupdf.Device({
    fillPath: (p, e, c) => record(p, c), strokePath: (p, s, c) => record(p, c),
    clipPath: noop, clipStrokePath: noop, fillText: noop, strokeText: noop, clipText: noop, clipStrokeText: noop,
    fillShade: noop, fillImage: noop, fillImageMask: noop, clipImageMask: noop, popClip: noop,
    beginMask: noop, endMask: noop, beginGroup: noop, endGroup: noop, beginTile: () => 0, endTile: noop,
    beginLayer: noop, endLayer: noop, beginStructure: noop, endStructure: noop,
    beginMetatext: noop, endMetatext: noop, renderFlags: noop, setDefaultColorSpaces: noop, close: noop,
  })
  page.run(dev, mupdf.Matrix.identity)
  dev.close()
  return shapes
}
const shapes = extractShapes(PDF)
const tri = shapes.filter(s => s.curves === 0 && s.lines === 3 && s.w > 9.8 && s.w < 10.8 && s.h > 8.4 && s.h < 9.4)
const ell = shapes.filter(s => s.curves === 0 && s.lines === 28 && s.w > 10.8 && s.w < 11.8 && s.h > 7.4 && s.h < 8.4)
const hex = shapes.filter(s => s.curves === 0 && s.lines === 6 && s.w > 6.2 && s.w < 6.9 && s.h > 5.3 && s.h < 6.1 && s.x < 1700)
const moto = [...tri.map(s => ({ shape: 'small', x: s.x, y: s.y })), ...ell.map(s => ({ shape: 'motor', x: s.x, y: s.y }))]
console.log(`圖面記號：三角形(小) ${tri.length}　橢圓(大) ${ell.length}　六邊形(自行車) ${hex.length}`)
if (moto.length !== 655) throw new Error(`機車位記號應為 655，實得 ${moto.length}`)
if (hex.length !== 164) throw new Error(`自行車位記號應為 164，實得 ${hex.length}`)

// ---------- 2. 讀出 demo 現有車位 ----------
const html = fs.readFileSync(DEMO, 'utf8')
const RE = /<g class="seat (cat-[\w-]+)((?: \w+)*)" data-id="([^"]*)" data-cat="([\w-]+)"><circle cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)"\/><text x="([-\d.]+)" y="([-\d.]+)">([^<]*)<\/text><\/g>/g
const seats = []
for (const m of html.matchAll(RE)) {
  seats.push({ idx: seats.length, full: m[0], cls: m[1], extra: m[2], id: m[3], cat: m[4],
    x: +m[5], y: +m[6], r: m[7], label: m[9] })
}
console.log(`demo 車位總數 ${seats.length}`,
  JSON.stringify(seats.reduce((a, s) => (a[s.cat] = (a[s.cat] || 0) + 1, a), {})))

// ---------- 3. 舊圖 -> 竣工圖 套準 ----------
const ap = (T, x, y) => [T[0] * x + T[2] * y + T[4], T[1] * x + T[3] * y + T[5]]
function fitAffine(pairs) {
  const solve = (idx) => {
    const A = new Array(9).fill(0), r = [0, 0, 0]
    for (const [sx, sy, tx, ty] of pairs) {
      const t = idx === 0 ? tx : ty, v = [sx, sy, 1]
      for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) A[i * 3 + j] += v[i] * v[j]; r[i] += v[i] * t }
    }
    const M = [[A[0], A[1], A[2], r[0]], [A[3], A[4], A[5], r[1]], [A[6], A[7], A[8], r[2]]]
    for (let i = 0; i < 3; i++) {
      let p = i; for (let k = i + 1; k < 3; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k
      ;[M[i], M[p]] = [M[p], M[i]]
      for (let k = 0; k < 3; k++) { if (k === i) continue; const f = M[k][i] / M[i][i]; for (let j = i; j < 4; j++) M[k][j] -= f * M[i][j] }
    }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]]
  }
  const [a, c, e] = solve(0), [b, d, f] = solve(1)
  return [a, b, c, d, e, f]
}
const motoSeats = seats.filter(s => ['small', 'motor', 'access'].includes(s.cat))
if (motoSeats.length !== 655) throw new Error(`機車位車位應為 655，實得 ${motoSeats.length}`)
let T = [0.9789, 0, 0, 0.98, 26.5, 14.4]
for (let it = 0; it < 12; it++) {
  const cs = []
  for (const s of motoSeats) {
    const [nx, ny] = ap(T, s.x, s.y)
    let best = null
    for (const m of moto) { const d = Math.hypot(m.x - nx, m.y - ny); if (!best || d < best.d) best = { d, m } }
    if (best.d < 6) cs.push([s.x, s.y, best.m.x, best.m.y])
  }
  T = fitAffine(cs)
}
console.log(`套準仿射：縮放 ${T[0].toFixed(4)}/${T[3].toFixed(4)}　位移 ${T[4].toFixed(1)},${T[5].toFixed(1)}`)

// 局部位移場（吸收兩版圖的局部差異）
const pred = motoSeats.map(s => { const [nx, ny] = ap(T, s.x, s.y); return { s, nx, ny } })
const anchors = []
for (const p of pred) {
  let best = null
  for (const m of moto) { const d = Math.hypot(m.x - p.nx, m.y - p.ny); if (!best || d < best.d) best = { d, m } }
  if (best.d < 4) anchors.push({ x: p.nx, y: p.ny, dx: best.m.x - p.nx, dy: best.m.y - p.ny })
}
function warp(nx, ny) {
  const near = anchors.map(a => ({ a, d: Math.hypot(a.x - nx, a.y - ny) })).sort((p, q) => p.d - q.d).slice(0, 10)
  let wx = 0, wy = 0, ws = 0
  for (const n of near) { const w = 1 / (n.d + 3); wx += n.a.dx * w; wy += n.a.dy * w; ws += w }
  return [nx + wx / ws, ny + wy / ws]
}
for (const p of pred) { const [a, b] = warp(p.nx, p.ny); p.nx = a; p.ny = b }
console.log(`局部位移場錨點 ${anchors.length} 個`)

// ---------- 4. 指派：優先用圖面自己印的號碼，其餘用位置+大小雙重約束補 ----------
const NUMBERS = process.env.NUMBERS || 'numbers.json'
const read = JSON.parse(fs.readFileSync(NUMBERS, 'utf8'))   // [{n, shape, x, y}]
if (read.length !== 655) throw new Error('numbers.json 應有 655 筆')
const markByNum = new Map()
for (const r of read) if (r.n !== null) markByNum.set(r.n, r)
console.log(`圖面直接判讀出號碼 ${markByNum.size}/655`)

// 2026-08-19 現場實勘（陳進茂）：下列由「大」更正為「小」，其餘維持我方盤點
const FIELD_TO_SMALL = new Set([...Array.from({ length: 21 }, (_, i) => 208 + i), 119, 95, 96, 596])
const truthCat = id => FIELD_TO_SMALL.has(id) ? 'small' : (motoSeats.find(s => +s.id === id) || {}).cat

function hungarian(cost, n) {
  const INF = 1e18
  const u = new Float64Array(n + 1), v = new Float64Array(n + 1)
  const p = new Int32Array(n + 1), way = new Int32Array(n + 1)
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0
    const minv = new Float64Array(n + 1).fill(INF), used = new Uint8Array(n + 1)
    do {
      used[j0] = 1
      const i0 = p[j0]; let delta = INF, j1 = -1
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const cur = cost[(i0 - 1) * n + (j - 1)] - u[i0] - v[j]
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0 }
        if (minv[j] < delta) { delta = minv[j]; j1 = j }
      }
      for (let j = 0; j <= n; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta } else minv[j] -= delta }
      j0 = j1
    } while (p[j0] !== 0)
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1 } while (j0)
  }
  const res = new Int32Array(n)
  for (let j = 1; j <= n; j++) if (p[j]) res[p[j] - 1] = j - 1
  return res
}
// 未判讀的記號 vs 未被用到的號碼
const openMarks = read.filter(r => r.n === null)
const openNums = []
for (let n = 1; n <= 655; n++) if (!markByNum.has(n)) openNums.push(n)
console.log(`待補 ${openNums.length} 號 vs ${openMarks.length} 個未判讀記號`)
if (openNums.length !== openMarks.length) throw new Error('數量不符')
const predByNum = new Map(pred.map(p => [+p.s.id, p]))
if (openNums.length) {
  const N = openNums.length
  const cost = new Float64Array(N * N)
  for (let i = 0; i < N; i++) {
    const n = openNums[i], pp = predByNum.get(n)
    for (let j = 0; j < N; j++) {
      const m = openMarks[j]
      let c = pp ? Math.hypot(m.x - pp.nx, m.y - pp.ny) : 50
      if (truthCat(n) !== 'access' && truthCat(n) !== m.shape) c += 25   // 大小不符加重罰
      cost[i * N + j] = c
    }
  }
  const res = hungarian(cost, N)
  for (let i = 0; i < N; i++) markByNum.set(openNums[i], openMarks[res[i]])
  console.log(`補完 ${N} 格（位置+大小約束）`)
}

// 交叉驗證：圖面大小 vs 現場實勘
const bad = []
for (const s of motoSeats) {
  const id = +s.id, t = truthCat(id)
  if (t === 'access') continue
  const m = markByNum.get(id)
  if (m && m.shape !== t) bad.push(id)
}
console.log(`\n交叉驗證：圖面大小與現場實勘不符 ${bad.length} 格 -> ${bad.sort((a, b) => a - b).join(',')}`)
console.log(`  （預期恰為 143,144,145 —— 經理指出的竣工圖已知誤差）`)

// 自行車：圖上六邊形內是「B」不是號碼，只能用位置指派
const bikeSeatsAll = seats.filter(s => s.cat === 'bike')
const bikePred = bikeSeatsAll.map(s => { const [a, b] = ap(T, s.x, s.y); const [c, d] = warp(a, b); return { s, nx: c, ny: d } })
const NB = bikePred.length
const bcost = new Float64Array(NB * NB)
for (let i = 0; i < NB; i++) for (let j = 0; j < NB; j++)
  bcost[i * NB + j] = Math.hypot(hex[j].x - bikePred[i].nx, hex[j].y - bikePred[i].ny)
const bres = hungarian(bcost, NB)
const bd = []
for (let i = 0; i < NB; i++) bd.push(bcost[i * NB + bres[i]])
bd.sort((a, b) => a - b)
console.log(`自行車位指派 ${NB} 格　中位偏差 ${bd[NB >> 1].toFixed(2)}pt　最大 ${bd[NB - 1].toFixed(2)}pt`)

// ---------- 5. 產生新座標 ----------
const nx = new Map()
for (const s2 of motoSeats) { const m = markByNum.get(+s2.id); if (m) nx.set(s2.idx, [m.x, m.y]) }
bikePred.forEach((p, i) => { const m = hex[bres[i]]; nx.set(p.s.idx, [m.x, m.y]) })
for (const s2 of seats) if (!nx.has(s2.idx)) nx.set(s2.idx, ap(T, s2.x, s2.y)) // 汽車/排除點：只做仿射

const r2 = v => Math.round(v * 10) / 10
if (WRITE) {
  let i = 0
  const out = html.replace(RE, (full, cls, extraCls, id, cat, cx, cy, r, tx, ty, label) => {
    const [X, Y] = nx.get(i++)
    return `<g class="seat ${cls}${extraCls}" data-id="${id}" data-cat="${cat}">` +
      `<circle cx="${r2(X)}" cy="${r2(Y)}" r="${r}"/><text x="${r2(X)}" y="${r2(Y + 2.5)}">${label}</text></g>`
  })
  if (i !== seats.length) throw new Error(`改寫筆數不符 ${i} vs ${seats.length}`)
  fs.writeFileSync(DEMO, out)
  console.log(`\n已改寫 ${DEMO}：${i} 格座標`)
  console.log('接著跑：node scripts/build-classification-from-demo.mjs')
} else {
  console.log('\n(未加 --write，未變更檔案)')
}
