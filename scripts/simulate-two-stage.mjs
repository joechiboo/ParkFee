// 兩輪抽籤演練 — 在本機把 12/1 第一輪 → 發佈／繳費／重新匯出 → 12/15 第二輪整條鏈跑一遍，
// 並檢查不變量（不重複配位、第一輪結果不被動、放棄者不再配、每台只收一次、重機相鄰兩大位、順序號接續、可重現）。
//
// 🔒 完全唯讀：只讀 locked_seat（anon），引擎在記憶體跑，不發佈、不改線上資料。
//
// 流程（與 /allocate 頁同一套引擎 distribute）：
//   1. stage 1：只抽每戶第 1 輛一般機車（第 2 輛起、工作人員列待第二輪；重機待安排）
//   2. 模擬 12/1 發佈 + 12/2 出帳 + 12/10 繳費 + 重新匯出名冊：第一輪中籤者帶 車位編號；
//      --paid-ratio 決定第一輪中籤者多少比例繳費（預設 1＝全繳；0.9＝一成沒繳）。
//      第一輪中籤但沒繳的，模擬物業在維護頁批次解除 → 車位編號清空、格子回池、狀態視同放棄（--no-release-unpaid 可關）
//   3. stage 2：第 1 輛落空者電腦補位 → 第 2 輛起 → 重機相鄰兩大位 → 工作人員，再出第二輪帳單
//
// 用法：
//   node scripts/simulate-two-stage.mjs --roster private/roster-test-400.csv
//   node scripts/simulate-two-stage.mjs --roster <名冊.csv> --seed "2026-12-01" --paid-ratio 0.9
//   node scripts/simulate-two-stage.mjs --roster <名冊.csv> --offline            # 不連 Supabase、不扣鎖定位
//   node scripts/simulate-two-stage.mjs --roster <名冊.csv> --out-dir private    # 另寫 兩輪結果 CSV
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCSVObjects } from '../src/data/csv.js'
import { buildRoster } from '../src/data/registry.js'
import { distribute, REASON, VIA } from '../src/lottery/distribute.js'
import { mulberry32, hashSeed } from '../src/lottery/rng.js'
import { resultCSV, resultRows } from '../src/export/result.js'
import { FORFEIT_STATUS } from '../src/data/vehicleStatus.js'
import { feeFor } from '../src/data/fee.js'
import { feeByHousehold, billedPlates } from './build-shequbang-import.mjs'
import { motorSeats } from '../src/map/seats.js'
import { KIND } from '../src/map/seat-id.js'
import seatAdjacency from '../src/map/seat-adjacency.json' with { type: 'json' }
import { writeCsvUtf8 } from './lib/csv-out.mjs'

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback
}
const has = (name) => process.argv.includes(`--${name}`)

