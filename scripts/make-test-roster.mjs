// 產生「全鏈實測／每月模擬」用的名冊 CSV（不進版控）。
//   ① 已登記的真實資料（Supabase）打底 —— 有多少用多少
//   ② 用 mock 補到目標車輛數（預設 400 台，貼近實際規模：約 277 戶 401 台）
//   ③ 再加手捏邊角案例，讓 TODO 🎲 段的每輪必驗項目都有資料可對
//
// ⚠️ 讀真實登記需 service_role（household/vehicle 為 RLS deny-all）。
//    .env 加：SUPABASE_SERVICE_ROLE_KEY=eyJ...（Dashboard → Settings → API）
//    沒有 key 也能跑，只是①會跳過、全部用 mock 補（會標示出來）。
//
// 用法：
//   node scripts/make-test-roster.mjs            # 補到 400 台
//   node scripts/make-test-roster.mjs 250        # 補到 250 台
//   node scripts/make-test-roster.mjs 400 --no-edge   # 不加邊角案例
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { sampleRoster } from '../src/data/sample.js'

const COLUMNS = [
  '戶號', '車號', '車種', '第幾輛', '身障', '志願小位', '登記時間',
  '聯絡電話', '車位志願', '志願落選保底', '社宅', '工作人員', '來源', '車位編號', '已繳費',
]

const TARGET = Number(process.argv.find((a) => /^\d+$/.test(a))) || 400
const WITH_EDGE = !process.argv.includes('--no-edge')

function loadEnv() {
  const env = { ...process.env }
  try {
    for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
      if (m && env[m[1]] == null) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* 無 .env 也行 */
  }
  return env
}
const ENV = loadEnv()
const yn = (b) => (b ? 'Y' : 'N')

// ── ① 真實登記（需 service_role）──
async function fetchReal() {
  const url = ENV.SUPABASE_URL || ENV.VITE_SUPABASE_URL
  const sr = ENV.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !sr) return null
  const h = { apikey: sr, Authorization: `Bearer ${sr}` }
  const [hs, vs] = await Promise.all([
    fetch(`${url}/rest/v1/household?select=戶號,電話,車位志願,志願落選保底,社宅,工作人員,created_at`, { headers: h }),
    fetch(`${url}/rest/v1/vehicle?select=車號,戶號,車種,第幾輛,身障,志願小位,車位編號,已繳費&order=戶號&order=第幾輛`, { headers: h }),
  ])
  if (!hs.ok || !vs.ok) return null
  const households = await hs.json()
  const vehicles = await vs.json()
  const byId = new Map(households.map((x) => [x.戶號, x]))
  return vehicles.map((v) => {
    const hh = byId.get(v.戶號) || {}
    return {
      戶號: v.戶號,
      車號: v.車號,
      車種: v.車種,
      第幾輛: v.第幾輛,
      身障: yn(v.身障),
      志願小位: yn(v.志願小位),
      登記時間: hh.created_at || '',
      聯絡電話: hh.電話 || '',
      車位志願: Array.isArray(hh.車位志願) ? hh.車位志願.join('、') : '',
      志願落選保底: yn(hh.志願落選保底),
      社宅: yn(hh.社宅),
      工作人員: yn(hh.工作人員),
      來源: '線上',
      車位編號: v.車位編號 || '',
      已繳費: yn(v.已繳費),
    }
  })
}

const real = await fetchReal()
const rows = [...(real ?? [])]
const usedHouses = new Set(rows.map((r) => r.戶號))

// ── ② mock 補到目標台數（跳過與真實資料撞號的戶）──
let mockAdded = 0
if (rows.length < TARGET) {
  // sampleRoster 每戶約 1.5 台 → 先多產一些，取到夠為止
  const pool = sampleRoster(Math.ceil((TARGET - rows.length) / 1.2) + 40)
  for (const r of pool) {
    if (rows.length >= TARGET) break
    if (usedHouses.has(r.戶號)) continue // 真實資料已有此戶 → 不覆蓋
    rows.push({ ...r, 工作人員: 'N' })
    mockAdded++
  }
}

