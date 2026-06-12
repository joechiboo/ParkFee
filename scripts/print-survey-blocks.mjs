// 產生「待盤點兩塊」A4 PDF，供下週現場盤點手寫真實號碼。
//   左塊（x<700，又高又窄）：排直式 A4 後設頁面旋轉 90° → 列印時橫躺、字較大。
//   右塊（x>=700，近方形）：直式正常。
// 只畫「未盤點(verified!=true)」的機車位，空心圈 + 目前號碼，留白供手寫。
// 標題用英數：pdf-lib 內建 Helvetica 不支援中文。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib'

const cls = JSON.parse(readFileSync('src/map/b1-classification.json', 'utf8'))
const { dispW, dispH } = cls.meta
const motor = cls.seats.filter((s) => s.cat === 'motor' && !s.verified)

const A4_P = [595.28, 841.89] // 直式 pt
const MARGIN = 24
const TITLE_H = 26

const pdf = await PDFDocument.create()
const font = await pdf.embedFont(StandardFonts.Helvetica)
const fontB = await pdf.embedFont(StandardFonts.HelveticaBold)
const img = await pdf.embedPng(readFileSync('public/demo/b1.png'))

function drawBlock(title, seats, { rotate = false } = {}) {
  const pad = 40
  const xs = seats.map((s) => s.x), ys = seats.map((s) => s.y)
  const region = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad]
  const [PW, PH] = A4_P
  const page = pdf.addPage(A4_P)
  const aw = PW - MARGIN * 2
  const ah = PH - MARGIN * 2 - TITLE_H
  const [rx0, ry0, rx1, ry1] = region
  const scale = Math.min(aw / (rx1 - rx0), ah / (ry1 - ry0))
  const ox = MARGIN, oyTop = MARGIN + TITLE_H
  const toPageX = (x) => ox + (x - rx0) * scale
  const toPageY = (y) => PH - (oyTop + (y - ry0) * scale)

  // 底圖（整張 b1，超出由檢視器裁切）
  const imgW = dispW * scale, imgH = dispH * scale
  page.drawImage(img, { x: ox - rx0 * scale, y: PH - (oyTop - ry0 * scale + imgH), width: imgW, height: imgH })

  // 標題
  page.drawText(title, { x: MARGIN, y: PH - MARGIN - 14, size: 12, font: fontB, color: rgb(0.1, 0.1, 0.12) })

  // 車位：空心圈 + 目前號碼
  const r = Math.max(3.5, Math.min(7 * scale, 6))
  for (const s of seats) {
    const cx = toPageX(s.x), cy = toPageY(s.y)
    page.drawCircle({ x: cx, y: cy, size: r, color: rgb(1, 1, 1), opacity: 0.65, borderColor: rgb(0.13, 0.32, 0.75), borderWidth: 0.7 })
    const fs = Math.max(3.6, r * 0.95)
    const w = font.widthOfTextAtSize(s.id, fs)
    page.drawText(s.id, { x: cx - w / 2, y: cy - fs * 0.36, size: fs, font, color: rgb(0.1, 0.1, 0.12) })
  }

  if (rotate) page.setRotation(degrees(90))
  return page
}

const left = motor.filter((s) => s.x < 700)
const right = motor.filter((s) => s.x >= 700)
drawBlock(`B1 Survey - LEFT block (${left.length} seats) - ROTATED for print`, left, { rotate: true })
drawBlock(`B1 Survey - RIGHT block (${right.length} seats)`, right, { rotate: false })

mkdirSync('public/print', { recursive: true })
writeFileSync('public/print/b1-survey-blocks.pdf', await pdf.save())
console.log(`wrote public/print/b1-survey-blocks.pdf — LEFT(${left.length}, rotated) + RIGHT(${right.length})`)
