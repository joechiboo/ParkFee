// 驗證登記時窗（_shared/window.ts）在正式站的實際行為。11/10 關時窗後跑一次、11/15 開放後再跑一次。
//
// 關閉狀態（預設 --expect closed）應看到：
//   登入可用（查詢不受限）；新戶登記、修改登記、排志願、選志願小位都被擋 403 並顯示「尚未開放（2026/11/15 起）」；
//   管理員帶密碼在登記頁櫃台補登成功。
// 開放狀態（--expect open）：四種操作都成功；用來驗腳本本身，11/15 後也可跑。
//
// 不會留下髒資料：修改登記與排志願送的是該戶現有資料（原樣寫回）；志願小位若意外成功會立刻放棄；
//   新戶登記只在 closed 模式送（被擋就不會建戶），admin 補登建的戶號屬 Z%，11/10 清除 SQL 會一併刪。
//
// 用法：
//   node scripts/verify-window.mjs                       # 期待關閉
//   node scripts/verify-window.mjs --expect open         # 期待開放
//   $env:ADMIN_PASSWORD='…'; node scripts/verify-window.mjs   # 加驗 admin 櫃台補登（沒給就略過）
// 測試身分：戶號 Z99／車號 DEMO-099（經理試玩帳號，Z 棟＝測試棟）；補登用 Z98；新戶登記用 Z97。
import { readFileSync } from 'node:fs'

const ENV = (() => {
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
})()
const URL_ = ENV.VITE_SUPABASE_URL
const KEY = ENV.VITE_SUPABASE_ANON_KEY
if (!URL_ || !KEY) {
  console.error('缺少 VITE_SUPABASE_URL／VITE_SUPABASE_ANON_KEY（.env）')
  process.exit(2)
}

const argv = process.argv.slice(2)
const EXPECT = argv.includes('--expect') ? argv[argv.indexOf('--expect') + 1] : 'closed'
if (!['closed', 'open'].includes(EXPECT)) {
  console.error('--expect 只能是 closed 或 open')
  process.exit(2)
}
const ADMIN_PASSWORD = ENV.ADMIN_PASSWORD || ''

const TESTER = { 戶號: 'Z99', 車號: 'DEMO-099' }
const NEW_HID = 'Z97'
const COUNTER_HID = 'Z98'
const SMALL_SEAT = '8' // 一般小位，志願小位實測也用這格