function loadEnv() {
  const env = { ...process.env }
  try {
    for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
      if (m && env[m[1]] == null) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* 無 .env */
  }
  return env
}
async function fetchLocked() {
  const env = loadEnv()
  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL
  const key = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY（可改用 --offline）')
  const res = await fetch(`${url}/rest/v1/locked_seat?select=車位編號`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  if (!res.ok) throw new Error(`讀取 locked_seat 失敗：HTTP ${res.status}`)
  return new Set((await res.json()).map((r) => String(r.車位編號)))
}

const rosterPath = arg('roster')
if (!rosterPath) {
  console.error('用法：node scripts/simulate-two-stage.mjs --roster <名冊.csv> [--seed s] [--paid-ratio 0.9] [--no-release-unpaid] [--offline] [--out-dir dir]')
  process.exit(1)
}
const seed = arg('seed', 'parkfee-two-stage')
const paidRatio = Number(arg('paid-ratio', '1'))
const releaseUnpaid = !has('no-release-unpaid')
const offline = has('offline')
const outDir = arg('out-dir')
const extraSmallFirst = has('extra-small-first')

// ── 名冊與鎖定 ──
const rows = parseCSVObjects(readFileSync(rosterPath, 'utf8'))
const { entries } = buildRoster(rows)
const locked = offline ? new Set() : await fetchLocked()
const seats = motorSeats().filter((s) => !locked.has(String(s.id)))
const seatType = new Map(motorSeats().map((s) => [String(s.id), s.type]))
const ADJ = seatAdjacency.adj || {}
const motors = entries.filter((e) => e.車種 !== KIND.BIKE)
const stat = (label, v) => console.log(`${label.padEnd(14)}${v}`)

console.log('=== 兩輪抽籤演練（唯讀，不影響線上狀態）===')
stat('名冊', `${rosterPath}：機車列 ${motors.length}（重機 ${motors.filter((e) => e.車種 === '重機').length}、工作人員 ${motors.filter((e) => e.工作人員 === 'Y').length}）`)
stat('鎖定車位', offline ? '（--offline，未扣除）' : `${locked.size} 格，可配 ${seats.length}`)
stat('種子', seed)
stat('設定', `paid-ratio=${paidRatio}  release-unpaid=${releaseUnpaid}  extra-small-first=${extraSmallFirst}`)

// ── stage 1 ──
const s1 = distribute({ registrations: entries, seats, seed, stage: 1, runAt: '2026-12-01T10:00:00+08:00' })
console.log('')
console.log(`【第一輪 12/1】配到 ${s1.summary.assigned}（含指派）／落選 ${s1.summary.落選}／待第二輪 ${s1.summary.待第二輪}／重機待安排 ${s1.summary.待安排 - s1.summary.待第二輪}／順序號迄 ${s1.summary.順序號迄}／剩餘 ${s1.summary.remaining}`)
for (const m of s1.log) console.log('   · ' + m)

// ── 模擬 12/1 發佈 + 12/10 繳費 + 重新匯出 ──
const won1 = new Map(s1.assigned.map((a) => [a.車號, a]))
const rng = mulberry32(hashSeed(seed + '｜paid'))
let released = 0
const entries2 = entries.map((e) => {
  const c = { ...e }
  const a = won1.get(c.車號)
  // 兩輪分開收費：只有第一輪配到位的車出帳，第 2 輛起 12/1 還不用繳。
  if (!a) {
    c.已繳費 = 'N'
    return c
  }
  const paid = paidRatio >= 1 ? true : rng() < paidRatio
  // 第一輪已指派（志願小位、櫃台指派）者保留原本的已繳費；中籤者依繳費模擬
  c.已繳費 = paid || (a.輪次 === 0 && e.已繳費 === 'Y') ? 'Y' : 'N'
  c.車位編號 = a.車位編號
  if (c.已繳費 !== 'Y' && releaseUnpaid) {
    c.車位編號 = '' // 物業 12/10 後在維護頁批次解除逾期未繳者
    c.配位狀態 = FORFEIT_STATUS
    released++
  }
  return c
})
const preset2 = entries2.filter((e) => e.車位編號)
console.log('')
console.log(`【模擬發佈／繳費／重新匯出】第一輪帶車位編號進第二輪 ${preset2.length} 台${releaseUnpaid ? `；逾期未繳解除、視同放棄 ${released} 台` : ''}`)

// ── stage 2 ──
const seqStart = s1.summary.順序號迄
const run2 = () => distribute({ registrations: entries2, seats, seed: seed + '｜第二輪', stage: 2, seqStart, extraSmallFirst, runAt: '2026-12-15T10:00:00+08:00' })
const s2 = run2()
const idsOf = (a) => String(a.車位編號).split('、').map((x) => x.trim()).filter(Boolean)
console.log('')
console.log(`【第二輪 12/15】配到 ${s2.summary.assigned}（含第一輪帶入 ${s2.rounds.find((r) => r.round === '指派')?.assignments.length ?? 0}）／落選 ${s2.summary.落選}／第一輪逾期放棄 ${s2.summary.未繳費}／順序號 ${seqStart + 1}–${s2.summary.順序號迄}／剩餘 ${s2.summary.remaining}`)
for (const m of s2.log) console.log('   · ' + m)
{
  // 剩餘池型別分布與還能湊幾對相鄰大位——重機配不到時先看這裡
  const taken = new Set(s2.assigned.flatMap(idsOf))
  const left = seats.filter((s) => !taken.has(String(s.id)))
  const byType = {}
  for (const s of left) byType[s.type] = (byType[s.type] || 0) + 1
  const leftBig = new Set(left.filter((s) => s.type === '大').map((s) => String(s.id)))
  let pairs = 0
  for (const id of leftBig) if ((ADJ[id] || []).some((n) => leftBig.has(String(n)) && +n > +id)) pairs++
  console.log(`   剩餘池：${JSON.stringify(byType)}，仍可湊相鄰兩大位 ${pairs} 對`)
}
const reasons = {}
for (const l of s2.落選) reasons[l.原因] = (reasons[l.原因] || 0) + 1
if (Object.keys(reasons).length) {
  console.log('   第二輪落選原因：')
  for (const [r, n] of Object.entries(reasons)) console.log(`     ${String(n).padStart(4)}  ${r}`)
}

// ── 不變量 ──
const fails = []
const ok = (name, cond, note = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${note ? ` — ${note}` : ''}`)
  if (!cond) fails.push(name)
}
console.log('')
console.log('不變量檢查：')

// 1. 兩輪合計無重複配位
{
  const seen = new Map()
  const dup = []
  for (const a of s2.assigned) for (const id of idsOf(a)) {
    if (seen.has(id)) dup.push(`${id}（${seen.get(id)}／${a.車號}）`)
    else seen.set(id, a.車號)
  }
  ok('第二輪結果無重複配位', dup.length === 0, dup.slice(0, 5).join(' '))
}
// 2. 第一輪帶入者（已繳，或逾期未解除），第二輪原位保留
{
  const by2 = new Map(s2.assigned.map((a) => [a.車號, a]))
  const moved = preset2.filter((e) => by2.get(e.車號)?.車位編號 !== e.車位編號).map((e) => e.車號)
  ok('第一輪帶入的車位第二輪原封不動', moved.length === 0, `${preset2.length} 台核對${moved.length ? '，異動 ' + moved.slice(0, 5).join(',') : ''}`)
  const r0 = s2.rounds.find((r) => r.round === '指派')?.assignments.length ?? 0
  ok('第一輪帶入者走指派輪、不佔順序號', r0 === preset2.length && s2.assigned.filter((a) => a.輪次 === 0).every((a) => a.順序號 == null))
}
// 3. 鎖定位絕不被配出
{
  const bad = s2.assigned.flatMap(idsOf).filter((id) => locked.has(id))
  ok('鎖定車位未被配出', bad.length === 0, bad.slice(0, 5).join(','))
}
// 4. 第二輪一般機車（非工作人員、未放棄）全部有位，除非池已空
{
  const target = entries2.filter((e) => e.車種 === '一般' && e.工作人員 !== 'Y' && e.配位狀態 !== FORFEIT_STATUS)
  const by2 = new Map(s2.assigned.map((a) => [a.車號, a]))
  const miss = target.filter((e) => !by2.has(e.車號))
  const poolEmpty = s2.summary.remaining === 0
  ok('一般機車（未放棄）全部配到位', miss.length === 0 || poolEmpty, miss.length ? `${miss.length} 台沒位，剩餘 ${s2.summary.remaining}` : `${target.length} 台`)
}
// 5. 重機：兩格皆大位且實體相鄰；不在第二輪待安排
{
  const heavies = s2.assigned.filter((a) => a.車種 === '重機')
  const bad = heavies.filter((a) => {
    const ids = idsOf(a)
    return ids.length !== 2 || ids.some((id) => seatType.get(id) !== '大') || !(ADJ[ids[0]] || []).map(String).includes(ids[1])
  })
  ok('重機皆配相鄰兩大位', bad.length === 0, `${heavies.length} 台重機配到${bad.length ? '，異常 ' + bad.map((a) => a.車號 + ':' + a.車位編號).slice(0, 3).join(' ') : ''}`)
  ok('第二輪待安排只剩視同放棄者', s2.待安排.every((w) => w.原因 === REASON.UNPAID), `${s2.待安排.length} 台`)
}
// 6. 第一輪：第 2 輛起與工作人員列待第二輪、沒有電腦輪
{
  ok('第一輪只有指派／R1／第 1 輛電腦選位（沒有第 2 輛、工作人員輪）', s1.rounds.every((r) => r.round === '指派' || r.round === 1 || r.round === '電腦'))
  ok('第一輪待第二輪＝第 2 輛起＋工作人員（非重機）', s1.待安排.filter((w) => w.原因 === REASON.NEXT_STAGE).every((w) => w.車種 !== '重機' && (w.第幾輛 >= 2 || w.工作人員)))
}
// 7. 順序號：第二輪從 seqStart+1 起、唯一
{
  const seqs = [...s2.assigned, ...s2.落選].map((x) => x.順序號).filter((n) => n != null)
  const uniq = new Set(seqs).size === seqs.length
  ok('第二輪順序號接續且唯一', uniq && (!seqs.length || Math.min(...seqs) === seqStart + 1), `${seqStart + 1}–${Math.max(...seqs, seqStart)}`)
}
// 8. 工作人員排在重機之後（輪次順序）
{
  const order = s2.rounds.map((r) => String(r.round))
  const hi = order.indexOf('重機')
  const si = order.indexOf('工作人員')
  ok('輪次順序：指派→1→電腦1→2+→電腦2→重機→工作人員', (hi < 0 || si < 0 || hi < si) && order[0] === '指派' || order[0] === '1', order.join(' → '))
}
// 9. 可重現
ok('同種子第二輪可重現', JSON.stringify(run2().assigned) === JSON.stringify(s2.assigned))
// 10. 視同放棄者不再配到位
{
  const out = new Set(entries2.filter((e) => e.配位狀態 === FORFEIT_STATUS).map((e) => e.車號))
  const bad = s2.assigned.filter((a) => out.has(a.車號)).map((a) => a.車號)
  ok('視同放棄者第二輪不再配位', bad.length === 0, `${out.size} 台放棄${bad.length ? '，被配到 ' + bad.slice(0, 5).join(',') : ''}`)
}
// 11. 兩輪帳單：每台配到位的機車恰好出帳一次，金額相符（第二輪結果帶著第一輪的車，不排除就重收）
{
  const rows1 = resultRows(s1, { 公告日: '2026-12-01' })
  const rows2 = resultRows(s2, { 公告日: '2026-12-15' })
  const sum = (m) => [...m.values()].reduce((t, v) => t + v.金額, 0)
  const bill1 = feeByHousehold(rows1)
  const bill2 = feeByHousehold(rows2, { 已出帳: billedPlates(rows1) })
  const preBilled = s1.assigned.filter((a) => a.已繳費) // 抽籤前已在櫃台繳清，不出帳
  const paidPre = new Set(preBilled.map((a) => a.車號))
  const expected2 = s2.assigned.filter((a) => !won1.has(a.車號) && !a.已繳費).reduce((t, a) => t + feeFor(a.車種), 0)
  const expected1 = s1.assigned.filter((a) => !paidPre.has(a.車號)).reduce((t, a) => t + feeFor(a.車種), 0)
  console.log(`   第一輪帳單 ${bill1.size} 戶 ${sum(bill1).toLocaleString()} 元；第二輪帳單 ${bill2.size} 戶 ${sum(bill2).toLocaleString()} 元`)
  ok('第一輪帳單＝第一輪配到位且未繳的車', sum(bill1) === expected1, `${sum(bill1)} ／ 預期 ${expected1}`)
  ok('第二輪帳單只收本輪新配的，不重收第一輪', sum(bill2) === expected2, `${sum(bill2)} ／ 預期 ${expected2}`)
}

if (outDir) {
  const p1 = join(outDir, `兩輪演練-第一輪-${seed}.csv`)
  const p2 = join(outDir, `兩輪演練-第二輪-${seed}.csv`)
  writeCsvUtf8(p1, resultCSV(s1, { 公告日: '2026-12-01' }))
  writeCsvUtf8(p2, resultCSV({ ...s2, assigned: s2.assigned.filter((a) => a.輪次 !== 0) }, { 公告日: '2026-12-15' }))
  console.log('')
  console.log(`已寫出 ${p1}、${p2}（第二輪只含本輪新配的，與發佈 merge 送的一致）`)
}

console.log('')
console.log(fails.length ? `❌ ${fails.length} 項不變量不符：${fails.join('；')}` : '✅ 全部不變量通過')
process.exit(fails.length ? 1 : 0)
