// PDF → PNG（逐頁）。用途：LINE 群組不能傳檔／連結被擋時，改貼圖片。
// 用法：node scripts/pdf-to-png.mjs <pdf 路徑> [輸出資料夾] [縮放倍率，預設 2]
//   例：node scripts/pdf-to-png.mjs public/print/b1-map-a3.pdf public/print/png 2
import * as mupdf from 'mupdf'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

const [src, outDir = 'public/print/png', scaleArg = '2'] = process.argv.slice(2)
if (!src) {
  console.error('用法：node scripts/pdf-to-png.mjs <pdf> [輸出資料夾] [縮放倍率]')
  process.exit(1)
}

const scale = Number(scaleArg)
const doc = mupdf.Document.openDocument(readFileSync(src), 'application/pdf')
const total = doc.countPages()
const stem = basename(src, extname(src))
mkdirSync(outDir, { recursive: true })

for (let i = 0; i < total; i++) {
  const page = doc.loadPage(i)
  const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true)
  // 單頁不加頁碼，多頁補零方便排序（LINE 依檔名順序上傳）
  const name = total === 1 ? `${stem}.png` : `${stem}-${String(i + 1).padStart(2, '0')}.png`
  const out = join(outDir, name)
  writeFileSync(out, pix.asPNG())
  console.log(`  ${out}  ${pix.getWidth()}×${pix.getHeight()}`)
}
console.log(`✅ ${total} 頁 → ${outDir}（縮放 ${scale}×）`)
