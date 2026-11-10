// 社區幫費用匯入檔產製 — 把配位結果的機車位年繳費，填進物業月結檔的「機車清潔費」欄。
// 規格見 docs/24-社區幫費用匯入.md。
//
// 做的事很單純：配位結果按戶號加總應繳金額 → 找到該戶在物業檔的那一列 → 填欄位 → 存回 Big5。
// 麻煩的只有「找到該戶那一列」，因為兩邊的主鍵不同：
//   社區幫 = 門牌（#房型-街號）＋樓層欄；ParkFee = 戶號（房型-樓層，建商編法）。見下方 householdIdOf()。
//
// ⚠️ 只讀不寫原檔：管理費／汽車清潔費等欄一律照抄，我們只碰「機車清潔費」。
//
// 用法：
//   兩輪分開收費（2026-11-05：抽中才繳）。第一輪 12/2 出帳、12/10 止；第二輪 12/16 出帳、12/25 止：
//   node scripts/build-shequbang-import.mjs --fee <範例檔.csv> --result <第一輪結果.csv> --round 1 --announce 2026-12-01 --due 2026-12-10 --out <輸出.csv>
//   node scripts/build-shequbang-import.mjs --fee <範例檔.csv> --result <第二輪結果.csv> --round 2 --billed <第一輪結果.csv> --announce 2026-12-15 --due 2026-12-25 --out <輸出.csv>
//   加 --dry 只驗證不寫檔
import { readFileSync, writeFileSync } from 'node:fs'
import { parseCSVObjects } from '../src/data/csv.js'
import { encodeBig5, decodeBig5 } from './lib/big5.mjs'

// ── 社區幫「新增繳費單 → 下載範例檔」欄位（2026-11-03 下載；順序即輸出順序，社區幫依欄位順序匯入）──
//   與 9/17 的物業月結檔不同：備註移到期限後、多「郵資」、汽車與機車清潔費合併成「汽/機車清潔費」。
//   獨立帳單模式照這組輸出；merge 模式仍沿用舊物業月結檔欄位（下方 FEE_COLUMNS）。
export const TEMPLATE_COLUMNS = [
  '住戶住址(門牌號)',
  '住戶住址(樓層)',
  '住戶住址(之)',
  '收費類別',
  '細項(列舉參考欄位)',
  '立帳通知日期(YYYY/MM/DD)',
  '繳費期限(YYYY/MM/DD)',
  '備註',
  '管理費',
  '郵資',
  '汽/機車清潔費',
  '附加費用',
]
export const TEMPLATE_TARGET_COL = '汽/機車清潔費'
export const TEMPLATE_ITEMS = '#管理費#郵資#汽/機車清潔費#附加費用'

