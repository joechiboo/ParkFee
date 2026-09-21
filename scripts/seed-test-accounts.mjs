// 建立／更新複測用的測試帳號（走正式 Edge Function，與住戶線上登記同一條路）。
//
// 為什麼用腳本而不是手填表單：登記表單的 UI 已於 2026-09-18 階段 1–4 驗過，
//   現在要補的是**引擎路徑**（R0 無障礙輪、志願小位免抽、一戶多車…），
//   七戶手填要 40 分鐘且容易打錯；用 API 建精準又可重跑。
//
// ⚠️ 這些是**測試資料**，11 月抽籤前必須清除 —— 見 TODO「🧹 11 月抽籤前」條目。
//   戶號一律 S1-99x（三位數，與 mock 的 S1-9x 不撞號）、車號 TEST-0xx。
//
// 用法：node scripts/seed-test-accounts.mjs [--dry]
import { readFileSync } from 'node:fs'

const DRY = process.argv.includes('--dry')

const ENV = (() => {
  const env = { ...process.env }
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m && env[m[1]] == null) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
})()
const URL_ = ENV.VITE_SUPABASE_URL
const KEY = ENV.VITE_SUPABASE_ANON_KEY

// 志願都落在 230–234 這一帶（連號區）：多車戶才看得出互相排擠。
// 另塞兩個「該被跳過」的：482＝已鎖定、2＝公益位（一般戶不得選）。
const 連號區 = ['230', '231', '232', '233', '234']

const ACCOUNTS = [
  {
    戶號: 'S1-993',
    電話: '0912000993',
    說明: '一戶多車混車種：一般（第1輛）＋重機（第2輛），共用同一份志願',
    車位志願: ['482', '2', ...連號區], // 482 已鎖定、2 公益位 → 皆應被跳過
    vehicles: [
      { 車號: 'TEST-004', 車種: '一般' },
      { 車號: 'TEST-005', 車種: '重機' },
    ],
  },
  {
    戶號: 'S1-994',
    電話: '0912000994',
    說明: '三台一般 → R1/R2/R3 三輪；電腦選號**關閉**（驗志願落空即落選）',
    車位志願: 連號區,
    志願落選保底: false,
    vehicles: [
      { 車號: 'TEST-006', 車種: '一般' },
      { 車號: 'TEST-007', 車種: '一般' },
      { 車號: 'TEST-008', 車種: '一般' },
    ],
  },
  {
    戶號: 'S1-995',
    電話: '0912000995',
    說明: '★ 身障 → R0 無障礙輪（至今從未有真實帳號走過）',
    車位志願: [],
    vehicles: [{ 車號: 'TEST-009', 車種: '一般', 身障: true }],
  },
  {
    戶號: 'S1-996',
    電話: '0912000996',
    說明: '★ 志願小位 → 免抽、依登記序選小位（辦法伍二（五），從未走過）',
    車位志願: [],
    vehicles: [{ 車號: 'TEST-010', 車種: '一般', 志願小位: true }],
  },
  {
    戶號: 'S1-997',
    電話: '0912000997',
    說明: '社宅＋身障 → 例外：無障礙位不分社宅身分，走 R0 拿一般無障礙位',
    社宅: true,
    車位志願: [],
    vehicles: [{ 車號: 'TEST-011', 車種: '一般', 身障: true }],
  },
  {
    戶號: 'S1-998',
    電話: '0912000998',
    說明: '社宅重機 → 吃 2 格公益位',
    社宅: true,
    車位志願: [],
    vehicles: [{ 車號: 'TEST-012', 車種: '重機' }],
  },
  {
    戶號: 'S1-999',
    電話: '0912000999', // 純自行車戶：電話必填（無車牌，日後只能臨櫃查）
    說明: '純自行車戶：無車牌、免費、不排志願、不能線上登入',
    車位志願: [],
    vehicles: [{ 車種: '自行車', 特徵: '測試用·紅色小折' }],
  },
]

async function call(fn, body) {
  const r = await fetch(`${URL_}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, j }
}

for (const a of ACCOUNTS) {
  const { 戶號, 電話, 社宅, 車位志願, 志願落選保底, vehicles, 說明 } = a
  process.stdout.write(`${戶號.padEnd(8)} ${說明}\n`)
  if (DRY) continue

  // 已存在就改用 update-household（register 會擋重複登記）
  const probe = await call('login', { 戶號, 車號: vehicles[0].車號 || '' })
  const exists = !!probe.j?.household
  const payload = { 戶號, 電話, 社宅: !!社宅, 工作人員: false, vehicles }
  const res = exists
    ? await call('update-household', { ...payload, 認證車號: vehicles[0].車號 || '' })
    : await call('register', payload)

  if (!res.ok || res.j?.error) {
    console.log(`         ✗ ${exists ? '更新' : '建立'}失敗：${res.j?.error || res.status}`)
    continue
  }
  const plate = res.j?.household?.vehicles?.[0]?.車號 || vehicles[0].車號
  console.log(`         ${exists ? '已更新' : '已建立'}（${res.j?.household?.vehicles?.length ?? 0} 台）`)

  // 志願（戶層級）—— 自行車不排志願，跳過
  if (車位志願?.length) {
    const w = await call('save-wishes', {
      戶號,
      車位志願,
      志願落選保底: 志願落選保底 !== false,
      認證車號: plate,
    })
    console.log(
      w.ok && !w.j?.error
        ? `         志願 ${車位志願.length} 筆、電腦選號 ${志願落選保底 === false ? '關' : '開'}`
        : `         ✗ 志願存檔失敗：${w.j?.error || w.status}`,
    )
  }
}

console.log('\n⚠️ 測試資料，11 月抽籤前須清除（TODO「🧹 11 月抽籤前」）')
