// 分析抽出的點：編號重複情形 + 重複點的空間分佈，
// 看「重複編號」能不能當作 汽車/腳踏車 自成編號序列的自動訊號。
import { readFileSync } from 'node:fs'
const seats = JSON.parse(readFileSync('public/demo/seats.json', 'utf8'))

const byId = new Map()
for (const s of seats) {
  if (!byId.has(s.id)) byId.set(s.id, [])
  byId.get(s.id).push(s)
}
const nums = seats.map((s) => +s.id)
console.log(`總點 ${seats.length}，相異編號 ${byId.size}，max=${Math.max(...nums)}, min=${Math.min(...nums)}`)

const dupIds = [...byId.entries()].filter(([, v]) => v.length > 1)
console.log(`重複編號(出現>1次)：${dupIds.length} 種`)

// 出現次數分佈
const freq = {}
for (const [, v] of byId) freq[v.length] = (freq[v.length] || 0) + 1
console.log('出現次數分佈：', Object.entries(freq).map(([k, v]) => `${k}次×${v}`).join('  '))

// 各編號值出現幾次（看是否一個編號最多 ~3 次 = 機/汽/自三套）
const high = [...byId.entries()].filter(([, v]) => v.length >= 3).slice(0, 10)
console.log('出現≥3次的編號取樣：', high.map(([k, v]) => `${k}:${v.length}`).join('  '))

// X 範圍分區統計：把圖面分成左/中/右，看點如何分佈（粗略找區塊）
const W = 2384, H = 1684
const grid = {}
for (const s of seats) {
  const gx = Math.floor(s.x / (W / 6))
  const gy = Math.floor(s.y / (H / 4))
  const k = `col${gx}_row${gy}`
  grid[k] = (grid[k] || 0) + 1
}
console.log('\n=== 6×4 網格點數（col0=最左, row0=最上）===')
for (let r = 0; r < 4; r++) {
  let line = `row${r}: `
  for (let c = 0; c < 6; c++) line += String(grid[`col${c}_row${r}`] || 0).padStart(5)
  console.log(line)
}
