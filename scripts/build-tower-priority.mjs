// 產出「各棟電腦選號優先順序」：每個可承租大位 → 依最近梯廳核心分棟 → 棟內按離核心距離排序（近電梯優先）。
// 電腦選號時：住戶本棟的這份清單，由前往後找第一個「仍剩、未鎖、未被抽走」的位配給他。
// 來源：src/map/b1-classification.json（大位、排除公益位）。輸出：src/map/tower-priority.json。
// 用法：node scripts/build-tower-priority.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const cls = JSON.parse(readFileSync('src/map/b1-classification.json', 'utf8'))

// 4 棟梯廳核心（顯示座標，與 towers.html / render-towers.mjs 一致）。
const CORES = [
  { name: 'AB', x: 581, y: 424 },
  { name: 'CD', x: 563, y: 1168 },
  { name: 'EF', x: 1102, y: 1375 },
  { name: 'GH', x: 1378, y: 1375 },
]

// 可承租大位（排除公益位；小位走志願快速道、無障礙走 Round 0，皆不進電腦選號池）。
const seats = cls.seats.filter((s) => s.cat === 'motor' && !s.public)

const d2 = (s, c) => (s.x - c.x) ** 2 + (s.y - c.y) ** 2
function nearest(s) {
  let best = CORES[0]
  let bd = Infinity
  for (const c of CORES) {
    const dd = d2(s, c)
    if (dd < bd) {
      bd = dd
      best = c
    }
  }
  return { tower: best.name, dist: Math.sqrt(bd) }
}

const towers = { AB: [], CD: [], EF: [], GH: [] }
const seatTower = {}
for (const s of seats) {
  const { tower, dist } = nearest(s)
  towers[tower].push({ id: s.id, dist })
  seatTower[s.id] = tower
}

// 棟內：近電梯優先（距離小 → 排前面）。輸出僅留 id 陣列（順序即優先序）。
const orderedTowers = {}
for (const t of Object.keys(towers)) {
  orderedTowers[t] = towers[t].sort((a, b) => a.dist - b.dist).map((x) => x.id)
}

const out = {
  meta: {
    generated: 'auto-nearest-core',
    note: '棟內順序＝離該棟梯廳核心距離（近→遠）。微調分棟請用 public/demo/towers.html 匯出後回灌。',
    cores: Object.fromEntries(CORES.map((c) => [c.name, { x: c.x, y: c.y }])),
    counts: Object.fromEntries(Object.entries(orderedTowers).map(([t, ids]) => [t, ids.length])),
    total: seats.length,
  },
  towers: orderedTowers,
  seatTower,
}
writeFileSync('src/map/tower-priority.json', JSON.stringify(out, null, 0))

console.log('已寫入 src/map/tower-priority.json')
console.log('各棟大位數：', out.meta.counts, '合計', out.meta.total)
for (const [t, ids] of Object.entries(orderedTowers)) {
  const head = ids.slice(0, 5).join(',')
  const tail = ids.slice(-5).join(',')
  console.log(`  ${t}：靠電梯前5 [${head}] … 最遠5 [${tail}]`)
}