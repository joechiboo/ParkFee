// 抽籤結果公告（A4 張貼版）— 把抽籤頁下載的配位結果 CSV 排成可列印張貼的 PDF。
//
// 輸入：抽籤頁「公告版 CSV」（欄位：戶號?,車號,車位編號,車位類型,應繳金額,簽約期限,狀態,備註）。
//       有戶號欄就印戶號並依戶號排序；沒有就只印車號、依車號排序。
// 輸出：同名 .html 與 .pdf（本機 Edge 無頭模式列印）。
//
// 用法：
//   node scripts/build-result-notice.mjs --csv private/配位結果-公告版.csv --round 1 --announce 2026-12-01 --out private/抽籤結果公告.pdf
//   加 --sample 會在每頁印「樣張」浮水印（示範資料用）。
//   --round 1｜2 決定標題與說明文字；--deadline 省略時取 CSV 內的簽約期限。
//
// 版面：每頁兩欄、每欄固定列數，自己分頁（不靠瀏覽器斷表格，表頭每欄都重印）。
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseCSVObjects } from '../src/data/csv.js'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const arg = (name, fallback = '') => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const csvPath = arg('csv')
if (!csvPath) {
  console.error('用法：node scripts/build-result-notice.mjs --csv <配位結果.csv> [--round 1|2] [--announce YYYY-MM-DD] [--deadline YYYY-MM-DD] [--out <檔.pdf>] [--sample]')
  process.exit(1)
}
const round = arg('round', '1')
const announce = arg('announce')
const sample = process.argv.includes('--sample')
const outPdf = resolve(arg('out', csvPath.replace(/\.csv$/i, '') + '-公告.pdf'))
const outHtml = outPdf.replace(/\.pdf$/i, '.html')

const rows = parseCSVObjects(readFileSync(csvPath, 'utf8').replace(/^\ufeff/, ''))
const hasHid = rows.some((r) => r.戶號)
const deadline = arg('deadline') || rows.find((r) => r.簽約期限)?.簽約期限 || ''

