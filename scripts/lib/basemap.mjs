// B1 底圖的唯一產生來源。
//
// 底圖以「竣工圖」為準：docs/A205_B1平面圖.pdf（新北市建照電子副本 107店建字第372號）。
// 舊版 docs/A2-5 地下一層平面圖.pdf 與現況有 90/655 個車位位置不同、編號歸屬也不同，
// 且完全沒有畫自行車位，已不再使用。兩個檔名都含「平面」，所以這裡寫死檔名，
// 不要再用 readdirSync 去猜，否則會抓回舊版。
//
// 底圖會拿掉兩種東西：
//   1. 粉紅浮水印（新北市政府工務局）—— 蓋住圖面
//   2. 建照的停車位色塊（黃＝法定車位、橘＝自設車位）—— 那是建照審查標示，住戶不需要，
//      滿版色塊也會蓋過我們自己的機車/自行車配色
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

// 要濾掉的顏色（DeviceRGB，0–1）。數值取自實際圖檔；容差 0.06 足以區分且不誤傷其他顏色。
const DROP_RGB = [
  [0.97, 0.96, 0.25], // 黃：法定停車位色塊
  [0.98, 0.43, 0.02], // 橘：自設停車位色塊
  [1.0, 0.69, 0.69], // 粉紅：工務局浮水印文字
]
function shouldDrop(colorspace, color) {
  if (!color || color.length !== 3) return false
  if (colorspace?.getName?.() !== 'DeviceRGB') return false
  return DROP_RGB.some((c) => c.every((v, i) => Math.abs(v - color[i]) < 0.06))
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

  // 代理 device：其餘一律原樣轉發，只有指定顏色的 fill/text 不畫。
  const proxy = new mupdf.Device({
    fillPath: (path, evenOdd, ctm, cs, color, alpha) => {
      if (!shouldDrop(cs, color)) draw.fillPath(path, evenOdd, ctm, cs, color, alpha)
    },
    strokePath: (path, stroke, ctm, cs, color, alpha) => {
      if (!shouldDrop(cs, color)) draw.strokePath(path, stroke, ctm, cs, color, alpha)
    },
    fillText: (text, ctm, cs, color, alpha) => {
      if (!shouldDrop(cs, color)) draw.fillText(text, ctm, cs, color, alpha)
    },
    strokeText: (text, stroke, ctm, cs, color, alpha) => {
      if (!shouldDrop(cs, color)) draw.strokeText(text, stroke, ctm, cs, color, alpha)
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
  return { width: pix.getWidth(), height: pix.getHeight() }
}
