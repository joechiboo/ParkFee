// 社區幫費用匯入檔產製 — 把配位結果的機車位年繳費，填進物業月結檔的「機車清潔費」欄。
// 規格見 docs/24-社區幫費用匯入.md。
//
// 做的事很單純：配位結果按戶號加總應繳金額 → 找到該戶在物業檔的那一列 → 填欄位 → 存回 Big5。
// 麻煩的只有「找到該戶那一列」，因為兩邊的主鍵不同：
//   社區幫 = 門牌（#棟單元-街號）＋樓層欄；ParkFee = 戶號（棟樓-戶）。
// 中間那個數字意義相反——社區幫的是「單元」，戶號的是「樓層」。見下方 householdIdOf()。
//
// ⚠️ 只讀不寫原檔：管理費／汽車清潔費等欄一律照抄，我們只碰「機車清潔費」。
//
// 用法：
//   node scripts/build-shequbang-import.mjs --fee <物業月結檔.csv> --result <配位結果.csv> [--out <輸出.csv>]
//   node scripts/build-shequbang-import.mjs --fee ... --result ... --dry   # 只驗證不寫檔
import { readFileSync, writeFileSync } from 'node:fs'
import { parseCSVObjects } from '../src/data/csv.js'
import { encodeBig5, decodeBig5 } from './lib/big5.mjs'

// ── 物業月結檔欄位（順序即輸出順序，不可更動：社區幫依欄位順序匯入）──
const FEE_COLUMNS = [
  '住戶住址(門牌號)',
  '住戶住址(樓層)',
  '住戶住址(之)',
  '收費類別',
  '備註',
  '細項(列舉參考欄位)',
  '立帳通知日期(YYYY/MM/DD)',
  '繳費期限(YYYY/MM/DD)',
  '管理費',
  '汽車清潔費',
  '機車清潔費',
  '附加費用',
]
const TARGET_COL = '機車清潔費'
const 門牌欄 = FEE_COLUMNS[0]
const 樓層欄 = FEE_COLUMNS[1]
const 之欄 = FEE_COLUMNS[2]
const 管理費欄 = FEE_COLUMNS[8]

