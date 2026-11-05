// 真 API 驗 assign-seat 的兩輪收費行為：標繳費只標已配位的車、已繳者不被蓋掉來源、撤回只撤同來源、解除可留「視同放棄」。
// 用測試戶 Z99 臨時佔一格大位（預設 247），結束時解除並清空狀態，不留髒資料。測試戶 11/10 清掉後這支就不能跑了。
//
// 用法：$env:ADMIN_PASSWORD='…'; node scripts/verify-pay.mjs
//   選項：--household Z99 --plate DEMO-099 --seat 247
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
const opt = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const HID = opt('household', 'Z99')
const PLATE = opt('plate', 'DEMO-099')
const SEAT = opt('seat', '247')
const day = new Date().toISOString().slice(0, 10)
const SOURCE = `驗證 ${day}`
const SOURCE2 = `驗證第二次 ${day}`

async function post(name, body) {
  const res = await fetch(`${URL_}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: await res.json().catch(() => null) }
}
const call = (body) => post('assign-seat', { password: PASSWORD, ...body })
const assign = () => call({ op: 'assign', 車位編號: SEAT, 車號: PLATE, 車位類型: '大', 配位狀態: '分配', 已繳費: false, 強制: true })
const release = (extra = {}) => call({ op: 'unlock', 車位編號: SEAT, 車號: PLATE, ...extra })
async function seat() {
  const { data } = await call({ op: 'list' })
  return (data?.assignments || []).find((a) => a.車號 === PLATE) || null
}
async function vehicle() {
  const { data } = await post('login', { 戶號: HID, 車號: PLATE })
  return data?.household?.vehicles?.find((v) => v.車號 === PLATE) || null
}

const fails = []
const check = (name, ok, info = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${info ? `  ${info}` : ''}`)
  if (!ok) fails.push(name)
}

console.log(`=== verify-pay：${HID}／${PLATE}，臨時佔車位 ${SEAT} ===`)
let r = await call({ op: 'pay', 戶號列表: [HID], 來源: '' })
check('缺來源 → 400', r.status === 400, r.data?.error)

r = await call({ op: 'pay', 戶號列表: [HID], 來源: SOURCE })
check('沒配位的車不標（第二台不會被第一輪帳單連帶標已繳）', r.status === 200 && r.data?.戶數 === 0 && r.data?.台數 === 0, JSON.stringify(r.data))

r = await assign()
check('臨時指派成功', r.status === 200 && r.data?.ok, JSON.stringify(r.data))
if (r.status !== 200) {
  console.log('\n指派失敗，後面無法驗（車位可能被占用，改用 --seat 換一格大位）。')
  process.exit(1)
}
try {
  r = await call({ op: 'pay', 戶號列表: [HID], 來源: SOURCE })
  check('已配位 → 標已繳 1 台', r.status === 200 && r.data?.台數 === 1, JSON.stringify(r.data))
  let s = await seat()
  check('list 顯示已繳與來源', s?.已繳費 === true && s?.繳費來源 === SOURCE, JSON.stringify(s))

  r = await call({ op: 'pay', 戶號列表: [HID], 來源: SOURCE2 })
  s = await seat()
  check('重跑不蓋掉原本的來源', r.data?.台數 === 0 && s?.繳費來源 === SOURCE, JSON.stringify(s))

  r = await call({ op: 'pay', 戶號列表: [HID], 來源: SOURCE2, 已繳費: false })
  s = await seat()
  check('撤回別的來源不影響這筆', r.data?.台數 === 0 && s?.已繳費 === true, JSON.stringify(s))

  r = await call({ op: 'pay', 戶號列表: [HID], 來源: SOURCE, 已繳費: false })
  s = await seat()
  check('撤回同來源 → 回到未繳', r.data?.台數 === 1 && s?.已繳費 === false && !s?.繳費來源, JSON.stringify(s))

  r = await release({ 放棄: true })
  const v = await vehicle()
  check('解除帶放棄 → 車位清空、狀態視同放棄', r.status === 200 && !v?.車位編號 && v?.配位狀態 === '視同放棄', JSON.stringify(v))
} finally {
  // 不論前面成敗都還原：再指派一次後用一般解除，車位、鎖、狀態全清。
  await assign()
  r = await release()
  const v = await vehicle()
  check('還原：車位與狀態都清空', r.status === 200 && !v?.車位編號 && !v?.配位狀態 && !v?.已繳費, JSON.stringify(v))
}

console.log(fails.length ? `\n${fails.length} 項不符：${fails.join('、')}` : '\n0 項不符。')
process.exit(fails.length ? 1 : 0)
