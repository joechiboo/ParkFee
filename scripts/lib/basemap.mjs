// B1 底圖的唯一產生來源。
//
// 底圖以「竣工圖」為準：docs/A205_B1平面圖.pdf（新北市建照電子副本 107店建字第372號）。
// 舊版 docs/A2-5 地下一層平面圖.pdf 與現況有 90/655 個車位位置不同、編號歸屬也不同，
// 且完全沒有畫自行車位，已不再使用。兩個檔名都含「平面」，所以這裡寫死檔名，
// 不要再用 readdirSync 去猜，否則會抓回舊版。
//
// 底圖會處理三種東西：
//   1. 粉紅浮水印（新北市政府工務局）—— 不畫
//   2. 汽車位的色塊（黃/橘）—— 不畫（我們只處理機車與自行車）
//   3. 機車位／自行車位的黃框 —— 原樣保留
//
// ⚠️ 機車/自行車的黃框一定要留：
//   車位格子的黑框是髮絲線，底圖 4768px 在畫面上縮到 ~500px 顯示時會被平均掉、幾乎看不見。
//   圖之所以看得出一格一格，靠的是那條 ~8px 厚的黃色帶。把它拿掉 → 圖面等於空白、
//   點位漂在上面（踩過兩次）。
//
// ⚠️ 汽車位與機車位的黃色在向量層是同一個顏色，分不出來 → 改用尺寸判斷。
//   黃框不是封閉矩形，是圍成一圈的四條細長條；長邊長度直接反映車位尺寸，分佈是乾淨的雙峰：
//     10–30pt：機車 175×75／200×100、自行車 185×60（→ 24.8/28.3/26.2pt）  約 5,200 條
//     31–87pt：汽車 250×550／230×550／無障礙 350×600（→ 35/78/49.5/85pt）  約   620 條
//   故以 30.5pt 為界即可分開，不需比對座標。
//
// ⚠️ 為什麼是「向量層過濾」而不是「渲染後濾顏色」：
//   機車格的畫法是「黑框 ＋ 外圈粗黃帶」，黑框壓在黃帶上。渲染成點陣後，黑線抗鋸齒會與
//   黃色混成偏黃的中間色 → 用顏色門檻洗黃色，一定會把黑框一起吃掉（自行車格沒有黃帶所以
//   倖存，結果就是機車格線消失、自行車格線還在）。改成在 device 層跳過黃/橘色的 fill path，
//   黑色線稿是獨立的 stroke path，完全不受影響。
import { readFileSync, writeFileSync } from 'node:fs'
import * as mupdf from 'mupdf'

export const BASE_PDF = 'docs/A205_B1平面圖.pdf'
export const SCALE = 2 // 2384x1684 pt -> 4768x3368 px

// 圖面顏色（DeviceRGB，0–1）。數值取自實際圖檔；容差 0.06 足以區分、不誤傷。
const YELLOW = [0.97, 0.96, 0.25] // 法定停車位色塊（機車、自行車、汽車共用同一色）
// 黃框長邊 ≤ 此值＝機車/自行車位（保留）；> 此值＝汽車位（不畫）。見檔頭的長度分佈說明。
const SEAT_FRAME_MAX_PT = 30.5
const ORANGE = [0.98, 0.43, 0.02] // 自設停車位色塊（汽車）
const PINK = [1.0, 0.69, 0.69] // 工務局浮水印
const near = (color, c) => color?.length === 3 && c.every((v, i) => Math.abs(v - color[i]) < 0.06)
const isRGB = (cs) => cs?.getName?.() === 'DeviceRGB'

// 取路徑在 device 空間的 bbox
function pathBox(path, ctm) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const at = (x, y) => {
    const a = ctm[0] * x + ctm[2] * y + ctm[4]
    const b = ctm[1] * x + ctm[3] * y + ctm[5]
    if (a < x0) x0 = a; if (a > x1) x1 = a
    if (b < y0) y0 = b; if (b > y1) y1 = b
  }
  try {
    path.walk({
      moveTo: at, lineTo: at,
      curveTo: (a, b, c, d, e, f) => { at(a, b); at(c, d); at(e, f) },
      closePath() {},
    })
  } catch { return null }
  return x1 >= x0 ? [x0, y0, x1, y1] : null
}