// 門牌＋樓層 → ParkFee 戶號。
//   #A1-375 + 樓層 2  →  棟 A、單元 1、樓 2  →  'A2-1'
//   #S6-40  + 樓層 1  →  棟 S、單元 6、樓 1  →  'S1-6'（店面同規則，household.js 允許 S1-6）
// 已用 eTag 名冊 624 筆實際戶別交叉驗證，吻合 98.7%；對不上的 8 筆全在 1 樓，
// 因社區幫把 1 樓整層歸進 #S1–#S15 店面門牌、與住宅棟別分開編，屬兩系統的編碼差異而非規則錯誤。
export function householdIdOf(門牌, 樓層) {
  const m = String(門牌 || '')
    .replace(/^#/, '')
    .match(/^([A-Z]+)(\d+)-(\d+)$/)
  if (!m) return null
  // ⚠️ 不能只用 Number.isFinite 擋：Number('') === 0 且為有限值，空白樓層會靜默變成「0 樓」，
  //    產出 A0-1 這種對不到任何戶的假戶號。樓層必須是 ≥ 1 的整數。
  const raw = String(樓層 ?? '').trim()
  if (!/^\d+$/.test(raw)) return null
  const 樓 = Number(raw)
  if (樓 < 1) return null
  return `${m[1]}${樓}-${Number(m[2])}`
}

// 配位結果 → 戶號 → 應繳總額。
//   只計入實際配到位的（狀態 分配／已繳）；「未中」沒有車位、不出帳。
//   一戶多台逐台加總（docs/24 §2「一戶多位：逐位加總」）。
//   自行車 feeFor 為 0，加總後不影響金額，但會讓該戶進入 matched 名單——
//   這是對的：純自行車戶應出現在對帳表上並顯示 0，而非被當成「沒登記」。
export function feeByHousehold(resultRows) {
  const acc = new Map()
  for (const r of resultRows) {
    const 狀態 = (r.狀態 || '').trim()
    if (狀態 !== '分配' && 狀態 !== '已繳') continue
    const id = (r.戶號 || '').trim()
    if (!id) continue
    const amt = Number(r.應繳金額)
    if (!Number.isFinite(amt)) continue
    const cur = acc.get(id) || { 金額: 0, 台數: 0 }
    cur.金額 += amt
    cur.台數 += 1
    acc.set(id, cur)
  }
  return acc
}

// 把金額填進物業檔列。回傳 { rows, report }，不改動輸入。
export function fillMotorFee(feeRows, byHousehold) {
  // 同一戶可能被拆成多列（物業把管理費與汽車清潔費分開立帳，範本檔的 #F1-321 2樓即是）。
  // 填錯列會讓帳單顯示異常，兩列都填則重複收費 → 只填「管理費 > 0」的主帳列。
  const rowsOfHousehold = new Map()
  feeRows.forEach((r, i) => {
    const id = householdIdOf(r[門牌欄], r[樓層欄])
    if (!id) return
    if (!rowsOfHousehold.has(id)) rowsOfHousehold.set(id, [])
    rowsOfHousehold.get(id).push(i)
  })

  const out = feeRows.map((r) => ({ ...r, [TARGET_COL]: '0' }))
  const 多列戶 = []
  const 已填 = new Set()

  for (const [id, idxs] of rowsOfHousehold) {
    const due = byHousehold.get(id)
    if (idxs.length > 1) 多列戶.push({ 戶號: id, 列數: idxs.length, 金額: due?.金額 ?? 0 })
    if (!due || due.金額 <= 0) continue
    // 主帳列＝管理費 > 0 者；若全為 0（理論上不會）則退回第一列，並在報告標記。
    const 主列 = idxs.find((i) => Number(feeRows[i][管理費欄]) > 0) ?? idxs[0]
    out[主列][TARGET_COL] = String(due.金額)
    已填.add(id)
  }

  const 查無門牌 = [...byHousehold.keys()].filter((id) => !rowsOfHousehold.has(id))
  return {
    rows: out,
    report: {
      物業列數: feeRows.length,
      不重複戶數: rowsOfHousehold.size,
      多列戶,
      應出帳戶數: [...byHousehold.values()].filter((v) => v.金額 > 0).length,
      已填戶數: 已填.size,
      查無門牌,
      輸出總額: out.reduce((s, r) => s + Number(r[TARGET_COL] || 0), 0),
      應收總額: [...byHousehold.values()].reduce((s, v) => s + v.金額, 0),
    },
  }
}

// 物業檔 → 戶號對應的門牌欄位（獨立帳單模式要用）。
//   街號無法從戶號反推——同一單元不同樓層可能掛不同街號（A5 單元 3 樓是 -369、其他樓層 -367），
//   所以門牌必須從物業檔查。但門牌不隨月份變動，用哪個月的檔都行。
export function addressIndex(feeRows) {
  const idx = new Map()
  for (const r of feeRows) {
    const id = householdIdOf(r[門牌欄], r[樓層欄])
    if (!id || idx.has(id)) continue // 多列戶取第一列即可，門牌三欄都相同
    idx.set(id, { [門牌欄]: r[門牌欄], [樓層欄]: r[樓層欄], [之欄]: r[之欄] })
  }
  return idx
}

// 獨立帳單模式：只出「機車位費用」一張帳，管理費／汽車清潔費／附加費用全掛 0。
//   相對於併入物業月結檔，好處是不受物業出檔時程綁住、沒有多列戶問題、帳單品名清楚。
//   **只列有金額的戶**——全 655 戶都出一列會產生 400 多張 0 元帳單。
export function buildStandaloneRows(byHousehold, addrIdx, opts = {}) {
  const {
    收費類別 = '',
    立帳通知日期 = '',
    繳費期限 = '',
    細項 = '#管理費#汽車清潔費#機車清潔費#附加費用',
    備註 = '',
  } = opts
  const rows = []
  const 查無門牌 = []
  for (const [id, due] of byHousehold) {
    if (!due || due.金額 <= 0) continue // 純自行車戶（0 元）不出帳
    const addr = addrIdx.get(id)
    if (!addr) {
      查無門牌.push(id)
      continue
    }
    rows.push({
      ...addr,
      收費類別,
      備註,
      '細項(列舉參考欄位)': 細項,
      '立帳通知日期(YYYY/MM/DD)': 立帳通知日期,
      '繳費期限(YYYY/MM/DD)': 繳費期限,
      管理費: '0',
      汽車清潔費: '0',
      [TARGET_COL]: String(due.金額),
      附加費用: '0',
    })
  }
  // 依門牌、樓層排序，方便物業肉眼核對。
  rows.sort(
    (a, b) => a[門牌欄].localeCompare(b[門牌欄]) || Number(a[樓層欄]) - Number(b[樓層欄])
  )
  return {
    rows,
    report: {
      出帳戶數: rows.length,
      查無門牌,
      輸出總額: rows.reduce((s, r) => s + Number(r[TARGET_COL] || 0), 0),
      應收總額: [...byHousehold.values()].reduce((s, v) => s + v.金額, 0),
    },
  }
}

// 今天 → 'YYYY/M/D'（社區幫日期格式，不補零）。立帳通知日期預設用這個。
export function todayStr(now = new Date()) {
  return `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`
}

// 公告日 + N 日 → 'YYYY/M/D'（社區幫日期格式，不補零）。
export function addDays(公告日, n) {
  const d = new Date(`${公告日}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

// 輸出 CSV 字串（欄位順序固定；社區幫檔無引號跳脫需求，但仍走同一套規則保險）。
function toFeeCSV(rows) {
  const esc = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [FEE_COLUMNS.join(',')]
  for (const r of rows) lines.push(FEE_COLUMNS.map((c) => esc(r[c])).join(','))
  return lines.join('\r\n') + '\r\n'
}

// ── CLI ──
function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())
if (isMain) {
  const feePath = arg('fee')
  const resultPath = arg('result')
  const outPath = arg('out')
  const dry = process.argv.includes('--dry')

  if (!feePath || !resultPath) {
    console.error(`用法：
  node scripts/build-shequbang-import.mjs --fee <物業月結檔.csv> --result <配位結果.csv> [選項]

模式：
  --mode standalone   （預設）獨立出一張「機車位費用」帳單，其餘費用欄掛 0，只列有金額的戶
  --mode merge        併入物業月結檔的「機車清潔費」欄，其餘欄照抄、列數不變

獨立帳單選項：
  --announce <YYYY-MM-DD>  公告日（＝抽籤日隔日），據以算繳費期限
  --due-days <N>           繳費期限＝公告日 + N 日（預設 10，對齊辦法伍二（六）「逾 10 日視同放棄」）
  --bill-date <YYYY/M/D>   立帳通知日期（預設＝匯出當日；社區幫的立帳日是建帳那天）
  --category <字串>        收費類別（預設「<民國年>年度機車位清潔費」，例 116年度機車位清潔費）
  --items <字串>           細項(列舉參考欄位)，預設沿用物業檔的固定字串

共用：
  --out <輸出.csv>         寫出（Big5 無 BOM）；不給則只驗證
  --dry                    只驗證不寫檔`)
    process.exit(1)
  }

  const mode = arg('mode', 'standalone')
  if (mode !== 'standalone' && mode !== 'merge') {
    console.error(`--mode 只能是 standalone 或 merge（收到 "${mode}"）`)
    process.exit(1)
  }

  const feeRows = parseCSVObjects(decodeBig5(readFileSync(feePath)))
  const resultRows = parseCSVObjects(readFileSync(resultPath, 'utf8'))
  const byHousehold = feeByHousehold(resultRows)

  const pad = (n) => String(n).padStart(6)
  let rows, report
  const problems = []

  if (mode === 'merge') {
    ;({ rows, report } = fillMotorFee(feeRows, byHousehold))
    console.log('=== 社區幫匯入檔產製（merge：併入物業月結檔）===')
    console.log(`物業檔列數        ${pad(report.物業列數)}`)
    console.log(`不重複戶數        ${pad(report.不重複戶數)}`)
    console.log(`配位應出帳戶數    ${pad(report.應出帳戶數)}`)
    console.log(`實際填入戶數      ${pad(report.已填戶數)}`)
    if (report.多列戶.length) {
      console.log(`\n⚠ 多列戶（同址拆多列，已只填管理費>0 的主帳列，請物業核對）：`)
      for (const m of report.多列戶) console.log(`   ${m.戶號}  ${m.列數} 列  金額 ${m.金額}`)
    }
  } else {
    const announce = arg('announce', '')
    const dueDays = Number(arg('due-days', '10'))
    if (!announce) problems.push('獨立帳單模式需要 --announce <公告日 YYYY-MM-DD> 才能算繳費期限')
    // 使用期間為公告次年的曆年（12/1 抽的是次年車位）→ 年度＝公告年 + 1。
    // 收費類別預設用**民國年**：與登記表「116 年度」、物業檔名「…115年05月管理費」一致，住戶對得起來。
    // ⚠️ 社區幫「收費類別」欄現有值是西元（「2026年05月管理費」），若其匯入驗證卡格式，
    //    改用 --category "2027年度機車位清潔費" 即可，見 §4 待確認。
    const 西元年度 = announce ? new Date(`${announce}T00:00:00`).getFullYear() + 1 : ''
    const 民國年度 = 西元年度 ? 西元年度 - 1911 : ''
    // 立帳通知日期＝**匯出當日**（2026-09-17 實測修正）。社區幫的「立帳」是帳單建立那天，
    // 與抽籤公告日無關——公告後可能隔幾天才產檔上傳，用公告日會讓帳單顯示的立帳日早於實際建帳日。
    const 立帳日 = arg('bill-date') || todayStr()
    const opts = {
      收費類別: arg('category', 民國年度 ? `${民國年度}年度機車位清潔費` : ''),
      立帳通知日期: 立帳日,
      繳費期限: announce ? addDays(announce, dueDays) : '',
      備註: '',
    }
    const items = arg('items')
    if (items) opts.細項 = items
    // 立帳日晚於繳費期限＝帳單一建立就已逾期，必定是參數給錯。
    const d = (v) => new Date(String(v).split('/').join('-') + 'T00:00:00')
    if (opts.繳費期限 && d(opts.立帳通知日期) > d(opts.繳費期限))
      problems.push(`立帳日 ${opts.立帳通知日期} 晚於繳費期限 ${opts.繳費期限} —— 帳單一建立就逾期，請確認 --announce／--bill-date`)
    ;({ rows, report } = buildStandaloneRows(byHousehold, addressIndex(feeRows), opts))
    console.log('=== 社區幫匯入檔產製（standalone：獨立機車位帳單）===')
    console.log(`收費類別          ${opts.收費類別}`)
    console.log(`立帳通知日期      ${opts.立帳通知日期}（${arg('bill-date') ? '--bill-date 指定' : '匯出當日'}）`)
    console.log(`繳費期限          ${opts.繳費期限}（公告日 +${dueDays} 日）`)
    console.log(`出帳戶數          ${pad(report.出帳戶數)}`)
  }

  console.log(`應收總額          ${pad(report.應收總額)}`)
  console.log(`輸出總額          ${pad(report.輸出總額)}`)

  if (report.輸出總額 !== report.應收總額) problems.push(`總額不符：輸出 ${report.輸出總額} ≠ 應收 ${report.應收總額}`)
  if (report.查無門牌.length) problems.push(`有 ${report.查無門牌.length} 戶在物業檔查無門牌：${report.查無門牌.join(', ')}`)

  if (problems.length) {
    console.log('\n❌ 驗證未通過：')
    for (const p of problems) console.log(`   - ${p}`)
  } else {
    console.log('\n✅ 驗證通過（總額相符、所有配位戶皆對應到門牌）')
  }

  if (dry) {
    console.log('\n--dry：不寫檔。')
  } else if (outPath) {
    const bad = new Set()
    const buf = encodeBig5(toFeeCSV(rows), { onUnmappable: (c) => bad.add(c) })
    if (bad.size) console.log(`\n⚠ 有 ${bad.size} 個字元無法以 Big5 編碼，已代換為 '?'：${[...bad].join('')}`)
    writeFileSync(outPath, buf)
    console.log(`\n已寫出 ${outPath}（Big5、無 BOM、${rows.length} 列）`)
  } else {
    console.log('\n未指定 --out，未寫檔。')
  }

  if (problems.length) process.exit(1)
}
