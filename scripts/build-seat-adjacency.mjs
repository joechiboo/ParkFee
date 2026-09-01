// 產生「車位實體相鄰表」→ src/map/seat-adjacency.json
//
// 為什麼需要：重機依辦法肆五承租「相鄰之兩個機車位」，但引擎原本用**編號** n / n+1 判斷，
//   而編號連號 ≠ 實體相鄰 —— 實測 654 對連號中約 104 對其實隔著走道、轉角或跨排
//   （最誇張的 276-277 相距 667 單位，等於橫跨整個地下室）。照編號配下去，
//   重機車主會拿到兩個完全不相連的格子，現場根本停不了。
//
// 判準（純幾何，不看編號）：兩格必須
//   ① 對齊：同一排（dy 很小）或同一列（dx 很小）
//   ② 緊鄰：中心距 ≦ 該格「自身最近鄰距」× 容差 —— 各區間距不同（小位約 10.6、
//      大位約 14.1、公益區大小交錯更寬），故以每格自己的最近鄰距為基準，不用全域門檻
//   ③ 中間沒有夾其他車位（避免「跳過一格」被當相鄰）
//
// 用法：node scripts/build-seat-adjacency.mjs [--write]
import { readFileSync, writeFileSync } from 'node:fs'

const SRC = 'src/map/b1-classification.json'
const OUT = 'src/map/seat-adjacency.json'
const TYPE = { motor: '大', small: '小', access: '無障礙' }
const ALIGN = 4.0 // 對齊容差：同排/同列的垂直偏移上限
const SLACK = 1.35 // 相鄰上限＝自身最近鄰距 × 此值

const cls = JSON.parse(readFileSync(SRC, 'utf8'))
const seats = cls.seats
  .filter((s) => s.cat in TYPE)
  .map((s) => ({ id: String(s.id), n: Number(s.id), type: TYPE[s.cat], x: s.x, y: s.y }))

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

// 每格的最近鄰距（同排或同列者才算，避免被斜對角拉低）
const nearest = new Map()
for (const s of seats) {
  let min = Infinity
  for (const t of seats) {
    if (t === s) continue
    const dx = Math.abs(t.x - s.x)
    const dy = Math.abs(t.y - s.y)
    if (dx > ALIGN && dy > ALIGN) continue // 斜的不算
    min = Math.min(min, dist(s, t))
  }
  nearest.set(s.id, Number.isFinite(min) ? min : 0)
}

// 中間是否夾了第三格（在 a、b 連線上且落在兩者之間）
function blocked(a, b) {
  const horizontal = Math.abs(a.y - b.y) <= ALIGN
  const [lo, hi] = horizontal
    ? [Math.min(a.x, b.x), Math.max(a.x, b.x)]
    : [Math.min(a.y, b.y), Math.max(a.y, b.y)]
  for (const c of seats) {
    if (c === a || c === b) continue
    if (horizontal) {
      if (Math.abs(c.y - a.y) <= ALIGN && c.x > lo + 0.5 && c.x < hi - 0.5) return true
    } else if (Math.abs(c.x - a.x) <= ALIGN && c.y > lo + 0.5 && c.y < hi - 0.5) return true
  }
  return false
}

const adj = {}
let pairs = 0
for (const s of seats) {
  const limit = nearest.get(s.id) * SLACK
  const list = []
  for (const t of seats) {
    if (t === s) continue
    const dx = Math.abs(t.x - s.x)
    const dy = Math.abs(t.y - s.y)
    const aligned = (dy <= ALIGN && dx <= limit) || (dx <= ALIGN && dy <= limit)
    if (!aligned) continue
    if (blocked(s, t)) continue
    list.push({ id: t.id, d: dist(s, t) })
  }
  adj[s.id] = list.sort((p, q) => p.d - q.d).map((x) => x.id)
  pairs += list.length
}

// 對稱化：limit 取自各格「自身」最近鄰距，故可能 A 認得 B、B 認不得 A
//   （小位鄰著大位時尤然）。實體相鄰是對稱關係 → 取聯集補回。
for (const [id, list] of Object.entries(adj)) {
  for (const other of list) {
    if (!adj[other].includes(id)) adj[other].push(id)
  }
}
pairs = Object.values(adj).reduce((n, l) => n + l.length, 0)

// ── 統計：跟「編號連號」的差異 ──
const byNum = new Map(seats.map((s) => [s.n, s]))
let numAdjTrue = 0
let numAdjFalse = []
for (const s of seats) {
  const next = byNum.get(s.n + 1)
  if (!next) continue
  if (adj[s.id].includes(next.id)) numAdjTrue++
  else numAdjFalse.push(`${s.id}-${next.id}`)
}
const isolated = seats.filter((s) => adj[s.id].length === 0).map((s) => s.id)

console.log(`車位 ${seats.length} 格，相鄰關係 ${pairs / 2} 對（雙向 ${pairs} 筆）`)
console.log(`編號連號 ${numAdjTrue + numAdjFalse.length} 對 → 實體真的相鄰 ${numAdjTrue}、**不相鄰 ${numAdjFalse.length}**`)
console.log(`  不相鄰樣本：${numAdjFalse.slice(0, 10).join('、')}${numAdjFalse.length > 10 ? ' …' : ''}`)
console.log(`孤立格（無任何相鄰）：${isolated.length}${isolated.length ? ' → ' + isolated.slice(0, 10).join('、') : ''}`)

if (process.argv.includes('--write')) {
  writeFileSync(
    OUT,
    JSON.stringify(
      { meta: { 產生自: SRC, 對齊容差: ALIGN, 鄰距容差倍數: SLACK, 車位數: seats.length }, adj },
      null,
      0,
    ),
  )
  console.log(`\n✓ 已寫入 ${OUT}`)
} else {
  console.log('\n（未寫檔；加 --write 才輸出）')
}
