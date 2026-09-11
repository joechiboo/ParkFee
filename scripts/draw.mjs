// 抽籤演練 — 在本機跑完整條配位鏈，產出配位結果 CSV。
//
// 🔒 **完全唯讀，不會動到任何線上狀態。**
//    唯一會寫回 Supabase 的是 publish-result（/allocate 頁的「發佈」鈕，且需管理員密碼），
//    本腳本不呼叫它。這裡只做兩件事：讀 locked_seat（唯讀）、在記憶體跑引擎、寫出本機 CSV。
//    所以「跑完要不要退回狀態」這個問題不存在——沒有狀態被改動。
//
// 與 /allocate 頁用的是同一套引擎（distribute / distribute-bikes），同名冊＋同種子結果可重現。
//
// 用法：
//   node scripts/draw.mjs --roster private/roster-test-400.csv
//   node scripts/draw.mjs --roster <名冊.csv> --seed "2026-12-01公開決定" --announce 2026-12-05 --out private/配位結果.csv
//   node scripts/draw.mjs --roster <名冊.csv> --offline     # 不連 Supabase，不扣鎖定位（僅供離線試算）
//
// 名冊 CSV 欄位＝registry schema（export-roster.mjs 產出的那種）：
//   戶號,車號,車種,第幾輛,身障,志願小位,登記時間,聯絡電話,車位志願,志願落選保底,社宅,工作人員,來源,車位編號,已繳費
import { readFileSync, writeFileSync } from 'node:fs'
import { parseCSVObjects } from '../src/data/csv.js'
import { buildRoster } from '../src/data/registry.js'
import { distribute } from '../src/lottery/distribute.js'
import { distributeBikes } from '../src/lottery/distribute-bikes.js'
import { mergedResultCSV } from '../src/export/result.js'
import { motorSeats, bikeSeats } from '../src/map/seats.js'

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

// 讀 .env（與 export-roster.mjs 同一套解析）。
function loadEnv() {
  const env = { ...process.env }
  try {
    for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
      if (m && env[m[1]] == null) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* 沒有 .env 就只靠 process.env */
  }
  return env
}

// 鎖定車位（動線、保留、維修…）。抽籤必須先扣掉，否則會把不可用的位配出去。
// 用 anon key 唯讀取得——locked_seat 開放讀取，寫入才需管理員。
async function fetchLocked() {
  const env = loadEnv()
  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL
  const key = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY（可改用 --offline）')
  const res = await fetch(`${url}/rest/v1/locked_seat?select=車位編號`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) throw new Error(`讀取 locked_seat 失敗：HTTP ${res.status} ${(await res.text()).slice(0, 120)}`)
  return new Set((await res.json()).map((r) => String(r.車位編號)))
}

const rosterPath = arg('roster')
if (!rosterPath) {
  console.error(`用法：node scripts/draw.mjs --roster <名冊.csv> [選項]

  --seed <字串>        抽籤種子（12/1 當場公開決定）。同名冊＋同種子＝結果可重現
  --announce <日期>    公告日 YYYY-MM-DD，據以算簽約期限（公告 + 5 日）
  --out <檔案>         寫出配位結果 CSV；省略則只印摘要
  --offline            不連 Supabase、不扣鎖定車位（僅離線試算，結果與正式不同）

🔒 本腳本唯讀，不會發佈、不會改線上資料。`)
  process.exit(1)
}

const seed = arg('seed', 'parkfee')
const 公告日 = arg('announce', '')
const outPath = arg('out')
const offline = process.argv.includes('--offline')

// ── 1. 名冊 ──
const rows = parseCSVObjects(readFileSync(rosterPath, 'utf8'))
const { entries, invalid, conflicts } = buildRoster(rows)
console.log('=== 抽籤演練（唯讀，不影響線上狀態）===')
console.log(`名冊          ${rosterPath}`)
console.log(`  讀入 ${rows.length} 列 → 有效 ${entries.length}`)
if (invalid?.length) console.log(`  ⚠ 無效 ${invalid.length} 列（格式錯誤，不進抽籤）`)
if (conflicts?.length) console.log(`  ⚠ 衝突 ${conflicts.length} 筆（車號重複等）`)

// ── 2. 鎖定車位 ──
let locked = new Set()
if (offline) {
  console.log('鎖定車位      （--offline，未扣除）')
} else {
  locked = await fetchLocked()
  console.log(`鎖定車位      ${locked.size} 格（唯讀取自 Supabase，已自可配池扣除）`)
}

// ── 3. 跑引擎（與 /allocate 同一套、同樣的種子衍生方式）──
const runAt = new Date().toISOString()
const motor = distribute({
  registrations: entries,
  seats: motorSeats().filter((s) => !locked.has(String(s.id))),
  seed,
  runAt,
})
const bikes = distributeBikes({
  registrations: entries,
  seats: bikeSeats().filter((s) => !locked.has(String(s.id))),
  seed: seed + '｜自行車',
  runAt,
})

console.log(`種子          ${motor.seed}（hash ${motor.seedHash}）`)
console.log(`執行時間      ${runAt}`)
console.log('')
console.log('機車          配到 ' + motor.summary.assigned + ' ／ 落選 ' + motor.summary.落選)
console.log('自行車        配到 ' + bikes.summary.assigned + ' ／ 落選 ' + bikes.summary.落選)

// 落選原因分布 —— 物業最需要看的一欄。
const reasons = {}
for (const l of motor.落選 || []) reasons[l.原因 || '(未註明)'] = (reasons[l.原因 || '(未註明)'] || 0) + 1
if (Object.keys(reasons).length) {
  console.log('')
  console.log('機車落選原因：')
  for (const [r, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${r}`)
}

// ── 4. 輸出 ──
if (outPath) {
  writeFileSync(outPath, mergedResultCSV([motor, bikes], { 公告日 }), 'utf8')
  const n = (motor.summary.assigned + motor.summary.落選) + (bikes.summary.assigned + bikes.summary.落選)
  console.log('')
  console.log(`已寫出 ${outPath}（${n} 列）`)
  console.log('→ 可接著跑：node scripts/build-shequbang-import.mjs --fee <物業檔> --result ' + outPath + ' --announce ' + (公告日 || '<公告日>'))
} else {
  console.log('')
  console.log('未指定 --out，未寫檔。')
}
