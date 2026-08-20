// 把我方 seat 座標疊到指定 PDF 的裁切區上，方便肉眼核對「幾號在哪裡」
// 用法: node scripts/overlay-seats-on-pdf.mjs <pdf> <out.png> <scale> <x0 y0 x1 y1> [--new]
//   --new 表示目標是竣工圖，座標會先做舊→新的仿射轉換
import * as mupdf from 'mupdf'
import fs from 'fs'
import { PNG } from 'pngjs'

const args = process.argv.slice(2)
const useNew = args.includes('--new')
const [src, out, scaleStr, x0s, y0s, x1s, y1s] = args.filter(a => a !== '--new')
const s = Number(scaleStr)
const [X0, Y0, X1, Y1] = [x0s, y0s, x1s, y1s].map(Number)

const doc = mupdf.Document.openDocument(fs.readFileSync(src), 'application/pdf')
const page = doc.loadPage(0)
const bbox = [X0 * s, Y0 * s, X1 * s, Y1 * s].map(Math.round)
const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, bbox, false)
pix.clear(255)
const dev = new mupdf.DrawDevice(mupdf.Matrix.scale(s, s), pix)
page.run(dev, mupdf.Matrix.identity)
dev.close()
const img = PNG.sync.read(Buffer.from(pix.asPNG()))
const W = img.width, H = img.height

// 舊圖 -> 竣工圖 仿射（由 655 個記號 ICP 套準得到）
const T = [0.9789, 0, 0, 0.9800, 26.5, 14.4]
const CATS = (process.env.CATS || 'small,motor,access').split(',')
const seats = JSON.parse(fs.readFileSync('src/map/b1-classification.json', 'utf8')).seats
  .filter(x => CATS.includes(x.cat))

// 3x5 點陣數字，畫在記號右下，避免蓋住圖上的號碼
const FONT = {
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'], 3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '001', '001', '001'],
  8: ['111', '101', '111', '101', '111'], 9: ['111', '101', '111', '001', '111'],
}
function px(x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const i = (y * W + x) << 2
  img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b
}
function digits(text, ox, oy, sc, r, g, b) {
  let cx = ox
  for (const ch of text) {
    const rows = FONT[ch]; if (!rows) { cx += 2 * sc; continue }
    for (let ry = 0; ry < 5; ry++) for (let rx = 0; rx < 3; rx++) {
      if (rows[ry][rx] !== '1') continue
      for (let a = 0; a < sc; a++) for (let bq = 0; bq < sc; bq++) px(cx + rx * sc + a, oy + ry * sc + bq, r, g, b)
    }
    cx += 4 * sc
  }
}
let n = 0
for (const st of seats) {
  const x = useNew ? T[0] * st.x + T[2] * st.y + T[4] : st.x
  const y = useNew ? T[1] * st.x + T[3] * st.y + T[5] : st.y
  if (x < X0 || x > X1 || y < Y0 || y > Y1) continue
  const cx = Math.round(x * s) - bbox[0], cy = Math.round(y * s) - bbox[1]
  for (let d = -4; d <= 4; d++) { px(cx + d, cy, 230, 0, 0); px(cx, cy + d, 230, 0, 0) }
  digits(String(st.id), cx + 6, cy + 4, Math.max(1, Math.round(s / 6)), 200, 0, 0)
  n++
}
fs.writeFileSync(out, PNG.sync.write(img))
console.log(out, W + 'x' + H, ' 疊了', n, '格', useNew ? '(已做舊→新轉換)' : '(原座標)')
