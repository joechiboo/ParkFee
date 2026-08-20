// 比較舊圖 (A2-5) 與竣工圖 (A205) 的機車位記號幾何，判斷底圖要不要換
// 用法: node scripts/compare-basemap-geometry.mjs <paths_old.json> <paths_new.json>
import fs from 'fs'
const O = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const N = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))

const oldMarks = O.filter(s => s.curves === 4 && s.lines === 0 && s.w > 11.2 && s.w < 12.0 && s.h > 7.6 && s.h < 8.4)
  .map(s => ({ x: s.x, y: s.y }))
const isTri = s => s.curves === 0 && s.lines === 3 && s.w > 9.8 && s.w < 10.8 && s.h > 8.4 && s.h < 9.4
const isEll = s => s.curves === 0 && s.lines === 28 && s.w > 10.8 && s.w < 11.8 && s.h > 7.4 && s.h < 8.4
const newMarks = [...N.filter(isTri).map(s => ({ shape: 'small', x: s.x, y: s.y })),
                  ...N.filter(isEll).map(s => ({ shape: 'motor', x: s.x, y: s.y }))]
console.log('舊圖機車位記號:', oldMarks.length, ' 竣工圖機車位記號:', newMarks.length)

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
const ap = (T, x, y) => [T[0] * x + T[2] * y + T[4], T[1] * x + T[3] * y + T[5]]

function icp(src, dst, T0, tol) {
  let T = T0
  for (let it = 0; it < 15; it++) {
    const cs = []
    for (const s of src) {
      const [nx, ny] = ap(T, s.x, s.y)
      let best = null
      for (const m of dst) { const d = Math.hypot(m.x - nx, m.y - ny); if (!best || d < best.d) best = { d, m } }
      if (best.d < tol) cs.push([s.x, s.y, best.m.x, best.m.y])
    }
    T = fitAffine(cs)
  }
  return T
}
function residuals(src, dst, T) {
  return src.map(s => {
    const [nx, ny] = ap(T, s.x, s.y)
    let best = null
    for (const m of dst) { const d = Math.hypot(m.x - nx, m.y - ny); if (!best || d < best.d) best = { d, m } }
    return { s, d: best.d, m: best.m, nx, ny }
  })
}
const stats = (rs, label) => {
  const ds = rs.map(r => r.d).sort((a, b) => a - b)
  const pct = t => (rs.filter(r => r.d < t).length / rs.length * 100).toFixed(1) + '%'
  console.log(`${label}  中位數 ${ds[ds.length >> 1].toFixed(2)}pt  <1pt ${pct(1)}  <2pt ${pct(2)}  <4pt ${pct(4)}  >6pt ${rs.filter(r => r.d > 6).length} 個`)
}

// A) 舊圖記號 -> 竣工圖記號（兩張圖彼此差多少）
let T = icp(oldMarks, newMarks, [0.978, 0, 0, 0.978, 26.4, 16.9], 6)
const rA = residuals(oldMarks, newMarks, T)
console.log('\n【A】舊圖 655 個記號 對 竣工圖 655 個記號（套準後）')
stats(rA, '   ')
console.log('   仿射參數: 縮放', T[0].toFixed(4), '/', T[3].toFixed(4), ' 位移', T[4].toFixed(1), T[5].toFixed(1))

// B) 我方座標 -> 舊圖 / 竣工圖
const seats = JSON.parse(fs.readFileSync('src/map/b1-classification.json', 'utf8')).seats
  .filter(s => ['small', 'motor', 'access'].includes(s.cat)).map(s => ({ x: s.x, y: s.y, id: +s.id, cat: s.cat }))
const Tso = icp(seats, oldMarks, [1, 0, 0, 1, 0, 0], 6)
const Tsn = icp(seats, newMarks, [0.978, 0, 0, 0.978, 26.4, 16.9], 6)
const rO = residuals(seats, oldMarks, Tso)
const rN = residuals(seats, newMarks, Tsn)
console.log('\n【B】我方 655 格座標 分別對兩張圖')
stats(rO, '   對 舊圖   ')
stats(rN, '   對 竣工圖 ')

// C) 差異最大的區域
console.log('\n【C】兩張圖差最多的位置（舊圖記號找不到對應的竣工圖記號，>6pt）')
const bad = rA.filter(r => r.d > 6).sort((a, b) => b.d - a.d)
const cluster = []
for (const b of bad) {
  const c = cluster.find(c => Math.hypot(c.x - b.s.x, c.y - b.s.y) < 60)
  if (c) { c.n++; c.x = (c.x * (c.n - 1) + b.s.x) / c.n; c.y = (c.y * (c.n - 1) + b.s.y) / c.n; c.max = Math.max(c.max, b.d) }
  else cluster.push({ x: b.s.x, y: b.s.y, n: 1, max: b.d })
}
for (const c of cluster.sort((a, b) => b.n - a.n))
  console.log(`   舊圖座標 (${c.x.toFixed(0)}, ${c.y.toFixed(0)}) 附近 ${c.n} 個記號對不上，最大偏差 ${c.max.toFixed(1)}pt`)
