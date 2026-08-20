// 產生「單頁 A3 PDF」：B1 機車位分類圖（大/小/無障礙/腳踏車 + 鎖定/公益標記；汽車位不印）。
// 重機不設專區（2026-08-16 決議）：穿插一般車位，圖上無獨立顏色。
// 資料：src/map/b1-classification.json（現場盤點定稿）＋ Supabase locked_seat（目前鎖定保留清單，anon 可讀）。
// 中文用標楷體（C:\Windows\Fonts\kaiu.ttf）內嵌；離線或抓不到鎖定清單時仍出圖，只是不畫鎖定圈。
// 用法：node scripts/print-map-a3.mjs        → public/print/b1-map-a3.pdf（全部車位）
//       node scripts/print-map-a3.mjs --bike → public/print/b1-bike-map-a3.pdf（只印自行車位）
//
// --bike 的用途：自行車 164 格全擠在右下角一小塊，混在全區圖裡號碼小到看不清。
// 只印自行車時裁切範圍自動縮到該區 → 同樣一張 A3 但放大數倍，號碼看得清楚，
// 可直接拿去現場對號、貼識別證、或當公告附圖。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
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

const MARGIN = 20
const TITLE_H = 34
// A3 直式/橫式挑縮放較大者
const fit = ([w, h]) => Math.min((w - MARGIN * 2) / rw, (h - MARGIN * 2 - TITLE_H) / rh)
const LAND = [1190.55, 841.89], PORT = [841.89, 1190.55]
const A3 = fit(LAND) >= fit(PORT) ? LAND : PORT

const pdf = await PDFDocument.create()
pdf.registerFontkit(fontkit)
const zh = await pdf.embedFont(readFileSync('C:/Windows/Fonts/kaiu.ttf'), { subset: true })
const num = await pdf.embedFont(StandardFonts.Helvetica)
const img = await pdf.embedPng(readFileSync('public/demo/b1.png'))

const [PW, PH] = A3
const page = pdf.addPage(A3)
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
const TITLE = BIKE_ONLY ? 'B1 自行車位配置圖' : 'B1 停車場車位配置圖'
page.drawText(TITLE, { x: MARGIN, y: PH - MARGIN - 16, size: 18, font: zh, color: rgb(0.08, 0.09, 0.11) })
page.drawText(today + (locked ? '' : '（無鎖定資料）'), { x: MARGIN + zh.widthOfTextAtSize(TITLE, 18) + 14, y: PH - MARGIN - 15, size: 10, font: zh, color: rgb(0.45, 0.48, 0.55) })

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
const counts = {}
let lockedDrawn = 0
for (const s of cls.seats) {
  const cat = catOf(s)
  if (!willPrint(s)) continue // noise/excl／非本版車種 不印
  counts[cat] = (counts[cat] || 0) + 1
  const cx = toX(s.x), cy = toY(s.y)
  page.drawCircle({ x: cx, y: cy, size: r, color: CAT[cat].color, opacity: 0.9 })
  if (isPublicSeat(s)) // 公益位：金色粗框（機車 20 格來自盤點檔、自行車 5 格來自辦法清單）
    page.drawCircle({ x: cx, y: cy, size: r + 0.6, borderColor: rgb(0.83, 0.66, 0.12), borderWidth: 1.4, opacity: 0 })
  if (locked && locked.has(lockKeyOf(s)) && cat !== 'car') {
    page.drawCircle({ x: cx, y: cy, size: r + 0.7, borderColor: rgb(0.1, 0.1, 0.12), borderWidth: 1.6, opacity: 0 })
    lockedDrawn++
  }
  const fs = Math.max(2.8, r * 0.92)
  const w = num.widthOfTextAtSize(String(s.id), fs)
  page.drawText(String(s.id), { x: cx - w / 2, y: cy - fs * 0.36, size: fs, font: num, color: rgb(1, 1, 1) })
}

// 圖例（標題列右側一排）
let lx = MARGIN + zh.widthOfTextAtSize(TITLE, 18) + 100
const ly = PH - MARGIN - 14
for (const key of ['motor', 'small', 'access', 'bike']) {
  if (!PRINT_CATS.has(key)) continue
  const c = CAT[key]
  page.drawCircle({ x: lx + 5, y: ly + 4, size: 5, color: c.color, opacity: 0.9 })
  const label = `${c.name} ${counts[key] || 0}`
  page.drawText(label, { x: lx + 13, y: ly, size: 10.5, font: zh, color: rgb(0.1, 0.1, 0.12) })
  lx += 13 + zh.widthOfTextAtSize(label, 10.5) + 18
}
if (locked) {
  page.drawCircle({ x: lx + 5, y: ly + 4, size: 5, borderColor: rgb(0.1, 0.1, 0.12), borderWidth: 1.6, opacity: 0 })
  page.drawText(`鎖定保留 ${lockedDrawn}`, { x: lx + 13, y: ly, size: 10.5, font: zh, color: rgb(0.1, 0.1, 0.12) })
  lx += 13 + zh.widthOfTextAtSize(`鎖定保留 ${lockedDrawn}`, 10.5) + 18
}
page.drawCircle({ x: lx + 5, y: ly + 4, size: 5, borderColor: rgb(0.83, 0.66, 0.12), borderWidth: 1.6, opacity: 0 })
page.drawText('公益位（社宅）', { x: lx + 13, y: ly, size: 10.5, font: zh, color: rgb(0.1, 0.1, 0.12) })

mkdirSync('public/print', { recursive: true })
const bytes = await pdf.save()
const BASE = BIKE_ONLY ? 'public/print/b1-bike-map-a3' : 'public/print/b1-map-a3'
let out = BASE + '.pdf'
try {
  writeFileSync(out, bytes)
} catch (e) {
  if (e.code !== 'EBUSY') throw e
  out = BASE + '-new.pdf' // 原檔被 PDF 閱讀器咬住 → 寫備用檔名
  writeFileSync(out, bytes)
  console.warn('⚠️ ' + BASE + '.pdf 使用中（先關閱讀器再重跑可覆蓋原檔），已改寫到 ' + out)
}
console.log('wrote ' + out + ' —', PW > PH ? 'A3 橫式' : 'A3 直式', JSON.stringify(counts), 'locked:', locked ? lockedDrawn : 'n/a')