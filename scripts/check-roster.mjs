// 登記資料健檢（防呆偵測）——11/15–30 登記期間設斷點跑、12/1 抽籤前再跑一輪總檢。
//
// ⚠️ 只讀不寫、只報告不修正。輸出「要人工判斷」的清單交物業處理，
//    因為多數異常（社宅戶超額、重機吃兩格公益位）不是資料錯，是規則衝突，得由人決定。
//
// 用法：
//   node scripts/check-roster.mjs                    # 自動抓 private/ 最新一份 roster-*.csv
//   node scripts/check-roster.mjs <roster.csv>       # 指定檔案
//   （鎖定車位會嘗試連 Supabase 取得；連不到就以「未扣鎖定」計算並標註）
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseCSVObjects } from '../src/data/csv.js'
import { PUBLIC_BIKE_IDS, toBikeId, isBikeId } from '../src/map/seat-id.js'

// ── 車位主檔（直接讀 JSON：seats.js 走 import attribute，純 Node 載不動）──
const cls = JSON.parse(readFileSync('src/map/b1-classification.json', 'utf8'))
const MOTOR_CATS = { small: '小', motor: '大', access: '無障礙' }
const motorSeats = cls.seats
  .filter((s) => s.cat in MOTOR_CATS)
  .map((s) => ({ id: String(s.id), type: MOTOR_CATS[s.cat], public: !!s.public }))
const bikeIds = new Set(cls.seats.filter((s) => s.cat === 'bike').map((s) => toBikeId(s.id)))
const motorById = new Map(motorSeats.map((s) => [s.id, s]))
const publicBike = new Set(PUBLIC_BIKE_IDS)

