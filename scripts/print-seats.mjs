// 產生 A4 橫式 PDF：B1 機車位紙本（總覽 + 各棟放大）。
// 向量輸出、固定 A4，避免直接列印 HTML 的縮放問題。
// 棟別目前用「最近梯廳核心」；之後接 b1-towers.json 可換成正式指定。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

const cls = JSON.parse(readFileSync('src/map/b1-classification.json', 'utf8'))
const { dispW, dispH } = cls.meta
const motor = cls.seats.filter((s) => s.cat === 'motor').map((s) => ({ id: s.id, x: s.x, y: s.y }))

const CORES = [
  { name: 'AB', x: 581, y: 424, color: [0.86, 0.15, 0.15] },
  { name: 'CD', x: 563, y: 1168, color: [0.14, 0.39, 0.92] },
  { name: 'EF', x: 1102, y: 1375, color: [0.09, 0.64, 0.29] },
  { name: 'GH', x: 1378, y: 1375, color: [0.92, 0.35, 0.05] },
]
// 棟別：優先用正式指定檔，否則最近核心
let towerOf
if (existsSync('src/map/b1-towers.json')) {
  const t = JSON.parse(readFileSync('src/map/b1-towers.json', 'utf8'))
  const m = new Map(t.seats.map((s) => [s.id, s.tower]))
  towerOf = (s) => m.get(s.id) || nearest(s)
} else {
  towerOf = (s) => nearest(s)
}
function nearest(s) {
  let bn = 'AB', bd = Infinity
  for (const c of CORES) { const d = (s.x - c.x) ** 2 + (s.y - c.y) ** 2; if (d < bd) { bd = d; bn = c.name } }
  return bn
}
const colorOf = (name) => { const c = CORES.find((c) => c.name === name).color; return rgb(...c) }

const A4 = [841.89, 595.28] // 橫式 pt
const MARGIN = 24
const TITLE_H = 26

const pdf = await PDFDocument.create()
const font = await pdf.embedFont(StandardFonts.Helvetica)
const fontB = await pdf.embedFont(StandardFonts.HelveticaBold)
const pngBytes = readFileSync('public/demo/b1.png')
const img = await pdf.embedPng(pngBytes)

// 在一頁上畫出 region[rx0,ry0,rx1,ry1]（顯示座標）的底圖，並疊上 seats（含號碼）
function drawPage(title, region, seats, showNums) {
  const [PW, PH] = A4
  const page = pdf.addPage(A4)
  const aw = PW - MARGIN * 2
  const ah = PH - MARGIN * 2 - TITLE_H
  const [rx0, ry0, rx1, ry1] = region
  const scale = Math.min(aw / (rx1 - rx0), ah / (ry1 - ry0))
  const ox = MARGIN, oyTop = MARGIN + TITLE_H // 內容區左上（從上算）
  const toPageX = (x) => ox + (x - rx0) * scale
  const toPageY = (y) => PH - (oyTop + (y - ry0) * scale) // PDF y-up

  // 底圖（整張 b1，超出頁面部分由檢視器裁切）
  const imgW = dispW * scale, imgH = dispH * scale
  const imgLeftTop_x = ox - rx0 * scale
  const imgLeftTop_yFromTop = oyTop - ry0 * scale
  page.drawImage(img, { x: imgLeftTop_x, y: PH - (imgLeftTop_yFromTop + imgH), width: imgW, height: imgH })

  // 標題
  page.drawText(title, { x: MARGIN, y: PH - MARGIN - 14, size: 14, font: fontB, color: rgb(0.1, 0.1, 0.12) })

  // seats
  const r = Math.max(3, 7 * scale)
  for (const s of seats) {
    const cx = toPageX(s.x), cy = toPageY(s.y)
    page.drawCircle({ x: cx, y: cy, size: r, color: colorOf(towerOf(s)), opacity: 0.9 })
    if (showNums) {
      const fs = Math.max(3.5, r * 0.95)
      const w = font.widthOfTextAtSize(s.id, fs)
      page.drawText(s.id, { x: cx - w / 2, y: cy - fs * 0.36, size: fs, font, color: rgb(1, 1, 1) })
    }
  }
  return page
}

// 1) 總覽（全區，依棟別上色，不畫號碼以免糊）
drawPage(`ParkFee B1 Motorcycle Seats - Overview (655)   AB:red  CD:blue  EF:green  GH:orange`, [0, 0, dispW, dispH], motor, false)

// 2~5) 各棟放大（含號碼）
for (const c of CORES) {
  const seats = motor.filter((s) => towerOf(s) === c.name)
  if (!seats.length) continue
  const pad = 60
  const xs = seats.map((s) => s.x), ys = seats.map((s) => s.y)
  const region = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad]
  drawPage(`ParkFee B1 Motorcycle Seats - Building ${c.name}  (${seats.length})`, region, seats, true)
}

mkdirSync('public/print', { recursive: true })
writeFileSync('public/print/b1-motor-seats.pdf', await pdf.save())
console.log('wrote public/print/b1-motor-seats.pdf — 1 總覽 + 各棟頁')
