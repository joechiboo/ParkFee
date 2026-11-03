// 真 API 驗 assign-seat op=pay（12/11 繳費回查用的後端）：對測試戶 Z99 標已繳 → 讀回來源 → 撤回 → 讀回清空。
// 不留髒資料：結束時 Z99 的 已繳費 應回到 false、繳費來源 null。
//
// 用法：$env:ADMIN_PASSWORD='…'; node scripts/verify-pay.mjs
//   選項：--household Z99（測試戶，預設 Z99；該戶要有至少一台機車在正式站）
import { readFileSync } from 'node:fs'

const ENV = (() => {
  const env = { ...process.env }
  try {
    for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* 無 .env 也行 */
  }
  return env
})()
const URL_ = ENV.VITE_SUPABASE_URL
const KEY = ENV.VITE_SUPABASE_ANON_KEY
const PASSWORD = ENV.ADMIN_PASSWORD
if (!URL_ || !KEY || !PASSWORD) {
  console.error('缺少 VITE_SUPABASE_URL／VITE_SUPABASE_ANON_KEY（.env）或 ADMIN_PASSWORD（環境變數）')
  process.exit(2)
}
const i = process.argv.indexOf('--household')
const HID = i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : 'Z99'
const SOURCE = `驗證 ${new Date().toISOString().slice(0, 10)}`

async function call(body) {
  const res = await fetch(`${URL_}/functions/v1/assign-seat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ password: PASSWORD, ...body }),
  })
  return { status: res.status, data: await res.json().catch(() => null) }
}
// list 只回有車位編號的車；測試戶若沒車位就看不到來源，改用 pay 的回傳筆數當依據。
async function seen() {
  const { data } = await call({ op: 'list' })
  return (data?.assignments || []).filter((a) => a.戶號 === HID).map((a) => ({ 車位: a.車位編號, 已繳費: a.已繳費, 來源: a.繳費來源 }))
}

const fails = []
const check = (name, ok, info = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${info ? `  ${info}` : ''}`)
  if (!ok) fails.push(name)
}

console.log(`=== verify-pay：測試戶 ${HID}，來源字串「${SOURCE}」===`)
let r = await call({ op: 'pay', 戶號列表: [HID], 來源: '' })
check('缺來源 → 400', r.status === 400, r.data?.error)
r = await call({ op: 'pay', 戶號列表: ['ZZ99-NOPE'], 來源: SOURCE })
check('查無戶號 → ok 但 戶數 0、查無 1', r.status === 200 && r.data?.戶數 === 0 && r.data?.查無戶號?.length === 1, JSON.stringify(r.data))
r = await call({ op: 'pay', 戶號列表: [HID], 來源: SOURCE })
check('標已繳 → 戶數 1、台數 ≥ 1', r.status === 200 && r.data?.戶數 === 1 && r.data?.台數 >= 1, JSON.stringify(r.data))
let s = await seen()
if (s.length) check('list 看到 已繳費 true 且來源＝本次字串', s.every((x) => x.已繳費 && x.來源 === SOURCE), JSON.stringify(s))
else console.log(`ℹ️ ${HID} 沒有車位編號，list 看不到，略過來源顯示檢查`)
r = await call({ op: 'pay', 戶號列表: [HID], 來源: SOURCE, 已繳費: false })
check('撤回 → 戶數 1', r.status === 200 && r.data?.戶數 === 1 && r.data?.已繳費 === false, JSON.stringify(r.data))
s = await seen()
if (s.length) check('撤回後 已繳費 false、來源清空', s.every((x) => !x.已繳費 && !x.來源), JSON.stringify(s))

console.log(fails.length ? `\n${fails.length} 項不符：${fails.join('、')}` : '\n0 項不符。接著用唯讀查詢看 audit_log 應有 2 筆 pay.batch（已繳費 true/false）。')
process.exit(fails.length ? 1 : 0)