// ── ③ 邊角案例（每筆對應 🎲 檢查表的一列）──
const 時間 = '2026-11-20 10:00'
const edge = [
  { 戶號: 'S1-90', 車號: 'EDGE-01', 車種: '重機', 車位志願: '', 說明: '重機未填志願→最低號相鄰對' },
  { 戶號: 'S1-91', 車號: 'EDGE-02', 車種: '重機', 車位志願: '105', 說明: '重機志願指無障礙→單格（若 R0 未先取走）' },
  { 戶號: 'S1-92', 車號: 'EDGE-03', 車種: '一般', 車位志願: '6、7', 社宅: 'Y', 說明: '社宅戶→只落公益位' },
  { 戶號: 'S1-93', 車號: 'EDGE-04', 車種: '一般', 車位志願: '', 身障: 'Y', 社宅: 'Y', 說明: '社宅身障→一般無障礙位（例外，非違規）' },
  { 戶號: 'S1-94', 車號: 'EDGE-05', 車種: '重機', 車位志願: '', 社宅: 'Y', 說明: '社宅重機→吃 2 格公益位' },
  { 戶號: 'S1-95', 車號: 'EDGE-06', 車種: '一般', 車位志願: '2', 說明: '一般戶指公益位→配不出' },
  { 戶號: 'S1-96', 車號: 'EDGE-07', 車種: '一般', 車位志願: '482', 說明: '志願指到鎖定位→跳過' },
  { 戶號: '員工-陳進茂', 車號: 'STAFF-01', 車種: '一般', 車位志願: '', 工作人員: 'Y', 說明: '工作人員（名單內）→排最後、0 元、公告隱藏' },
  { 戶號: '員工-路人甲', 車號: 'STAFF-02', 車種: '一般', 車位志願: '', 工作人員: 'Y', 說明: '工作人員（名單外）→健檢標記' },
  { 戶號: 'S1-97', 車號: '', 車種: '自行車', 車位志願: '', 電話: '', 說明: '純自行車戶無電話→健檢標記' },
]
if (WITH_EDGE) {
  for (const e of edge) {
    if (usedHouses.has(e.戶號)) continue // 真實資料已有 → 不覆蓋
    rows.push({
      戶號: e.戶號,
      車號: e.車號 || `自行車-${e.戶號}-1`,
      車種: e.車種,
      第幾輛: 1,
      身障: e.身障 || 'N',
      志願小位: 'N',
      登記時間: 時間,
      聯絡電話: e.電話 === '' ? '' : '0912000000',
      車位志願: e.車位志願,
      志願落選保底: 'N',
      社宅: e.社宅 || 'N',
      工作人員: e.工作人員 || 'N',
      來源: '線上',
      車位編號: '',
      已繳費: 'N',
    })
  }
}

const esc = (v) => {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const csv = '﻿' + [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => esc(r[c])).join(','))].join('\r\n')

if (!existsSync('private')) mkdirSync('private')
const out = `private/roster-test-${TARGET}.csv`
writeFileSync(out, csv, 'utf8')

const houses = new Set(rows.map((r) => r.戶號)).size
const motors = rows.filter((r) => r.車種 !== '自行車').length
console.log(`✓ ${out}`)
console.log(`   ${houses} 戶 / ${rows.length} 列（機車 ${motors}、自行車 ${rows.length - motors}）`)
console.log(
  real
    ? `   真實登記 ${real.length} 列 ＋ mock 補 ${mockAdded} 列` + (WITH_EDGE ? ` ＋ 邊角 ${edge.length} 筆` : '')
    : `   ⚠️ 無 SUPABASE_SERVICE_ROLE_KEY → 未讀真實登記，全部用 mock（${mockAdded} 列）` +
      (WITH_EDGE ? ` ＋ 邊角 ${edge.length} 筆` : ''),
)
if (WITH_EDGE) {
  console.log('\n邊角案例對照（跑完逐項對）：')
  for (const e of edge) console.log(`  ${e.戶號.padEnd(12)} ${e.說明}`)
}
