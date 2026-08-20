// B1 底圖的唯一產生來源。
//
// 底圖以「竣工圖」為準：docs/A205_B1平面圖.pdf（新北市建照電子副本 107店建字第372號）。
// 舊版 docs/A2-5 地下一層平面圖.pdf 與現況有 90/655 個車位位置不同、編號歸屬也不同，
// 且完全沒有畫自行車位，已不再使用。兩個檔名都含「平面」，所以這裡寫死檔名，
// 不要再用 readdirSync 去猜，否則會抓回舊版。
//
// 底圖會處理兩種東西：
//   1. 粉紅浮水印（新北市政府工務局）—— 直接不畫
//   2. 建照的停車位色塊（黃＝法定車位、橘＝自設車位）—— 改畫成淺灰
//
// ⚠️ 為什麼是「改成淺灰」而不是「整個不畫」：
//   車位格子的黑框是髮絲線，底圖 4768px 在畫面上縮到 ~500px 顯示時會被平均掉、幾乎看不見。
//   原本之所以看得出格子，靠的是那條 ~8px 厚的黃色帶。整個拿掉 → 圖面等於空白，
//   點位漂在上面。改成中性淺灰即可保留塊體感，又不會跟我們自己的機車/自行車配色搶。
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

// 圖面顏色（DeviceRGB，0–1）→ 處理方式。數值取自實際圖檔；容差 0.06 足以區分、不誤傷。
//   null = 不畫；數字 = 改用該灰階值畫（DeviceGray）
const RECOLOR = [
  [[0.97, 0.96, 0.25], 0.9], // 黃：法定停車位 → 淺灰
  [[0.98, 0.43, 0.02], 0.82], // 橘：自設停車位 → 稍深的灰（仍可區分）
  [[1.0, 0.69, 0.69], null], // 粉紅：工務局浮水印 → 不畫
]
// 回傳 undefined＝原樣畫、null＝不畫、數字＝改成該灰階
function recolorOf(colorspace, color) {
  if (!color || color.length !== 3) return undefined
  if (colorspace?.getName?.() !== 'DeviceRGB') return undefined
  const hit = RECOLOR.find(([c]) => c.every((v, i) => Math.abs(v - color[i]) < 0.06))
  return hit ? hit[1] : undefined
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
  const GRAY = mupdf.ColorSpace.DeviceGray

  // 代理 device：其餘一律原樣轉發，只有指定顏色的 fill/text 不畫。
  const proxy = new mupdf.Device({
    fillPath: (path, evenOdd, ctm, cs, color, alpha) => {
      const g = recolorOf(cs, color)
      if (g === null) return
      if (g === undefined) draw.fillPath(path, evenOdd, ctm, cs, color, alpha)
      else draw.fillPath(path, evenOdd, ctm, GRAY, [g], alpha)
    },
    strokePath: (path, stroke, ctm, cs, color, alpha) => {
      const g = recolorOf(cs, color)
      if (g === null) return
      if (g === undefined) draw.strokePath(path, stroke, ctm, cs, color, alpha)
      else draw.strokePath(path, stroke, ctm, GRAY, [g], alpha)
    },
    fillText: (text, ctm, cs, color, alpha) => {
      const g = recolorOf(cs, color)
      if (g === null) return
      if (g === undefined) draw.fillText(text, ctm, cs, color, alpha)
      else draw.fillText(text, ctm, GRAY, [g], alpha)
    },
    strokeText: (text, stroke, ctm, cs, color, alpha) => {
      const g = recolorOf(cs, color)
      if (g === null) return
      if (g === undefined) draw.strokeText(text, stroke, ctm, cs, color, alpha)
      else draw.strokeText(text, stroke, GRAY, [g], alpha)
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
