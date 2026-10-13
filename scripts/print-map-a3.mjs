// 產生「單頁 A3 PDF」：B1 機車位分類圖（大/小/無障礙/腳踏車 + 鎖定/公益標記；汽車位不印）。
// 重機不設專區（2026-08-16 決議）：穿插一般車位，圖上無獨立顏色。
// 資料：src/map/b1-classification.json（現場盤點定稿）＋ Supabase locked_seat（目前鎖定保留清單，anon 可讀）。
// 中文用標楷體（C:\Windows\Fonts\kaiu.ttf）內嵌；離線或抓不到鎖定清單時仍出圖，只是不畫鎖定圈。
// 用法：node scripts/print-map-a3.mjs        → public/print/b1-map-a3.pdf（全部車位）
//       node scripts/print-map-a3.mjs --bike → public/print/b1-bike-map-a3.pdf（只印自行車位）
//       --label「附件四」 → 標題前加標籤（併入公告文件用）；--out <路徑> → 另存他處
//       --paper A4|A3|A2|A1|A0（預設 A3）→ 圖面與文字隨紙張放大，印章維持實際尺寸
//       --seal image｜blank → 加電子章／留白蓋章（不加＝只印管委會名稱電話，一般張貼用）
//         ⚠️ 電子章版禁止輸出到 public/（repo 公開，印章會被下載偽造），程式會直接擋
//       列印務必選「實際大小／100%」，勿選「符合頁面大小」——否則印章會跟著縮放
//
// --bike 的用途：自行車 164 格全擠在右下角一小塊，混在全區圖裡號碼小到看不清。
// 只印自行車時裁切範圍自動縮到該區 → 同樣一張 A3 但放大數倍，號碼看得清楚，
// 可直接拿去現場對號、貼識別證、或當公告附圖。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve as resolvePath, sep as pathSep } from 'node:path'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { toBikeId, PUBLIC_BIKE_IDS } from '../src/map/seat-id.js'

const cls = JSON.parse(readFileSync('src/map/b1-classification.json', 'utf8'))

// 盤點檔的 public 只標了機車 20 格（平面圖上有金框）；公益**自行車**位 114–118 是辦法參二(七)
// 明列、圖上無視覺標示 → 盤點檔沒有、必須另外對照，否則列印圖會漏標這 5 格。
const PUBLIC_BIKE = new Set(PUBLIC_BIKE_IDS)
const isPublicSeat = (s) => (s.cat === 'bike' ? PUBLIC_BIKE.has(toBikeId(s.id)) : !!s.public)

// 鎖定清單裡自行車存的是正規形 B012、機車是裸數字 12 → 依 cat 換算後才比對。
// 若直接用 s.id 比，機車 12 被鎖時會讓自行車 12 也畫上鎖定圈（兩者地面號碼重複）。
const lockKeyOf = (s) => (s.cat === 'bike' ? toBikeId(s.id) : String(s.id))
const { dispW, dispH } = cls.meta

