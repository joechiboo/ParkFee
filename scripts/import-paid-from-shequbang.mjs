// 繳費回查（第一輪 12/11、第二輪 12/26）：讀社區幫「管理費列表 → 下載檔案」匯出檔，把已繳的戶批次標進系統（vehicle.已繳費）。
// 作業流程見 docs/37 §2；資料格式見 docs/24 §5。
//
// 判斷規則：
//   - 只看收費類別**包含**該輪類別（--round 1＝機車位清潔費第一輪）的帳單：一戶跨月合繳時社區幫會把多個類別用逗號串在同一列。
//   - 繳費狀態 ≠「未繳費」且非空 ＝ 已繳（已繳者該欄顯示繳費方式：虛擬帳號／信用卡／超商繳款…，2026-11-03 實測）。
//   - 住戶地址 'H3-297-6樓' → parseBillAddress → householdIdOf → 戶號 'H6-3'。
//
// 預設只印不寫（乾跑）；加 --apply 才打後端 assign-seat op=pay，後端把該戶已配到位、還沒繳的機車標已繳、
// 記 繳費來源＝「社區幫第一輪 <日期>」與 繳費時間，稽核 pay.batch 只記筆數。撤回：--apply --undo --source 當時的來源字串。
//
// 用法：
//   node scripts/import-paid-from-shequbang.mjs --round 1 --file private/shequbang/payment-20261211-big5.csv
//   $env:ADMIN_PASSWORD='…'; node scripts/import-paid-from-shequbang.mjs --round 1 --file <匯出.csv> --apply
//   選項：--category <字串>（蓋過 --round）  --source "社區幫第一輪 2026-12-11"（預設帶今天）  --undo（與 --apply 併用，只撤回這個來源標的）
import { readFileSync } from 'node:fs'
import { parseCSVObjects } from '../src/data/csv.js'
import { decodeBig5 } from './lib/big5.mjs'
import { householdIdOf, parseBillAddress, roundCategory, stripExcelWrap } from './build-shequbang-import.mjs'

export const UNPAID = '未繳費'

// 匯出列 → { 已繳戶號:[], 未繳戶號:[], 略過:[{列, 原因}] }。純函式，測試用。
export function paidHouseholdsFrom(rows, { category = roundCategory(1) } = {}) {
  const paid = new Set()
  const unpaid = new Set()
  const skipped = []
  rows.forEach((r, i) => {
    const 類別 = String(r.收費類別 ?? '')
    if (!類別.includes(category)) return // 其他帳單（管理費、汽車清潔費）不看，也不算略過
    const addr = parseBillAddress(r.住戶地址)
    const id = addr ? householdIdOf(addr.門牌, addr.樓層) : null
    if (!id) {
      skipped.push({ 列: i + 2, 原因: `住戶地址對不到戶號：${r.住戶地址 ?? ''}`, 帳單編號: r.帳單編號 ?? '' })
      return
    }
    const 狀態 = String(r.繳費狀態 ?? '').trim()
    if (狀態 && 狀態 !== UNPAID) paid.add(id)
    else unpaid.add(id)
  })
  // 同戶多張（多登記一台後補開）只要有一張未繳就不算繳清 → 從已繳移除，留給人判斷。
  const partial = [...paid].filter((id) => unpaid.has(id))
  for (const id of partial) paid.delete(id)
  return { 已繳戶號: [...paid].sort(), 未繳戶號: [...unpaid].sort(), 部分繳: partial.sort(), 略過: skipped }
}

export function readExport(path) {
  const text = stripExcelWrap(decodeBig5(readFileSync(path)))
  return parseCSVObjects(text)
}

// ── CLI ──
function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())
if (isMain) {
  const file = arg('file')
  if (!file) {
    console.error('用法：node scripts/import-paid-from-shequbang.mjs --round <1|2> --file <社區幫匯出.csv> [--category 字串] [--source "社區幫第一輪 2026-12-11"] [--apply] [--undo]')
    process.exit(2)
  }
  const round = arg('round')
  if (!arg('category') && round !== '1' && round !== '2') {
    console.error('要指定 --round 1 或 2：兩輪帳單分開，混在一起會把只繳第一輪的戶判成部分繳')
    process.exit(2)
  }
  const category = arg('category', roundCategory(round))
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  const source = arg('source', `社區幫第${round === '2' ? '二' : '一'}輪 ${today}`)
  const apply = process.argv.includes('--apply')
  const undo = process.argv.includes('--undo')

  const rows = readExport(file)
  const r = paidHouseholdsFrom(rows, { category })
  const targets = r.已繳戶號

  console.log(`=== 社區幫繳費回查（${apply ? (undo ? '套用：整批改回未繳' : '套用') : '乾跑，不寫'}）===`)
  console.log(`匯出檔          ${file}（${rows.length} 列）`)
  console.log(`收費類別含      「${category}」`)
  console.log(`已繳戶          ${r.已繳戶號.length}`)
  console.log(`未繳戶          ${r.未繳戶號.length}`)
  if (r.部分繳.length) console.log(`⚠ 同戶多張部分未繳（不標已繳，請人工判斷）：${r.部分繳.join('、')}`)
  if (r.略過.length) {
    console.log(`⚠ 對不到戶號 ${r.略過.length} 列：`)
    for (const s of r.略過) console.log(`   第 ${s.列} 列 ${s.帳單編號} ${s.原因}`)
  }
  if (!apply) {
    console.log(`\n乾跑完畢。確認無誤後加 --apply 寫入（來源字串「${source}」會記到每台車）。`)
    process.exit(0)
  }
  if (!targets.length) {
    console.log('\n沒有要標的戶，結束。')
    process.exit(0)
  }

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
  const res = await fetch(`${URL_}/functions/v1/assign-seat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ op: 'pay', password: PASSWORD, 戶號列表: targets, 來源: source, 已繳費: !undo }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok) {
    console.error(`❌ 後端回 ${res.status}：${data?.error || '未知錯誤'}`)
    process.exit(1)
  }
  console.log(`\n✅ 已${undo ? '撤回' : '標記'} ${data.戶數} 戶／${data.台數} 台（來源「${source}」）`)
  if (data.查無戶號?.length) console.log(`⚠ 這些戶系統裡沒有已配位的機車（社區幫有帳，但車位已解除或沒登記？）：${data.查無戶號.join('、')}`)
}