async function call(name, body) {
  const res = await fetch(`${URL_}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, data }
}

const results = []
function record(step, ok, note) {
  results.push({ step, ok, note })
  console.log(`${ok ? '✅' : '❌'} ${step}${note ? ` — ${note}` : ''}`)
}
const CLOSED_RE = /尚未開放|已於 .* 截止/

// 1) 登入：任何時候都要通
const login = await call('login', TESTER)
const h = login.data?.household
if (!h) {
  record('登入 Z99', false, `status ${login.status} ${JSON.stringify(login.data)}；測試帳號不在或已清除，後面無法驗`)
  summary()
}
record('登入 Z99（查詢不受時窗限制）', true, `${h.vehicles.length} 台車、志願 ${h.車位志願.length} 筆`)

const first = h.vehicles.find((v) => v.車種 !== '自行車' && v.第幾輛 === 1)
const 認證車號 = TESTER.車號

// 期待值判斷：closed → 403 且訊息含「尚未開放」；open → 200 且回 household
function judge(step, r, extraOkCheck = () => true) {
  const msg = r.data?.error || ''
  if (EXPECT === 'closed') {
    const ok = r.status === 403 && CLOSED_RE.test(msg)
    record(step, ok, ok ? msg : `預期 403「尚未開放」，實得 ${r.status} ${msg || JSON.stringify(r.data)}`)
    return ok
  }
  const ok = r.status === 200 && !!r.data?.household && extraOkCheck(r.data.household)
  record(step, ok, ok ? '成功' : `預期 200，實得 ${r.status} ${msg || JSON.stringify(r.data)}`)
  return ok
}

// 2) 新戶登記（只在 closed 模式送：被擋就不會建戶；open 模式略過，避免製造帳號）
if (EXPECT === 'closed') {
  const r = await call('register', {
    戶號: NEW_HID,
    電話: '0900000097',
    vehicles: [{ 車號: 'TEST-097', 車種: '一般', 身障: false, 志願小位: false }],
  })
  if (r.status === 409) record('新戶登記被擋', false, `${NEW_HID} 已存在（上次跑在開放狀態建的？），清除 SQL 會刪；本項無法判定`)
  else judge('新戶登記被擋', r)
} else {
  record('新戶登記（open 模式略過）', true, '不建帳號')
}

// 3) 修改登記：原樣寫回
{
  const vehicles = h.vehicles.map((v) =>
    v.車種 === '自行車'
      ? { 車種: '自行車', 特徵: v.特徵 || '' }
      : { 車號: v.車號, 車種: v.車種, 身障: !!v.身障, 志願小位: !!v.志願小位, 特徵: v.特徵 || '' },
  )
  const r = await call('update-household', {
    戶號: h.戶號,
    電話: h.電話,
    社宅: h.社宅,
    工作人員: h.工作人員,
    vehicles,
    認證車號,
  })
  judge('修改登記（原樣寫回）', r)
}

// 4) 排志願：原樣寫回
{
  const r = await call('save-wishes', {
    戶號: h.戶號,
    車位志願: h.車位志願,
    志願落選保底: h.志願落選保底,
    認證車號,
  })
  judge('排志願（原樣寫回）', r)
}

// 5) 志願小位選定：closed 應 403；open 會真的鎖格 → 立刻放棄還原
if (!first) {
  record('志願小位選定', false, 'Z99 沒有第一輛機車，無法驗')
} else if (first.車位編號 && first.配位狀態 !== '志願小位') {
  record('志願小位選定', false, `Z99 第一輛已有車位 ${first.車位編號}（${first.配位狀態}），此路徑驗不到時窗`)
} else {
  const held = first.配位狀態 === '志願小位' ? String(first.車位編號) : null
  const seat = held || SMALL_SEAT
  const r = await call('claim-seat', { op: 'claim', 戶號: h.戶號, 車位編號: seat, 認證車號 })
  if (EXPECT === 'closed') {
    judge(`志願小位選定 ${seat}`, r)
    if (r.status === 200 && !held) {
      const rel = await call('claim-seat', { op: 'release', 戶號: h.戶號, 認證車號 })
      record('（意外鎖到格，已放棄還原）', rel.status === 200, `release ${rel.status}`)
    }
  } else if (r.status === 409 && r.data?.taken) {
    record(`志願小位選定 ${seat}`, true, '時窗開放（格子被別人選走，屬正常 409）')
  } else {
    const ok = judge(`志願小位選定 ${seat}`, r)
    if (ok && !held) {
      const rel = await call('claim-seat', { op: 'release', 戶號: h.戶號, 認證車號 })
      record('放棄還原', rel.status === 200, `release ${rel.status}`)
    } else if (held) {
      record('（Z99 原本就持有該格，未動）', true)
    }
  }
}

// 6) admin 櫃台補登（任何時候都應成功）
if (!ADMIN_PASSWORD) {
  record('admin 櫃台補登（略過）', true, '未給 ADMIN_PASSWORD 環境變數')
} else {
  const r = await call('register', {
    戶號: COUNTER_HID,
    電話: '0900000098',
    vehicles: [{ 車號: 'TEST-098', 車種: '一般', 身障: false, 志願小位: false }],
    password: ADMIN_PASSWORD,
  })
  if (r.status === 409) record('admin 櫃台補登', true, `${COUNTER_HID} 已存在（之前補登過），清除 SQL 會刪`)
  else record('admin 櫃台補登', r.status === 200 && !!r.data?.household, r.status === 200 ? `建了 ${COUNTER_HID}` : `${r.status} ${r.data?.error || ''}`)
}

summary()

function summary() {
  const bad = results.filter((x) => !x.ok)
  console.log('')
  console.log(`期待狀態：${EXPECT === 'closed' ? '關閉' : '開放'}；${results.length} 項，${bad.length} 項不符`)
  if (bad.length) {
    console.log('不符項目：')
    for (const b of bad) console.log(`  - ${b.step}：${b.note}`)
  }
  process.exit(bad.length ? 1 : 0)
}
