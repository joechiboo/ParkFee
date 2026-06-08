// 產生「單頁 A4 橫式 PDF」：全部 655 機車位，不分棟別、統一藍色、含號碼。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

const cls = JSON.parse(readFileSync('src/map/b1-classification.json', 'utf8'))
const { dispW, dispH } = cls.meta
const motor = cls.seats.filter((s) => s.cat === 'motor')

const A4 = [841.89, 595.28]
const MARGIN = 18
const TITLE_H = 22
const BLUE = rgb(0.15, 0.39, 0.92)

const pdf = await PDFDocument.create()
const font = await pdf.embedFont(StandardFonts.Helvetica)
const fontB = await pdf.embedFont(StandardFonts.HelveticaBold)
const img = await pdf.embedPng(readFileSync('public/demo/b1.png'))

const [PW, PH] = A4
const page = pdf.addPage(A4)
const aw = PW - MARGIN * 2
const ah = PH - MARGIN * 2 - TITLE_H
const scale = Math.min(aw / dispW, ah / dispH)
const ox = MARGIN, oyTop = MARGIN + TITLE_H
const toX = (x) => ox + x * scale
const toY = (y) => PH - (oyTop + y * scale)

page.drawImage(img, { x: ox, y: PH - (oyTop + dispH * scale), width: dispW * scale, height: dispH * scale })
page.drawText('ParkFee B1 Motorcycle Seats (655)', { x: MARGIN, y: PH - MARGIN - 12, size: 13, font: fontB, color: rgb(0.1, 0.1, 0.12) })

const r = Math.max(2.6, 7 * scale)
for (const s of motor) {
  const cx = toX(s.x), cy = toY(s.y)
  page.drawCircle({ x: cx, y: cy, size: r, color: BLUE, opacity: 0.85 })
  const fs = Math.max(3, r * 0.95)
  const w = font.widthOfTextAtSize(s.id, fs)
  page.drawText(s.id, { x: cx - w / 2, y: cy - fs * 0.36, size: fs, font, color: rgb(1, 1, 1) })
}

mkdirSync('public/print', { recursive: true })
writeFileSync('public/print/b1-motor-seats-1page.pdf', await pdf.save())
console.log('wrote public/print/b1-motor-seats-1page.pdf — 單頁 655 機車位')
