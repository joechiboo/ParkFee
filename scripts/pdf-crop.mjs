import * as mupdf from 'mupdf'
import fs from 'fs'
// usage: node tmp-pdfpng.mjs <pdf> <out.png> <scale> [x0 y0 x1 y1]
const [, , src, out, scaleStr, ...rect] = process.argv
const s = Number(scaleStr || 1)
const doc = mupdf.Document.openDocument(fs.readFileSync(src), 'application/pdf')
const page = doc.loadPage(0)
let pix
if (rect.length === 4) {
  const [x0, y0, x1, y1] = rect.map(Number)
  const bbox = [Math.round(x0 * s), Math.round(y0 * s), Math.round(x1 * s), Math.round(y1 * s)]
  pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, bbox, false)
  pix.clear(255)
  const dev = new mupdf.DrawDevice(mupdf.Matrix.scale(s, s), pix)
  page.run(dev, mupdf.Matrix.identity)
  dev.close()
} else {
  pix = page.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceRGB, false, true)
}
fs.writeFileSync(out, pix.asPNG())
console.log(out, pix.getWidth() + 'x' + pix.getHeight())