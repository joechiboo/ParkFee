// 從竣工圖 (docs/A205_B1平面圖.pdf) 產生 public/demo/b1.png 底圖，並去除粉紅浮水印。
// 舊底圖描自 docs/A2-5 地下一層平面圖.pdf，該版與現況有 90/655 個車位位置不符，故改用竣工圖。
// 用法: node scripts/rebuild-basemap.mjs
import * as mupdf from 'mupdf'
import fs from 'fs'
import { PNG } from 'pngjs'

const SRC = 'docs/A205_B1平面圖.pdf'
const OUT = 'public/demo/b1.png'
const S = 2 // 2384x1684 pt -> 4768x3368 px，與舊底圖同尺寸，demo 的 viewBox 不用改

const doc = mupdf.Document.openDocument(fs.readFileSync(SRC), 'application/pdf')
const page = doc.loadPage(0)
const pix = page.toPixmap(mupdf.Matrix.scale(S, S), mupdf.ColorSpace.DeviceRGB, false, true)
const img = PNG.sync.read(Buffer.from(pix.asPNG()))
const { width: W, height: H, data } = img

// 粉紅浮水印（新北市政府工務局斜體字）: r≈240-255, g=b≈176-191
// 與圖面其他顏色可區分 —— 橘色 g-b≈140、紅線 g<120、黃色 g-b≈255、灰階 r-g≈0
let wiped = 0
for (let k = 0; k < W * H; k++) {
  const i = k << 2
  const r = data[i], g = data[i + 1], b = data[i + 2]
  if (r > 200 && r - g > 20 && g > 120 && Math.abs(g - b) < 30) {
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255
    wiped++
  }
}
fs.writeFileSync(OUT, PNG.sync.write(img))
console.log(`已寫入 ${OUT}  ${W}x${H}  去除浮水印像素 ${wiped.toLocaleString()}`)
