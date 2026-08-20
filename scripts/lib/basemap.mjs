// B1 底圖的唯一產生來源。
//
// 底圖以「竣工圖」為準：docs/A205_B1平面圖.pdf（新北市建照電子副本 107店建字第372號）。
// 舊版 docs/A2-5 地下一層平面圖.pdf 與現況有 90/655 個車位位置不同、編號歸屬也不同，
// 且完全沒有畫自行車位，已不再使用。兩個檔名都含「平面」，所以這裡寫死檔名，
// 不要再用 readdirSync 去猜，否則會抓回舊版。
import { readFileSync, writeFileSync } from 'node:fs'
import * as mupdf from 'mupdf'
import { PNG } from 'pngjs'

export const BASE_PDF = 'docs/A205_B1平面圖.pdf'
export const SCALE = 2 // 2384x1684 pt -> 4768x3368 px

/** 渲染底圖並去除粉紅浮水印，回傳 {width, height, wiped} */
export function renderBaseMap(outPath) {
  const doc = mupdf.Document.openDocument(readFileSync(BASE_PDF), 'application/pdf')
  const pix = doc.loadPage(0).toPixmap(mupdf.Matrix.scale(SCALE, SCALE), mupdf.ColorSpace.DeviceRGB, false, true)
  const img = PNG.sync.read(Buffer.from(pix.asPNG()))
  const { width, height, data } = img
  // 粉紅浮水印（新北市政府工務局斜體字）: r≈240-255, g=b≈176-191
  // 與圖面其他顏色可區分 —— 橘色 g-b≈140、紅線 g<120、黃色 g-b≈255、灰階 r-g≈0
  // 建照的停車位色塊（黃＝法定車位、橘＝自設車位）淡化掉：那是建照審查用的標示，
  // 住戶不需要，滿版色塊會蓋過我們自己的機車/自行車配色。
  // ⚠️ 門檻不能再往下調 —— 車位格線本身就是黃色畫的，抓太寬會把格線一起洗掉，
  //    只剩號碼漂在空中。目前這組會拿掉汽車位的斜紋色塊、保留格線。
  let wiped = 0
  for (let k = 0; k < width * height; k++) {
    const i = k << 2
    const r = data[i], g = data[i + 1], b = data[i + 2]
    // 門檻要涵蓋抗鋸齒後偏向白色的淡色邊緣，否則會留下殘影
    const pink = r > 190 && r - g > 15 && g > 110 && Math.abs(g - b) < 35
    const yellow = r > 175 && g > 165 && r - b > 25 && Math.abs(r - g) < 50
    const orange = r > 175 && r - g > 25 && g - b > 15
    if (pink || yellow || orange) {
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255
      wiped++
    }
  }
  writeFileSync(outPath, PNG.sync.write(img))
  return { width, height, wiped }
}