// 目前鎖定保留清單（Supabase locked_seat，anon 可讀）
async function fetchLocked() {
  const env = {}
  try {
    for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m) env[m[1]] = m[2].trim()
    }
  } catch { return null }
  const url = env.VITE_SUPABASE_URL, key = env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  try {
    const r = await fetch(`${url}/rest/v1/locked_seat?select=${encodeURIComponent('車位編號')}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return new Set((await r.json()).map((row) => String(row.車位編號)))
  } catch (e) {
    console.warn('⚠️ 抓不到 locked_seat（' + e.message + '），改印無鎖定標記版')
    return null
  }
}

// 分類顏色（沿用 classify.html 盤點工具配色）
const CAT = {
  motor: { name: '大車位', color: rgb(0.23, 0.51, 0.96) },
  small: { name: '小車位', color: rgb(0.55, 0.36, 0.96) },
  access: { name: '無障礙', color: rgb(0.92, 0.70, 0.03) },
  bike: { name: '腳踏車', color: rgb(0.98, 0.45, 0.09) },
} // 汽車位不印 — 本圖主打機車位（cat 不在 CAT 即跳過）
const catOf = (s) => s.cat

// --bike：只印自行車位。裁切範圍由「要印的車位」決定 → 自動放大到該區。
const BIKE_ONLY = process.argv.includes('--bike')
const PRINT_CATS = BIKE_ONLY ? new Set(['bike']) : new Set(Object.keys(CAT))
const willPrint = (s) => catOf(s) in CAT && PRINT_CATS.has(catOf(s))

const locked = await fetchLocked()

// 只印車位所在區域：取有效車位外框 + 邊距，右半台電圖說/圖框不進版面
const drawn = cls.seats.filter(willPrint)
const PAD = 36
const rx0 = Math.max(0, Math.min(...drawn.map((s) => s.x)) - PAD)
const rx1 = Math.min(dispW, Math.max(...drawn.map((s) => s.x)) + PAD)
const ry0 = Math.max(0, Math.min(...drawn.map((s) => s.y)) - PAD)
const ry1 = Math.min(dispH, Math.max(...drawn.map((s) => s.y)) + PAD)
const rw = rx1 - rx0, rh = ry1 - ry0

// ── 紙張大小（2026-10）：--paper A4|A3|A2|A1|A0，預設 A3 ──
// 圖面、標題、圖例隨紙張等比放大（K＝短邊相對 A3 的倍率）；**印章不放大**，一律用實際尺寸
// （見 SEAL_PX_PER_PT）——否則 A2 海報上會出現巨大印章，一看就不像真的蓋上去。
const PAPERS = { A4: [595.28, 841.89], A3: [841.89, 1190.55], A2: [1190.55, 1683.78], A1: [1683.78, 2383.94], A0: [2383.94, 3370.39] }
const paperAt = process.argv.indexOf('--paper')
const PAPER = (paperAt > 0 ? process.argv[paperAt + 1] : 'A3').toUpperCase()
if (!PAPERS[PAPER]) throw new Error('--paper 只接受 ' + Object.keys(PAPERS).join('、'))
const [SHORT, LONG] = PAPERS[PAPER]
const K = SHORT / PAPERS.A3[0]
const MARGIN = 20 * K
// 2026-10 版面依主委修改稿：標題、圖例移到右上空白處，頂端不再保留標題列 → 圖面可再放大。
// （--bike 自行車版已不維護，沿用舊的頂端標題列）
const TITLE_H = BIKE_ONLY ? 34 * K : 0
// 直式/橫式挑縮放較大者
const fit = ([w, h]) => Math.min((w - MARGIN * 2) / rw, (h - MARGIN * 2 - TITLE_H) / rh)
const LAND = [LONG, SHORT], PORT = [SHORT, LONG]
const SIZE = fit(LAND) >= fit(PORT) ? LAND : PORT

const pdf = await PDFDocument.create()
pdf.registerFontkit(fontkit)
const zh = await pdf.embedFont(readFileSync('C:/Windows/Fonts/kaiu.ttf'), { subset: true })
const num = await pdf.embedFont(StandardFonts.Helvetica)
const img = await pdf.embedPng(readFileSync('public/demo/b1.png'))

const [PW, PH] = SIZE
const page = pdf.addPage(SIZE)
const aw = PW - MARGIN * 2
const ah = PH - MARGIN * 2 - TITLE_H
const scale = Math.min(aw / rw, ah / rh)
const ox = MARGIN + (aw - rw * scale) / 2 // 置中
const oyTop = MARGIN + TITLE_H + (ah - rh * scale) / 2
const toX = (x) => ox + (x - rx0) * scale
const toY = (y) => PH - (oyTop + (y - ry0) * scale)

// 底圖整張縮放平移（超出頁面由列印裁切），再用白帶蓋掉標題區殘影
page.drawImage(img, {
  x: ox - rx0 * scale,
  y: PH - (oyTop - ry0 * scale + dispH * scale),
  width: dispW * scale,
  height: dispH * scale,
})
const white = rgb(1, 1, 1)
page.drawRectangle({ x: 0, y: PH - oyTop, width: PW, height: oyTop, color: white }) // 上
page.drawRectangle({ x: 0, y: 0, width: PW, height: PH - (oyTop + rh * scale), color: white }) // 下
page.drawRectangle({ x: 0, y: 0, width: ox, height: PH, color: white }) // 左
page.drawRectangle({ x: ox + rw * scale, y: 0, width: PW - (ox + rw * scale), height: PH, color: white }) // 右
// 右上角（建築線外）台電配電圖說：該區無任何車位（x>825 且 y<1100 空集合已驗證，首排汽車位 y≈1126），白幕遮掉。
// 只印自行車時裁切範圍整個在該區之下/之右 → 不需要（也不能畫，會把圖蓋掉）。
if (rx1 > 825 && ry0 < 1070) {
  const mx0 = Math.max(825, rx0)
  page.drawRectangle({ x: toX(mx0), y: toY(1070), width: (rx1 - mx0) * scale, height: (1070 - ry0) * scale, color: white })
}

// 標題 + 產出日期
const today = new Date().toISOString().slice(0, 10)
// --label「附件四」：併入公告文件時，首頁左上角需標示這是第幾份附件。
// 本圖左上角就是標題列，故把標籤寫進標題，不另外蓋章（見 scripts/stamp-attachment.mjs）。
const labelAt = process.argv.indexOf('--label')
const LABEL = labelAt > 0 ? process.argv[labelAt + 1] : ''
if (BIKE_ONLY) {
  const t = (LABEL ? LABEL + '　' : '') + 'B1 自行車位配置圖'
  page.drawText(t, { x: MARGIN, y: PH - MARGIN - 16 * K, size: 18 * K, font: zh, color: rgb(0.08, 0.09, 0.11) })
  page.drawText(today, { x: MARGIN + zh.widthOfTextAtSize(t, 18 * K) + 14 * K, y: PH - MARGIN - 15 * K, size: 10 * K, font: zh, color: rgb(0.45, 0.48, 0.55) })
}

// 車位圓點。全區圖維持 7（既有版面，勿動）；自行車版裁切範圍小、放大倍率高，
// 沿用 7 會讓圓點直徑超過車位間距（自行車格間距僅約 8.5 單位）而糊成一條 →
// 改依該版車位的最小間距收斂。
const pitch = (() => {
  let min = Infinity
  for (let i = 1; i < drawn.length; i++) {
    for (let j = Math.max(0, i - 6); j < i; j++) {
      const d = Math.hypot(drawn[i].x - drawn[j].x, drawn[i].y - drawn[j].y)
      if (d > 0.5 && d < min) min = d
    }
  }
  return Number.isFinite(min) ? min : 14
})()
const r = (BIKE_ONLY ? Math.min(7, pitch * 0.47) : 7) * scale
// ⚠️ 分兩趟畫：先鋪滿所有底色圓點，標記與編號才疊上去。
// 原因：小車位（間距 8.1pt）與自行車位（6.5pt）的間距小於圓直徑（10.8pt），
// 單趟畫時「後一格的實心圓」會蓋掉「前一格的金圈／黑圈」——連號的公益自行車位
// 114–118 幾乎整串被抹掉，看起來像沒圈。
const counts = {}
let lockedDrawn = 0
const printable = cls.seats.filter(willPrint) // noise/excl／非本版車種 不印

// 2026-10 主委要求：**鎖定格**圓內留白、不填車種色——鎖定格不開放承租，大／小之分對它無意義，
// 留白一眼可辨「這格不能選」。編號改黑字（白字在白底上看不見）。其餘車位維持實心填色＋白字。
const isLocked = (s) => !!locked && locked.has(lockKeyOf(s)) && catOf(s) !== 'car'
// 2026-10-13 起**社宅位也空心**（含自行車公益位 114–118）：社宅位與不開放位在圖例上同屬
// 「（不選擇）」——一般住戶都選不到，畫法一致才一眼看得出來。金框照留以區分兩者。
const isHollow = (s) => isLocked(s) || isPublicSeat(s)

for (const s of printable) {
  const cat = catOf(s)
  counts[cat] = (counts[cat] || 0) + 1
  const fill = isHollow(s) ? rgb(1, 1, 1) : CAT[cat].color
  page.drawCircle({ x: toX(s.x), y: toY(s.y), size: r, color: fill, opacity: isHollow(s) ? 1 : 0.9 })
}

const fs = Math.max(2.8, r * 0.92)
for (const s of printable) {
  const cx = toX(s.x), cy = toY(s.y)
  if (isPublicSeat(s)) // 公益位：金色粗框（機車 20 格來自盤點檔、自行車 5 格來自辦法清單）
    page.drawCircle({ x: cx, y: cy, size: r + 0.6, borderColor: rgb(0.83, 0.66, 0.12), borderWidth: 1.4, opacity: 0 })
  if (isLocked(s)) {
    page.drawCircle({ x: cx, y: cy, size: r + 0.7, borderColor: rgb(0.1, 0.1, 0.12), borderWidth: 1.6, opacity: 0 })
    lockedDrawn++
  }
}
// 第三趟才寫號碼：車位間距小於圓直徑，相鄰格的金框／黑框會互相交疊。若「框＋號碼」同一趟畫，
// 後一格的框會壓過前一格的號碼（社宅位改空心黑字後尤其明顯：自行車 114–118、機車 92–96 號碼被切）。
// 號碼最後統一疊上，保證永遠在最上層。
for (const s of printable) {
  const cx = toX(s.x), cy = toY(s.y)
  const w = num.widthOfTextAtSize(String(s.id), fs)
  const numColor = isHollow(s) ? rgb(0.08, 0.08, 0.1) : rgb(1, 1, 1)
  page.drawText(String(s.id), { x: cx - w / 2, y: cy - fs * 0.36, size: fs, font: num, color: numColor })
}

// ── 公告用印參數 ──────────────────────────────────────────────────────────────
//   --seal image：直接嵌入電子章（印章圖檔取自 private/seals/，由 extract-seals.mjs 產生）
//   --seal blank：印章位置留白，印出後人工蓋章
//   未指定：只印管委會名稱與電話（一般張貼／網站用）
// ⚠️ 本 repo 公開：電子章版**禁止輸出到 public/**（會隨網站部署，任何人可下載印章偽造公告）。
const sealAt = process.argv.indexOf('--seal')
const SEAL = sealAt > 0 ? process.argv[sealAt + 1] : ''
if (SEAL && !['image', 'blank'].includes(SEAL)) throw new Error('--seal 只接受 image 或 blank')
if (SEAL === 'image') {
  const outPath = process.argv.indexOf('--out') > 0 ? process.argv[process.argv.indexOf('--out') + 1] : 'public/print/b1-map-a3'
  // 以絕對路徑比對，不靠字串樣式（相對路徑、./public、大小寫磁碟代號都擋得到）
  if (resolvePath(outPath).toLowerCase().startsWith(resolvePath('public').toLowerCase() + pathSep))
    throw new Error('電子章版不得輸出到 public/（會上網站）。請用 --out 指到 docs/pdf/ 或 private/')
}

// ── 右上資訊區（2026-10 依主委修改稿）：標題 → 圖例（種類／數量／備註）→ 管委會＋印章 ──
// 位置＝建築線外台電區（已白幕遮掉、無車位）。標題與圖例隨紙張放大（×K）；印章用實際尺寸。
if (!BIKE_ONLY) {
  const ink = rgb(0.1, 0.1, 0.12)
  const L = toX(Math.max(825, rx0)) + 10 * K
  const R = PW - MARGIN
  const BOTTOM = toY(1070)
  const C = (L + R) / 2
  let y = PH - MARGIN

  // 標題（過長則自動縮字，確保塞得進空白區）
  const TITLE_TXT = (LABEL ? LABEL + '　' : '') + '樂菲莊園 B1 停車場機車及腳踏車車位配置圖'
  const tSize = Math.min(24 * K, (R - L) / zh.widthOfTextAtSize(TITLE_TXT, 1))
  y -= tSize
  page.drawText(TITLE_TXT, { x: C - zh.widthOfTextAtSize(TITLE_TXT, tSize) / 2, y, size: tSize, font: zh, color: rgb(0.08, 0.09, 0.11) })
  y -= 16 * K

  // 圖例：畫法與圖上一致（實心＝車種；白底黑框＝不開放；白底金框＝社宅）
  // 數量一律取自實際畫出的格數，不手填——圖例與圖面才不會對不上。
  const pubCount = printable.filter(isPublicSeat).length
  const rows = [
    { kind: 'fill', color: CAT.motor.color, label: '大車位', n: counts.motor || 0 },
    { kind: 'fill', color: CAT.small.color, label: '小車位', n: counts.small || 0 },
    { kind: 'fill', color: CAT.bike.color, label: '腳踏車位', n: counts.bike || 0 },
    { kind: 'fill', color: CAT.access.color, label: '無障礙車位', n: counts.access || 0 },
    ...(locked ? [{ kind: 'locked', label: '不開放車位', n: lockedDrawn, note: '（不選擇）' }] : []),
    { kind: 'public', label: '社宅車位', n: pubCount, note: '（不選擇）' },
  ]
  const LS = 15 * K, RH = 24 * K, ICON = 7.5 * K, GAP = 14 * K
  const wOf = (t) => zh.widthOfTextAtSize(t, LS)
  const labelW = Math.max(...rows.map((x) => wOf(x.label)))
  const numW = Math.max(...rows.map((x) => wOf(`${x.n} 席`)))
  const noteW = Math.max(0, ...rows.map((x) => (x.note ? wOf(x.note) : 0)))
  const tableW = ICON * 2 + GAP + labelW + GAP + numW + GAP * 0.5 + noteW
  const x0 = C - tableW / 2
  for (const row of rows) {
    y -= RH
    const cy = y + LS * 0.36
    const ix = x0 + ICON
    if (row.kind === 'fill') page.drawCircle({ x: ix, y: cy, size: ICON, color: row.color, opacity: 0.9 })
    else if (row.kind === 'locked')
      page.drawCircle({ x: ix, y: cy, size: ICON, color: rgb(1, 1, 1), borderColor: rgb(0.1, 0.1, 0.12), borderWidth: 1.8 * K })
    else page.drawCircle({ x: ix, y: cy, size: ICON, color: rgb(1, 1, 1), borderColor: rgb(0.83, 0.66, 0.12), borderWidth: 2 * K })
    const xl = x0 + ICON * 2 + GAP
    page.drawText(row.label, { x: xl, y, size: LS, font: zh, color: ink })
    const nTxt = `${row.n} 席`
    page.drawText(nTxt, { x: xl + labelW + GAP + numW - wOf(nTxt), y, size: LS, font: zh, color: ink }) // 數量靠右對齊
    if (row.note) page.drawText(row.note, { x: xl + labelW + GAP + numW + GAP * 0.5, y, size: LS, font: zh, color: ink })
  }
  y -= 26 * K

  // 管委會＋印章：依社區公告頁尾格式 [紅色方章] 樂菲莊園管理委員會／電話 [藍色公告章]
  // 印章用**實際尺寸**：剪章時以每 pt 6 像素擷取（須與 extract-seals.mjs 的 SCALE 一致），
  // 圖檔像素 ÷ 6 ＝ 公告上的原始大小（紅章約 28mm 見方、公告章約 45.5×31mm），不隨 K 放大。
  const SEAL_PX_PER_PT = 6
  const MM = 72 / 25.4
  let redImg = null, blueImg = null
  let redW = 28 * MM, redH = 28 * MM, blueW = 45.5 * MM, blueH = 31 * MM // 留白版用的章位大小
  if (SEAL === 'image') {
    try {
      redImg = await pdf.embedPng(readFileSync('private/seals/seal-committee.png'))
      blueImg = await pdf.embedPng(readFileSync('private/seals/seal-notice.png'))
    } catch {
      throw new Error('找不到 private/seals/ 印章圖檔 → 先跑 node scripts/extract-seals.mjs <公告.pdf>')
    }
    redW = redImg.width / SEAL_PX_PER_PT; redH = redImg.height / SEAL_PX_PER_PT
    blueW = blueImg.width / SEAL_PX_PER_PT; blueH = blueImg.height / SEAL_PX_PER_PT
  }
  const ORG = '樂菲莊園管理委員會', TEL = '電話 02-2218-6136'
  const SZ_ORG = 17 * K, SZ_TEL = 12 * K
  const textW = Math.max(zh.widthOfTextAtSize(ORG, SZ_ORG), zh.widthOfTextAtSize(TEL, SZ_TEL))
  const SG = 12 * K
  const withSeal = SEAL === 'image' || SEAL === 'blank'
  const blockH = withSeal ? Math.max(redH, blueH, SZ_ORG + SZ_TEL + 10 * K) : SZ_ORG + SZ_TEL + 10 * K
  const midY = y - blockH / 2
  const blockW = withSeal ? redW + SG + textW + SG + blueW : textW
  const xRed = C - blockW / 2
  const xText = withSeal ? xRed + redW + SG : C - textW / 2
  const xBlue = xText + textW + SG
  if (redImg) page.drawImage(redImg, { x: xRed, y: midY - redH / 2, width: redW, height: redH })
  if (blueImg) page.drawImage(blueImg, { x: xBlue, y: midY - blueH / 2, width: blueW, height: blueH })
  page.drawText(ORG, { x: xText + (textW - zh.widthOfTextAtSize(ORG, SZ_ORG)) / 2, y: midY + 2 * K, size: SZ_ORG, font: zh, color: ink })
  page.drawText(TEL, { x: xText + (textW - zh.widthOfTextAtSize(TEL, SZ_TEL)) / 2, y: midY - SZ_TEL - 4 * K, size: SZ_TEL, font: zh, color: ink })
  y = midY - blockH / 2

  // 資訊區超出空白區（壓到車位）時要叫出來，不能默默疊圖
  if (y < BOTTOM) console.warn(`⚠️ 右上資訊區超出空白區 ${(BOTTOM - y).toFixed(0)}pt，可能壓到圖面——請縮小字級或改紙張方向`)
  if (L + 1 > C - Math.max(tableW, blockW) / 2) console.warn('⚠️ 右上資訊區寬度超出空白區，可能壓到圖面')
}

// --out：指定輸出路徑（公告用的附件四另存一份，不動 public/print 的常態圖）
const outAt = process.argv.indexOf('--out')
const BASE = outAt > 0
  ? process.argv[outAt + 1].replace(/\.pdf$/i, '')
  : (BIKE_ONLY ? 'public/print/b1-bike-map-a3' : 'public/print/b1-map-a3')
mkdirSync(BASE.replace(/[^/]*$/, '') || '.', { recursive: true })
const bytes = await pdf.save()
let out = BASE + '.pdf'
try {
  writeFileSync(out, bytes)
} catch (e) {
  if (e.code !== 'EBUSY') throw e
  out = BASE + '-new.pdf' // 原檔被 PDF 閱讀器咬住 → 寫備用檔名
  writeFileSync(out, bytes)
  console.warn('⚠️ ' + BASE + '.pdf 使用中（先關閱讀器再重跑可覆蓋原檔），已改寫到 ' + out)
}
const pub = printable.filter(isPublicSeat)
const pubBike = pub.filter((s) => s.cat === 'bike').length
console.log('wrote ' + out + ' —', PAPER + (PW > PH ? ' 橫式' : ' 直式'), JSON.stringify(counts),
  'locked:', locked ? lockedDrawn : 'n/a', `public: ${pub.length}（機車 ${pub.length - pubBike}＋自行車 ${pubBike}）`)