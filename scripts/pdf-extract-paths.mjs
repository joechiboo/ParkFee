import * as mupdf from 'mupdf'
import fs from 'fs'

const doc = mupdf.Document.openDocument(fs.readFileSync(process.argv[2]), 'application/pdf')
const page = doc.loadPage(0)

const shapes = []
function apply(ctm, x, y) {
  return [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]
}
function record(path, ctm, kind) {
  let lines = 0, curves = 0, moves = 0, closes = 0
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9
  const pts = []
  const push = (x, y) => {
    const [a, b] = apply(ctm, x, y)
    if (a < minX) minX = a; if (a > maxX) maxX = a
    if (b < minY) minY = b; if (b > maxY) maxY = b
    pts.push(+a.toFixed(2), +b.toFixed(2))
  }
  try {
    path.walk({
      moveTo(x, y) { moves++; push(x, y) },
      lineTo(x, y) { lines++; push(x, y) },
      curveTo(x1, y1, x2, y2, x3, y3) { curves++; push(x1, y1); push(x2, y2); push(x3, y3) },
      closePath() { closes++ },
    })
  } catch (e) { return }
  if (maxX < minX) return
  shapes.push({ kind, moves, lines, curves, closes,
    x: +((minX + maxX) / 2).toFixed(2), y: +((minY + maxY) / 2).toFixed(2),
    w: +(maxX - minX).toFixed(2), h: +(maxY - minY).toFixed(2), pts })
}
const dev = new mupdf.Device({
  fillPath(path, evenOdd, ctm) { record(path, ctm, 'fill') },
  strokePath(path, stroke, ctm) { record(path, ctm, 'stroke') },
  clipPath() {}, clipStrokePath() {}, fillText() {}, strokeText() {}, clipText() {}, clipStrokeText() {},
  fillShade() {}, fillImage() {}, fillImageMask() {}, clipImageMask() {},
  popClip() {}, beginMask() {}, endMask() {}, beginGroup() {}, endGroup() {},
  beginTile() { return 0 }, endTile() {}, beginLayer() {}, endLayer() {},
  beginStructure() {}, endStructure() {}, beginMetatext() {}, endMetatext() {},
  renderFlags() {}, setDefaultColorSpaces() {}, close() {},
})
page.run(dev, mupdf.Matrix.identity)
dev.close()
console.error('shapes', shapes.length)
fs.writeFileSync(process.argv[3], JSON.stringify(shapes))