/** 渲染底圖（過濾掉浮水印與建照色塊），回傳 {width, height} */
export function renderBaseMap(outPath) {
  const doc = mupdf.Document.openDocument(readFileSync(BASE_PDF), 'application/pdf')
  const page = doc.loadPage(0)
  const b = page.getBounds()
  const bbox = [b[0] * SCALE, b[1] * SCALE, b[2] * SCALE, b[3] * SCALE].map(Math.round)
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, bbox, false)
  pix.clear(255)
  const draw = new mupdf.DrawDevice(mupdf.Matrix.scale(SCALE, SCALE), pix)
  let keptYellow = 0, droppedYellow = 0

  // 這個 fill 該不該畫？黃色依尺寸決定（機車/自行車位保留、汽車位不畫），其餘依顏色。
  const dropFill = (path, ctm, cs, color) => {
    if (!isRGB(cs)) return false
    if (near(color, PINK) || near(color, ORANGE)) return true
    if (!near(color, YELLOW)) return false
    const box = pathBox(path, ctm)
    const long = box ? Math.max(box[2] - box[0], box[3] - box[1]) : Infinity
    if (long <= SEAT_FRAME_MAX_PT) { keptYellow++; return false }
    droppedYellow++
    return true
  }

  // 代理 device：其餘一律原樣轉發。
  const proxy = new mupdf.Device({
    fillPath: (path, evenOdd, ctm, cs, color, alpha) => {
      if (!dropFill(path, ctm, cs, color)) draw.fillPath(path, evenOdd, ctm, cs, color, alpha)
    },
    strokePath: (path, stroke, ctm, cs, color, alpha) => {
      if (!(isRGB(cs) && (near(color, PINK) || near(color, ORANGE))))
        draw.strokePath(path, stroke, ctm, cs, color, alpha)
    },
    fillText: (text, ctm, cs, color, alpha) => {
      if (!(isRGB(cs) && near(color, PINK))) draw.fillText(text, ctm, cs, color, alpha)
    },
    strokeText: (text, stroke, ctm, cs, color, alpha) => {
      if (!(isRGB(cs) && near(color, PINK))) draw.strokeText(text, stroke, ctm, cs, color, alpha)
    },
    clipPath: (path, evenOdd, ctm) => draw.clipPath(path, evenOdd, ctm),
    clipStrokePath: (path, stroke, ctm) => draw.clipStrokePath(path, stroke, ctm),
    clipText: (text, ctm) => draw.clipText(text, ctm),
    clipStrokeText: (text, stroke, ctm) => draw.clipStrokeText(text, stroke, ctm),
    ignoreText: (text, ctm) => draw.ignoreText(text, ctm),
    fillShade: (shade, ctm, alpha) => draw.fillShade(shade, ctm, alpha),
    fillImage: (image, ctm, alpha) => draw.fillImage(image, ctm, alpha),
    fillImageMask: (image, ctm, cs, color, alpha) => draw.fillImageMask(image, ctm, cs, color, alpha),
    clipImageMask: (image, ctm) => draw.clipImageMask(image, ctm),
    popClip: () => draw.popClip(),
    beginMask: (area, luminosity, cs, color) => draw.beginMask(area, luminosity, cs, color),
    endMask: () => draw.endMask(),
    beginGroup: (area, cs, isolated, knockout, blendmode, alpha) =>
      draw.beginGroup(area, cs, isolated, knockout, blendmode, alpha),
    endGroup: () => draw.endGroup(),
    beginTile: (area, view, xstep, ystep, ctm, id, docId) =>
      draw.beginTile(area, view, xstep, ystep, ctm, id, docId),
    endTile: () => draw.endTile(),
    beginLayer: (name) => draw.beginLayer(name),
    endLayer: () => draw.endLayer(),
    beginStructure: () => {},
    endStructure: () => {},
    beginMetatext: () => {},
    endMetatext: () => {},
    renderFlags: () => {},
    setDefaultColorSpaces: () => {},
    close: () => {},
  })
  page.run(proxy, mupdf.Matrix.identity)
  proxy.close()
  draw.close()
  writeFileSync(outPath, Buffer.from(pix.asPNG()))
  return { width: pix.getWidth(), height: pix.getHeight(), keptYellow, droppedYellow }
}
