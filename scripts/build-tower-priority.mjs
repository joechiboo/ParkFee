// 產出「各棟電腦選號優先序」tower-priority.json（2026-07-24 方向+均分+重疊版）。
//
// 規則（使用者定）：
//   1. 分區方向：左欄上段(y<900)=AB 上→下、左欄下段=CD 下→上、中間=EF、右邊=GH（EF/GH 依離電梯距離近→遠）。
//      分界：左/中 x=560、中/右 x=1240（EF·GH 核心中點）、AB/CD y=900。
//   2. 均分：各棟盡量 ~N/4；不足的棟從其他區「借」最近的位補到目標 → 允許部份重疊
//      （借來的格同時留在原棟清單；引擎逐格檢查剩餘，重疊格誰先到誰拿、不會重複配）。
//   3. 扣掉鎖定位（live DB locked_seat）——凍結格不進任何清單。
//
// ⚠️ 鎖定清單變動後（新增凍結/解鎖）要重跑本腳本，讓解鎖格回到清單。
// 用法：node scripts/build-tower-priority.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// ── live 鎖定清單 ──
const env = {}
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const { data: lockedRows, error } = await sb.from('locked_seat').select('車位編號')
if (error) throw new Error('讀取 locked_seat 失敗（電腦選位清單必須扣鎖定）：' + error.message)
const locked = new Set(lockedRows.map((r) => String(r.車位編號)))

// ── 可入清單座位：非公益大位、且未鎖定 ──
const cls = JSON.parse(readFileSync('src/map/b1-classification.json', 'utf8'))
const HEAVY_MIN = 321, HEAVY_MAX = 349 // 重機專區：只租重機，不進電腦選位候選
const all = cls.seats.filter((s) => s.cat === 'motor' && !s.public && !(+s.id >= HEAVY_MIN && +s.id <= HEAVY_MAX))
const seats = all.filter((s) => !locked.has(String(s.id)))

const CORES = [
  { name: 'AB', x: 581, y: 424 },
  { name: 'CD', x: 563, y: 1168 },
  { name: 'EF', x: 1102, y: 1375 },
  { name: 'GH', x: 1378, y: 1375 },
]
const TS = ['AB', 'CD', 'EF', 'GH']
const core = (n) => CORES.find((c) => c.name === n)
const d2 = (s, c) => (s.x - c.x) ** 2 + (s.y - c.y) ** 2

// ── 1) 分區（primary，涵蓋所有座位）──
// 2026-07-29 規則：左欄(x<560) 依 y 中位上下對半分 AB/CD（均分）；
// EF/GH 不用 x 中位切（會把 EF 電梯出口劃給 GH）→ EF 出口周邊優先留 EF，
// GH＝右區(x≥1240，EF·GH 核心中點) ∪ 使用者指定中間塊 419-442。
const X_MID = 560
const X_RIGHT = 1240
const GH_BLOCK = new Set(Array.from({ length: 442 - 419 + 1 }, (_, i) => String(419 + i)))
const leftCol = seats.filter((s) => s.x < X_MID).sort((a, b) => a.y - b.y)
const Y_ABCD = leftCol[Math.floor(leftCol.length / 2)].y
const region = (s) =>
  s.x >= X_RIGHT || GH_BLOCK.has(String(s.id)) ? 'GH' : s.x >= X_MID ? 'EF' : s.y < Y_ABCD ? 'AB' : 'CD'

// ── 2) 各棟底稿：優先用手排檔（order.html ⬇ 匯出 → src/map/tower-order-manual.json），沒有才純規則 ──
const sortDir = {
  AB: (a, b) => a.y - b.y || a.x - b.x, // 上→下
  CD: (a, b) => b.y - a.y || a.x - b.x, // 下→上
  EF: (a, b) => d2(a, core('EF')) - d2(b, core('EF')), // 靠電梯近→遠
  GH: (a, b) => d2(a, core('GH')) - d2(b, core('GH')),
}
const byId = new Map(seats.map((s) => [String(s.id), s]))
const own = { AB: [], CD: [], EF: [], GH: [] }
let manualUsed = false
try {
  // 手排檔允許同格屬多棟（重疊）；棟內去重、鎖定/不存在的剔除。
  const manual = JSON.parse(readFileSync('src/map/tower-order-manual.json', 'utf8'))
  for (const t of TS) {
    const seen = new Set()
    own[t] = (manual.towers?.[t] ?? [])
      .map((id) => byId.get(String(id)))
      .filter((s) => s && !seen.has(s.id) && seen.add(s.id))
  }
  // 手排檔沒涵蓋的（例如之後解鎖的新格）→ 依分區＋方向補到該棟尾端
  const covered = new Set(TS.flatMap((t) => own[t].map((s) => String(s.id))))
  const leftover = { AB: [], CD: [], EF: [], GH: [] }
  for (const s of seats) if (!covered.has(String(s.id))) leftover[region(s)].push(s)
  for (const t of TS) {
    leftover[t].sort(sortDir[t])
    own[t].push(...leftover[t])
  }
  manualUsed = true
} catch {
  for (const s of seats) own[region(s)].push(s)
  for (const t of TS) own[t].sort(sortDir[t])
}

// ── 3) 均分補位（重疊）：不足目標的棟，補「不在自己清單、離本棟電梯最近」的位到目標 ──
const target = Math.ceil(seats.length / 4)
const towers = {}
const borrowed = {}
for (const t of TS) {
  const inOwn = new Set(own[t].map((s) => String(s.id)))
  const foreign = seats
    .filter((s) => !inOwn.has(String(s.id)))
    .sort((a, b) => d2(a, core(t)) - d2(b, core(t)))
  borrowed[t] = foreign.slice(0, Math.max(0, target - own[t].length)).map((s) => s.id)
  towers[t] = [...own[t].map((s) => s.id), ...borrowed[t]] // 底稿在前、借位(近電梯序)在後
}

const seatTower = {} // 主屬棟＝第一個包含它的棟（重疊格取先者；引擎不依賴此欄）
for (const t of TS) for (const s of own[t]) if (!(s.id in seatTower)) seatTower[s.id] = t

const out = {
  meta: {
    generated: manualUsed ? 'manual-order+auto-fill' : 'directional-balanced-overlap',
    note: 'AB上→下/CD下→上/EF·GH靠電梯；均分~N/4 借位重疊；已扣鎖定。鎖定變動後重跑本腳本。',
    thresholds: { X_MID, X_RIGHT, Y_ABCD },
    cores: Object.fromEntries(CORES.map((c) => [c.name, { x: c.x, y: c.y }])),
    lockedExcluded: locked.size,
    counts: Object.fromEntries(TS.map((t) => [t, towers[t].length])),
    ownCounts: Object.fromEntries(TS.map((t) => [t, own[t].length])),
    total: seats.length,
  },
  towers,
  seatTower,
}
writeFileSync('src/map/tower-priority.json', JSON.stringify(out, null, 0))

console.log(`已寫入 src/map/tower-priority.json（扣鎖定 ${locked.size} 格後共 ${seats.length} 格，均分目標 ${target}/棟）`)
for (const t of TS) {
  console.log(
    `  ${t}：自有 ${own[t].length} + 借 ${borrowed[t].length} = ${towers[t].length}` +
      `｜前10 [${towers[t].slice(0, 10).join(',')}]`,
  )
}