// 社區幫「管理費列表 → 下載檔案」的住戶地址把門牌與樓層合併：'H3-297-6樓' → { 門牌:'#H3-297', 樓層:'6' }。
//   之後接 householdIdOf() 得戶號。對不上格式回 null（例如空白或未來改版）。
export function parseBillAddress(addr) {
  const m = String(addr ?? '')
    .trim()
    .match(/^#?([A-Z]+\d+-\d+)-(\d+)樓$/i)
  if (!m) return null
  return { 門牌: `#${m[1].toUpperCase()}`, 樓層: m[2] }
}

// 社區幫下載的 CSV 每格包成 ="值" 防 Excel 吃掉前導 0；當 --fee 門牌來源前先剝掉。
export function stripExcelWrap(text) {
  return String(text).replace(/"=""/g, '"').replace(/"""/g, '"')
}

// ── 物業月結檔欄位（merge 模式；順序即輸出順序）──
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
//   #A1-375 + 樓層 2  →  房型 A1、2 樓  →  'A1-2'
//   #H3-297 + 樓層 6  →  房型 H3、6 樓  →  'H3-6'
//   #S6-40  + 樓層 1  →  店面 S6、1 樓  →  'S6-1'
// ⚠️ 2026-11-10 前這裡回的是「棟+樓-房型編號」（A2-1），與住戶實際填的戶號相反，
//    H3 房型 6 樓的住戶（填 H3-6）會被對到 #H6 的 3 樓。當天查現況名單發現並改正，
//    使用者確認「H3 是房型、6 是樓層，建商就這樣定」。
// 1 樓在社區幫整層歸 #S1–#S15 店面門牌；eTag 名冊則寫 E2-01F 這類，兩邊編法不同。
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
  return `${m[1]}${Number(m[2])}-${樓}`
}

// 兩輪帳單用不同收費類別：回查時才分得出這筆繳的是哪一輪，同戶第一輪繳了、第二輪沒繳也不會混。
export function roundCategory(round, 民國年度 = '') {
  return `${民國年度 ? `${民國年度}年度` : ''}機車位清潔費第${round === 2 || round === '2' ? '二' : '一'}輪`
}

// 配位結果中「這輪出過帳」的車號：第二輪結果會帶著第一輪的車位，不排除就重複收費。
export function billedPlates(resultRows) {
  const plates = new Set()
  for (const r of resultRows) {
    const 狀態 = (r.狀態 || '').trim()
    if (狀態 !== '分配') continue
    const p = (r.車號 || '').trim().toUpperCase()
    if (p) plates.add(p)
  }
  return plates
}

// 配位結果 → 戶號 → 本次應繳總額。
//   只收實際配到位且還沒繳的（狀態 分配）：「未中」「待第二輪」「待安排」沒有車位不出帳，
//   「已繳」已在櫃台收過，再出帳就重複收費。opts.已出帳 傳第一輪的車號，第二輪才不會重收。
//   一戶多台逐台加總（docs/24 §2「一戶多位：逐位加總」）。
//   自行車 feeFor 為 0，加總後不影響金額，但會讓該戶進入 matched 名單——
//   這是對的：純自行車戶應出現在對帳表上並顯示 0，而非被當成「沒登記」。
export function feeByHousehold(resultRows, { 已出帳 = new Set() } = {}) {
  const acc = new Map()
  for (const r of resultRows) {
    const 狀態 = (r.狀態 || '').trim()
    if (狀態 !== '分配') continue
    if (已出帳.has((r.車號 || '').trim().toUpperCase())) continue
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

// 獨立帳單模式：只出「機車位費用」一張帳，管理費／郵資／附加費用全掛 0，金額填「汽/機車清潔費」。
//   欄位照 TEMPLATE_COLUMNS（2026-11-03 範例檔）。
//   相對於併入物業月結檔，好處是不受物業出檔時程綁住、沒有多列戶問題、帳單品名清楚。
//   **只列有金額的戶**——全 655 戶都出一列會產生 400 多張 0 元帳單。
export function buildStandaloneRows(byHousehold, addrIdx, opts = {}) {
  const {
    收費類別 = '',
    立帳通知日期 = '',
    繳費期限 = '',
    細項 = TEMPLATE_ITEMS,
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
      '細項(列舉參考欄位)': 細項,
      '立帳通知日期(YYYY/MM/DD)': 立帳通知日期,
      '繳費期限(YYYY/MM/DD)': 繳費期限,
      備註,
      管理費: '0',
      郵資: '0',
      [TEMPLATE_TARGET_COL]: String(due.金額),
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
      輸出總額: rows.reduce((s, r) => s + Number(r[TEMPLATE_TARGET_COL] || 0), 0),
      應收總額: [...byHousehold.values()].reduce((s, v) => s + v.金額, 0),
    },
  }
}

// 今天 → 'YYYY/M/D'（社區幫日期格式，不補零）。立帳通知日期預設用這個。
export function todayStr(now = new Date()) {
  return `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`
}

// 任意常見寫法 → 'YYYY/M/D'（社區幫日期格式，不補零）。接受 2026-12-31／2026/12/31／2026/1/5。
export function normalizeDate(v) {
  const p = String(v ?? '').trim().split(/[-/]/)
  if (p.length !== 3) return ''
  const [y, m, d] = p.map(Number)
  if (![y, m, d].every(Number.isInteger)) return ''
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return ''
  return `${y}/${m}/${d}`
}

// 公告日 + N 日 → 'YYYY/M/D'（社區幫日期格式，不補零）。
export function addDays(公告日, n) {
  const d = new Date(`${公告日}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

// 輸出 CSV 字串（欄位順序固定；社區幫檔無引號跳脫需求，但仍走同一套規則保險）。
function toFeeCSV(rows, columns = TEMPLATE_COLUMNS) {
  const esc = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [columns.join(',')]
  for (const r of rows) lines.push(columns.map((c) => esc(r[c])).join(','))
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
  const billedPath = arg('billed')
  const round = arg('round')
  const outPath = arg('out')
  const dry = process.argv.includes('--dry')

  if (!feePath || !resultPath) {
    console.error(`用法：
  node scripts/build-shequbang-import.mjs --fee <範例檔或物業月結檔.csv> --result <配位結果.csv> --round 1 [選項]
  node scripts/build-shequbang-import.mjs --fee <範例檔或物業月結檔.csv> --result <第二輪結果.csv> --round 2 --billed <第一輪結果.csv> [選項]

只收配到位且還沒繳的車（狀態 分配）：
  --round <1|2>            第幾輪帳單，決定收費類別（兩輪分開才回查得出繳的是哪輪）
  --billed <第一輪結果.csv> 第二輪必給：第一輪出過帳的車不再收

模式：
  --mode standalone   （預設）獨立出一張「機車位費用」帳單，其餘費用欄掛 0，只列有金額的戶
  --mode merge        併入物業月結檔的「機車清潔費」欄，其餘欄照抄、列數不變

獨立帳單選項：
  --announce <YYYY-MM-DD>  公告日（＝抽籤日隔日），據以算繳費期限
  --due <YYYY-MM-DD>       繳費期限（絕對日期，優先於 --due-days）
  --due-days <N>           繳費期限＝公告日 + N 日（預設 10，對齊辦法伍二（六）「逾 10 日視同放棄」）
  --bill-date <YYYY/M/D>   立帳通知日期（預設＝匯出當日；社區幫的立帳日是建帳那天）
  --category <字串>        收費類別（預設依 --round，例 116年度機車位清潔費第一輪）
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

  // --fee 可給物業月結檔，也可給社區幫「下載範例檔」（全戶門牌齊、每格 ="值" 包法先剝掉）。
  const feeRows = parseCSVObjects(stripExcelWrap(decodeBig5(readFileSync(feePath))))
  if (mode === 'standalone' && !arg('category') && round !== '1' && round !== '2') {
    console.error('獨立帳單要指定 --round 1 或 2（決定收費類別），或用 --category 自訂')
    process.exit(1)
  }
  if (round === '2' && !billedPath) {
    console.error('第二輪要給 --billed <第一輪結果.csv>，否則第一輪的車會重複收費')
    process.exit(1)
  }
  const 已出帳 = billedPath ? billedPlates(parseCSVObjects(readFileSync(billedPath, 'utf8'))) : new Set()
  const byHousehold = feeByHousehold(parseCSVObjects(readFileSync(resultPath, 'utf8')), { 已出帳 })

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
    // 繳費期限：--due 給絕對日期優先，否則公告日 + --due-days。
    // 放棄線（辦法伍二（六）逾公告後 10 日）固定算出來，供對照——帳單期限可較寬，
    // 但那代表「資格已失效、帳單仍未到期」，屬管委會決定的作業取捨，故只提示不阻擋。
    const dueAbs = arg('due') ? normalizeDate(arg('due')) : ''
    if (arg('due') && !dueAbs) problems.push(`--due 日期格式看不懂：${arg('due')}（要 2026-12-31 或 2026/12/31）`)
    const 放棄線 = announce ? addDays(announce, 10) : ''
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
      收費類別: arg('category', roundCategory(round, 民國年度)),
      立帳通知日期: 立帳日,
      繳費期限: dueAbs || (announce ? addDays(announce, dueDays) : ''),
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
    console.log(`繳費期限          ${opts.繳費期限}${dueAbs ? '（--due 指定）' : `（公告日 +${dueDays} 日）`}`)
    if (放棄線 && opts.繳費期限 !== 放棄線)
      console.log(`                  ⚠ 辦法放棄線為 ${放棄線}（公告 + 10 日，伍二（六））——帳單期限與之不同`)
    console.log(`出帳戶數          ${pad(report.出帳戶數)}`)
  }

  const 台數 = [...byHousehold.values()].reduce((s, v) => s + v.台數, 0)
  console.log(`計費依據          配位結果（只收狀態 分配）：${台數} 台／${byHousehold.size} 戶${billedPath ? `；排除第一輪已出帳 ${已出帳.size} 台` : ''}`)
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
    const buf = encodeBig5(toFeeCSV(rows, mode === 'merge' ? FEE_COLUMNS : TEMPLATE_COLUMNS), { onUnmappable: (c) => bad.add(c) })
    if (bad.size) console.log(`\n⚠ 有 ${bad.size} 個字元無法以 Big5 編碼，已代換為 '?'：${[...bad].join('')}`)
    writeFileSync(outPath, buf)
    console.log(`\n已寫出 ${outPath}（Big5、無 BOM、${rows.length} 列）`)
  } else {
    console.log('\n未指定 --out，未寫檔。')
  }

  if (problems.length) process.exit(1)
}
