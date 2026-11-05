// 核對正式庫的鎖定車位（locked_seat）是否等於預期清單。11/14 整理完鎖定格跑一次；之後健檢想順手看也可以。
//
// 預期清單（docs/01「不進配位的車位」＋ 2026-10-29／11/02 決議）：
//   動線／轉角 28 格、維修 498、自行車旁一排 641–655（暫鎖不配位）、無障礙 108、194（2026-11-05 定暫時維持鎖定）
//   --phase before（11/14 以前）：機車 46 格
//   --phase after （11/14 以後）：加社宅公益位 1–7、92–104（機車 20 格）→ 機車 66 格；
//                                 自行車公益位 B114–B118（自行車車位編號帶 B 前綴）5 格
// 住戶線上選定的志願小位、櫃台指派的格子也會進 locked_seat，所以 11/15 開放登記後一定會多出來；
// 腳本把「多出來」的另外列，請用維護頁對照是不是有人掛車，不是當錯誤。
//
// 用法：node scripts/verify-locks.mjs --phase before|after
// 只讀 locked_seat（anon 可讀），不需要管理密碼、不寫任何東西。
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
const PHASE = argv.includes('--phase') ? argv[argv.indexOf('--phase') + 1] : null
if (!['before', 'after'].includes(PHASE)) {
  console.error('請指定 --phase before（11/14 前）或 --phase after（11/14 整理後）')
  process.exit(2)
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i))
const BASE = [
  '153', '154', '198', '199', '277', '299', ...range(302, 305), '319', '320', '408', ...range(430, 432),
  ...range(482, 487), ...range(594, 597), '628', '629', // 動線／轉角 28 格
  '498', // 維修（漏水）
  ...range(641, 655), // 自行車旁一排，暫鎖不配位（2026-11-02 經理版：維持鎖定）
  '108', '194', // 無障礙，2026-11-05 定暫時維持鎖定（櫃台仍可指派）
]
const EXPECTED =
  PHASE === 'before'
    ? BASE
    : [...BASE, ...range(1, 7), ...range(92, 104), ...range(114, 118).map((n) => `B${n}`)]

const res = await fetch(`${URL_}/rest/v1/locked_seat?select=%E8%BB%8A%E4%BD%8D%E7%B7%A8%E8%99%9F`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
})
if (!res.ok) {
  console.error(`讀 locked_seat 失敗：${res.status} ${await res.text()}`)
  process.exit(2)
}
const actual = (await res.json()).map((r) => String(r.車位編號))
const act = new Set(actual)
const exp = new Set(EXPECTED)
const numeric = (x, y) => Number(x.replace(/\D/g, '')) - Number(y.replace(/\D/g, '')) || x.localeCompare(y)
const missing = EXPECTED.filter((id) => !act.has(id)).sort(numeric)
const extra = actual.filter((id) => !exp.has(id)).sort(numeric)
const motor = actual.filter((id) => !id.startsWith('B')).length
const bike = actual.length - motor

console.log(`階段：${PHASE === 'before' ? '11/14 前' : '11/14 整理後'}；預期 ${EXPECTED.length} 格，實際 ${actual.length} 格（機車 ${motor}、自行車 ${bike}）`)
if (!missing.length && !extra.length) {
  console.log('✅ 鎖定清單與預期完全一致')
  process.exit(0)
}
if (missing.length) console.log(`❌ 應鎖未鎖 ${missing.length} 格：${missing.join(', ')}`)
if (extra.length) console.log(`ℹ️ 多出 ${extra.length} 格（住戶志願小位／櫃台指派會在這裡，請到維護頁核對是否有掛車）：${extra.join(', ')}`)
process.exit(missing.length ? 1 : 0)