// ── 鎖定清單（可選）──
async function fetchLocked() {
  try {
    const env = {}
    for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
    const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL
    const key = env.VITE_SUPABASE_ANON_KEY
    if (!url || !key) return null
    const r = await fetch(`${url}/rest/v1/locked_seat?select=車位編號`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (!r.ok) return null
    return new Set((await r.json()).map((x) => String(x.車位編號)))
  } catch {
    return null
  }
}

// ── 工作人員名單（可選）──
// 預設讀 private/staff-roster.txt；可用環境變數 STAFF_ROSTER 指到其他路徑（換機器時方便）。
// ⚠️ 含員工真名，**本 repo 為公開**故一律不進版控；與 private/roster-*.csv 同進退。
// 線上表單開放自行勾選「工作人員」→ 無從驗證身分，故於此比對名單，
// **名單外者標記出來交物業確認**（不自動剔除：可能是新進同仁或名單未更新）。
function loadStaffRoster() {
  try {
    return new Set(
      readFileSync(process.env.STAFF_ROSTER || 'private/staff-roster.txt', 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        // 「崗位-姓名」只取姓名；純姓名原樣
        .map((l) => (l.includes('-') ? l.slice(l.lastIndexOf('-') + 1) : l).trim()),
    )
  } catch {
    return null
  }
}

// ── 名冊 ──
const argPath = process.argv[2]
const rosterPath =
  argPath ||
  (() => {
    const files = readdirSync('private')
      .filter((f) => /^roster-.*\.csv$/.test(f))
      .sort()
    if (!files.length) throw new Error('private/ 底下找不到 roster-*.csv，請先跑 export-roster.mjs 或指定路徑')
    return join('private', files[files.length - 1])
  })()

const rows = parseCSVObjects(
  readFileSync(rosterPath, 'utf8')
    .replace(/^﻿/, '') // BOM（export-roster 會加，Excel 用）
    .split(/\r?\n/)
    .filter((l) => !l.startsWith('#')) // 允許檔首註解（fixture 用）
    .join('\n'),
)
const locked = await fetchLocked()
const staffRoster = loadStaffRoster()

// ── 整理成「戶」與「車」兩層 ──
const yes = (v) => String(v ?? '').trim().toUpperCase() === 'Y'
const houses = new Map()
for (const r of rows) {
  const id = String(r.戶號 ?? '').trim()
  if (!houses.has(id)) {
    houses.set(id, {
      戶號: id,
      社宅: yes(r.社宅),
      工作人員: yes(r.工作人員),
      電話: String(r.聯絡電話 ?? '').trim(),
      志願: String(r.車位志願 ?? '').split(/[、,]/).map((s) => s.trim()).filter(Boolean),
      cars: [],
    })
  }
  houses.get(id).cars.push({
    車號: String(r.車號 ?? '').trim(),
    車種: String(r.車種 ?? '一般').trim(),
    第幾輛: Number(r.第幾輛) || 1,
    身障: yes(r.身障),
    志願小位: yes(r.志願小位),
    車位編號: String(r.車位編號 ?? '').trim(),
  })
}
const all = [...houses.values()];
const isBikeCar = (c) => c.車種 === '自行車'

// ── 容量 ──
const notLocked = (id) => !locked || !locked.has(id)
const cap = {
  公益機車: motorSeats.filter((s) => s.public && notLocked(s.id)).length,
  公益自行車: [...publicBike].filter(notLocked).length,
  無障礙: motorSeats.filter((s) => s.type === '無障礙' && notLocked(s.id)).length,
  一般機車: motorSeats.filter((s) => !s.public && s.type !== '無障礙' && notLocked(s.id)).length,
  一般自行車: [...bikeIds].filter((id) => !publicBike.has(id) && notLocked(id)).length,
}

// ── 檢查 ──
const findings = [] // {level:'warn'|'info', title, detail, rows[]}
const add = (level, title, detail, list = []) => findings.push({ level, title, detail, rows: list })

// 1) 社宅 vs 公益位容量
const social = all.filter((h) => h.社宅)
const socialMotor = social.flatMap((h) => h.cars.filter((c) => !isBikeCar(c)).map((c) => ({ h, c })))
const socialHeavy = socialMotor.filter(({ c }) => c.車種 === '重機')
const socialSeatsNeeded = socialMotor.length + socialHeavy.length // 重機吃 2 格
const socialBike = social.flatMap((h) => h.cars.filter(isBikeCar).map((c) => ({ h, c })))

if (socialSeatsNeeded > cap.公益機車)
  add('warn', '社宅戶機車需求超過公益位',
    `需 ${socialSeatsNeeded} 格（含重機 ${socialHeavy.length} 台各佔 2 格）＞ 可用公益位 ${cap.公益機車} 格。` +
    `超額者會落選且無保底（社宅戶只能配公益位）→ 需決定是否納候補、或依 Q23 釋出/調整。`,
    socialMotor.map(({ h, c }) => `${h.戶號} ${c.車號}（${c.車種}）`))
if (socialHeavy.length)
  add('info', '社宅戶登記重機（一台吃 2 格公益位）',
    `共 ${socialHeavy.length} 台。公益位僅 ${cap.公益機車} 格，請確認是否允許。`,
    socialHeavy.map(({ h, c }) => `${h.戶號} ${c.車號}`))
if (socialBike.length > cap.公益自行車)
  add('warn', '社宅戶自行車需求超過公益自行車位',
    `需 ${socialBike.length} 台 ＞ 可用 ${cap.公益自行車} 格（114–118）。`,
    socialBike.map(({ h, c }) => `${h.戶號} ${c.車號}`))

// 2) 身障 vs 無障礙位
const disabled = all.flatMap((h) => h.cars.filter((c) => c.身障 && c.第幾輛 === 1 && !isBikeCar(c)).map((c) => ({ h, c })))
if (disabled.length > cap.無障礙)
  add('warn', '身障登記數超過無障礙車位',
    `登記 ${disabled.length} ＞ 可用 ${cap.無障礙} 格（8 格扣掉鎖定保留）。超額者依 R0 規則併入一般抽籤。`,
    disabled.map(({ h, c }) => `${h.戶號} ${c.車號}`))

// 3) 戶號格式
const badHouse = all.filter(
  (h) => !/^[A-HS]\d{1,2}-\d{1,2}$/i.test(h.戶號) && !/^員工-\d{1,3}$/.test(h.戶號),
)
if (badHouse.length)
  add('warn', '戶號格式不符', '預期如 A3-6（棟樓-戶別）。格式不符會影響去重與對帳。',
    badHouse.map((h) => h.戶號))

// 3.5) 工作人員：比對名單（線上可自行勾選 → 必須人工把關）
const staffHouses = all.filter((h) => h.工作人員 || /^員工-/.test(h.戶號))
if (staffHouses.length && staffRoster) {
  const nameOf = (h) => h.戶號.replace(/^員工-/, '').trim()
  const unknown = staffHouses.filter((h) => !staffRoster.has(nameOf(h)))
  if (unknown.length)
    add('warn', '登記為工作人員但不在員工名單中',
      '線上表單可自行勾選、系統無從驗證 → 請物業逐筆確認是否確為社區工作人員（可能是新進同仁或名單未更新）。' +
      '工作人員免收費用、配位排住戶之後。',
      unknown.map((h) => `${h.戶號}（${h.cars.map((c) => c.車號).join('、')}）`))
} else if (staffHouses.length && !staffRoster) {
  add('info', '有工作人員登記，但找不到員工名單可比對',
    '請建立 private/staff-roster.txt（一行一位，可用「崗位-姓名」）後重跑，即可標出名單外的登記。',
    staffHouses.map((h) => h.戶號))
}

// 4) 車號跨戶重複
const plateOwners = new Map()
for (const h of all) for (const c of h.cars) {
  if (!c.車號 || isBikeCar(c)) continue // 自行車車號是合成鍵，本就含戶號
  if (!plateOwners.has(c.車號)) plateOwners.set(c.車號, new Set())
  plateOwners.get(c.車號).add(h.戶號)
}
const dupPlates = [...plateOwners].filter(([, hs]) => hs.size > 1)
if (dupPlates.length)
  add('warn', '同一車號登記在不同戶', '一車一位，須確認實際歸屬後刪除其一。',
    dupPlates.map(([p, hs]) => `${p} → ${[...hs].join('、')}`))

// 5) 單戶車輛數異常
const manyCars = all.filter((h) => h.cars.filter((c) => !isBikeCar(c)).length >= 3)
if (manyCars.length)
  add('info', '單戶登記 3 台以上機車', '非違規（辦法允許第三輛以上依序辦理），但排在最後輪、多半配不到。',
    manyCars.map((h) => `${h.戶號}（${h.cars.filter((c) => !isBikeCar(c)).length} 台）`))

// 6) 純自行車戶缺電話
const bikeOnlyNoPhone = all.filter((h) => h.cars.every(isBikeCar) && !h.電話)
if (bikeOnlyNoPhone.length)
  add('warn', '純自行車戶未留電話',
    '自行車無車牌不能登入查詢，電話是物業唯一能連絡上的方式（登記頁本應必填）。',
    bikeOnlyNoPhone.map((h) => h.戶號))

// 7) 志願指到不存在／已鎖定的車位
const badWish = []
const lockedWish = []
for (const h of all) for (const w of h.志願) {
  const id = isBikeId(w) ? toBikeId(w) : String(w)
  const exists = motorById.has(id) || bikeIds.has(id)
  if (!exists) badWish.push(`${h.戶號} → ${w}`)
  else if (locked?.has(id)) lockedWish.push(`${h.戶號} → ${w}`)
}
if (badWish.length)
  add('warn', '志願指到不存在的車位編號', '該志願必然落空。可能是手動匯入或前端版本不一致。', badWish)
if (lockedWish.length)
  add('info', '志願指到已鎖定的車位', '鎖定位不進抽籤，該志願會被跳過；若鎖定是暫時的可考慮解鎖。', lockedWish)

// 8) 社宅／一般 與 公益位 的志願錯配（會直接落選）
const wrongSocial = []
const wrongNormal = []
for (const h of all) for (const w of h.志願) {
  const id = isBikeId(w) ? toBikeId(w) : String(w)
  const isPub = motorById.get(id)?.public ?? publicBike.has(id)
  if (!motorById.has(id) && !bikeIds.has(id)) continue
  if (h.社宅 && !isPub) wrongSocial.push(`${h.戶號} → ${w}`)
  if (!h.社宅 && isPub) wrongNormal.push(`${h.戶號} → ${w}`)
}
if (wrongSocial.length)
  add('info', '社宅戶志願指到一般車位', '依 Q7 分流該志願不會配出（無障礙位除外）。可提醒住戶改志願。', wrongSocial)
if (wrongNormal.length)
  add('info', '一般戶志願指到公益車位', '公益位為社宅戶專用，該志願不會配出。可提醒住戶改志願。', wrongNormal)

// ── 輸出 ──
const motorCars = all.reduce((n, h) => n + h.cars.filter((c) => !isBikeCar(c)).length, 0)
const bikeCars = all.reduce((n, h) => n + h.cars.filter(isBikeCar).length, 0)
console.log(`\n登記資料健檢 — ${rosterPath}`)
console.log('─'.repeat(64))
console.log(`名冊：${all.length} 戶 / 機車 ${motorCars} 台 / 自行車 ${bikeCars} 台（社宅 ${social.length} 戶）`)
console.log(
  `容量：公益機車 ${cap.公益機車}｜公益自行車 ${cap.公益自行車}｜無障礙 ${cap.無障礙}｜` +
  `一般機車 ${cap.一般機車}｜一般自行車 ${cap.一般自行車}` +
  (locked ? `（已扣鎖定 ${locked.size} 格）` : '　⚠️ 未連上 Supabase，未扣鎖定車位'),
)
console.log('─'.repeat(64))

if (!findings.length) {
  console.log('\n✅ 沒有需要人工判斷的項目。\n')
} else {
  const warn = findings.filter((f) => f.level === 'warn')
  const info = findings.filter((f) => f.level === 'info')
  for (const f of [...warn, ...info]) {
    console.log(`\n${f.level === 'warn' ? '⚠️ ' : 'ℹ️ '}${f.title}（${f.rows.length} 筆）`)
    console.log(`   ${f.detail}`)
    for (const r of f.rows.slice(0, 12)) console.log(`   ・${r}`)
    if (f.rows.length > 12) console.log(`   …其餘 ${f.rows.length - 12} 筆`)
  }
  console.log(`\n─ 合計：需處理 ${warn.length} 項、參考 ${info.length} 項 ─\n`)
}