// 戶號自然排序：棟別字母 → 房型編號 → 樓層；工作人員等非標準戶號排最後。
const hidKey = (h) => {
  const m = String(h || '').match(/^([A-Z])(\d+)-(\d+)$/)
  return m ? [0, m[1], +m[2], +m[3]] : [1, String(h || ''), 0, 0]
}
const cmp = (a, b) => {
  if (hasHid) {
    const x = hidKey(a.戶號)
    const y = hidKey(b.戶號)
    for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  }
  return String(a.車號).localeCompare(String(b.車號))
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const roc = (d) => {
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${+m[1] - 1911} 年 ${+m[2]} 月 ${+m[3]} 日` : d
}
// 自行車車號是系統合成鍵（自行車-戶號-序），公告上顯示成「自行車 第 N 輛」。
const plate = (v) => {
  const m = String(v || '').match(/^自行車-.+-(\d+)$/)
  return m ? `自行車 第 ${m[1]} 輛` : v
}

// 機車與自行車分開列（經理 2026-11-10）：先機車、後自行車，各自依戶號排序。
const isBike = (r) => r.車位類型 === '自行車' || /^自行車-/.test(String(r.車號 || ''))
const motor = rows.filter((r) => !isBike(r))
const bikes = rows.filter(isBike)
const assigned = motor.filter((r) => r.車位編號).sort(cmp)
const missed = motor.filter((r) => !r.車位編號 && r.狀態 === '未中').sort(cmp)
const waiting = motor.filter((r) => !r.車位編號 && r.狀態 !== '未中').sort(cmp)
const bikeAssigned = bikes.filter((r) => r.車位編號).sort(cmp)
const bikeMissed = bikes.filter((r) => !r.車位編號).sort(cmp)

// 配位方式的公告用字：志願小位是登記時依先後順序選定的，標明出來（經理 2026-11-10）。
const viaLabel = (v) => (v === '志願小位' ? '志願小位（依登記順序）' : v)

// ── 分頁：每頁兩欄，每欄 PER 列；第一頁因為有抬頭與說明，列數較少 ──
const PER = 44
const PER_FIRST = 34
const hidTh = hasHid ? '<th>戶號</th>' : ''
const hidTd = (r) => (hasHid ? `<td>${esc(r.戶號)}</td>` : '')
const table = (heads, cells) => (list) =>
  list.length
    ? `<table><thead><tr>${hidTh}${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${list
        .map((r) => `<tr>${hidTd(r)}${cells(r)}</tr>`)
        .join('')}</tbody></table>`
    : ''
const fee = (r) => (r.狀態 === '已繳' ? '已繳' : Number(r.應繳金額) ? Number(r.應繳金額).toLocaleString() : '')
const tAssigned = table(
  ['車號', '車位', '類型', '應繳', '配位方式'],
  (r) =>
    `<td>${esc(r.車號)}</td><td class="seat">${esc(r.車位編號)}</td><td>${esc(r.車位類型)}</td><td class="num">${fee(r)}</td><td class="via">${esc(viaLabel(r.備註))}</td>`,
)
const tOther = table(['車號', '狀態', '說明'], (r) => `<td>${esc(r.車號)}</td><td>${esc(r.狀態)}</td><td>${esc(r.備註)}</td>`)
const tBike = table(['車輛', '車位', '配位方式'], (r) => `<td>${esc(plate(r.車號))}</td><td class="seat">${esc(r.車位編號)}</td><td>${esc(r.備註)}</td>`)
const tBikeMissed = table(['車輛', '狀態', '說明'], (r) => `<td>${esc(plate(r.車號))}</td><td>${esc(r.狀態)}</td><td>${esc(r.備註)}</td>`)

const title = `樂菲莊園社區 116 年度機車及自行車停車位　第${round === '2' ? '二' : '一'}輪抽籤結果公告`
const notes =
  round === '2'
    ? [`機車配到車位者請於 <b>${roc(deadline)}</b> 前完成繳費，逾期視同放棄。`]
    : [
        `機車配到車位者請於 <b>${roc(deadline)}</b> 前完成繳費，逾期視同放棄，車位釋出供第二輪分配。`,
        '「待第二輪」：每戶第 2 輛起的機車，於第二輪抽籤分配。「待安排」：重型機車，另行安排相鄰兩個大車位。',
        '「未中」：本輪未配到車位，併入第二輪分配。',
      ]
notes.push('應繳金額為機車位年度清潔費；自行車位免費。', '名單先列機車、後列自行車，各依戶號排序。對結果有疑問，請洽管理中心或 A、B 棟櫃台秘書。')

const count = (label, n) => (n ? `${label} ${n} 輛` : '')
const head = `
<h1>${esc(title)}</h1>
<div class="meta">${announce ? `公告日期：${roc(announce)}　` : ''}${deadline ? `繳費期限：${roc(deadline)}　` : ''}${[count('機車配到', assigned.length), count('自行車配到', bikeAssigned.length)].filter(Boolean).join('、')}</div>
<ol class="notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ol>`

const sections = [
  ['機車：配到車位', assigned, tAssigned],
  ['機車：本輪未中', missed, tOther],
  ['機車：待第二輪／待安排', waiting, tOther],
  ['自行車：配到車位', bikeAssigned, tBike],
  ['自行車：未配到車位', bikeMissed, tBikeMissed],
].filter(([, list]) => list.length)
const NUM = ['一', '二', '三', '四', '五']
// 排版：各段接續排，不強制換頁。每頁有「列數額度」，段標題算 2 列；
// 一段在同一頁內左右兩欄平均分，剩不到 6 列就換頁，避免標題孤懸或只剩一列獨佔一頁。
const HEAD_ROWS = 2
const sheets = []
let cur = head
let used = PER - PER_FIRST // 第一頁的抬頭與說明佔掉的列數
const flush = () => {
  sheets.push(cur)
  cur = ''
  used = 0
}
sections.forEach(([label, list, render], n) => {
  let i = 0
  while (i < list.length) {
    if (PER - used - HEAD_ROWS < 6) flush()
    const room = PER - used - HEAD_ROWS
    const take = Math.min(list.length - i, room * 2)
    const half = Math.ceil(take / 2)
    cur += `<h2>${NUM[n]}、${label}（${list.length} 輛，依${hasHid ? '戶號' : '車號'}排序）${i ? '（續）' : ''}</h2><div class="cols"><div>${render(list.slice(i, i + half))}</div><div>${render(list.slice(i + half, i + take))}</div></div>`
    used += half + HEAD_ROWS
    i += take
  }
})
if (cur) flush()
const sign = `<div class="sign">樂菲莊園管理委員會</div>`

const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page { size: A4; margin: 12mm 11mm 12mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Microsoft JhengHei", "PingFang TC", sans-serif; font-size: 9.5pt; color: #111; }
.sheet { position: relative; page-break-after: always; }
.sheet:last-child { page-break-after: auto; }
h1 { font-size: 16pt; text-align: center; margin: 0 0 4px; letter-spacing: 1px; }
.meta { text-align: center; font-size: 10pt; margin-bottom: 4px; }
.notes { margin: 0 0 6px; padding-left: 1.6em; font-size: 9.5pt; line-height: 1.45; }
h2 { font-size: 11.5pt; margin: 8px 0 4px; border-left: 4px solid #333; padding-left: 6px; }
.cols { display: flex; gap: 6mm; align-items: flex-start; }
.cols > div { flex: 1; min-width: 0; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 0.6px solid #666; padding: 0 4px; height: 5.4mm; line-height: 5.2mm; white-space: nowrap; overflow: hidden; text-align: center; }
th { background: #e8e8e8; font-weight: 700; }
tbody tr:nth-child(even) { background: #f6f6f6; }
td.seat { font-weight: 700; font-size: 10pt; }
td.num { text-align: right; }
td.via { font-size: 8.5pt; }
.sign { text-align: right; font-size: 12pt; font-weight: 700; margin-top: 8mm; }
.pageno { text-align: center; font-size: 8.5pt; color: #555; margin-top: 3mm; }
.wm { position: absolute; top: 105mm; left: 0; right: 0; text-align: center; font-size: 110pt; font-weight: 900; color: rgba(200,0,0,.13); transform: rotate(-28deg); pointer-events: none; letter-spacing: 12px; }
</style></head><body>
${sheets
  .map(
    (s, i) =>
      `<section class="sheet">${sample ? '<div class="wm">樣張</div>' : ''}${s}${i === sheets.length - 1 ? sign : ''}<div class="pageno">第 ${i + 1} 頁，共 ${sheets.length} 頁</div></section>`,
  )
  .join('\n')}
</body></html>`

writeFileSync(outHtml, html)
if (existsSync(outPdf)) rmSync(outPdf)
execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${outPdf}`, 'file:///' + outHtml.replace(/\\/g, '/')], {
  stdio: 'ignore',
  timeout: 60000,
})
// Edge 無頭模式失敗時不報錯、直接靜默退出，所以一定要檢查檔案真的產出。
// 行程結束後檔案可能晚一兩秒才落地，等最多 15 秒。
for (let i = 0; i < 30 && !existsSync(outPdf); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
if (!existsSync(outPdf)) {
  console.error('❌ PDF 沒有產出（Edge 無頭模式失敗）。HTML 已寫出：' + outHtml)
  process.exit(1)
}
console.log(`✅ ${outPdf}`)
console.log(`   機車：配到 ${assigned.length}、未中 ${missed.length}、待第二輪／待安排 ${waiting.length}；自行車：配到 ${bikeAssigned.length}、未配到 ${bikeMissed.length}；共 ${sheets.length} 頁${sample ? '（樣張）' : ''}`)
