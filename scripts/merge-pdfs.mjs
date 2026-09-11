// 合併 PDF（公告用：會議紀錄本文 + 各附件）。
//
// 用法：node scripts/merge-pdfs.mjs <輸出.pdf> <來源.pdf[:頁範圍]> ...
//   頁範圍可寫 1-9、3、1-2,5（省略＝整份）。頁碼為 1 起算。
//
// 例：會議紀錄合併版——取原版前 9 頁（經理的紀錄本文），後面換成蓋好附件標籤的三份
//   node scripts/merge-pdfs.mjs 合併版v1.1.pdf "v1.0.pdf:1-9" 附件二.pdf 附件三.pdf 附件四.pdf
import { readFileSync, writeFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'

const [out, ...srcs] = process.argv.slice(2)
if (!out || !srcs.length) {
  console.error('用法：node scripts/merge-pdfs.mjs <輸出.pdf> <來源.pdf[:頁範圍]> ...')
  process.exit(1)
}

// 「1-9,12」→ [0,1,…,8,11]（回傳 0 起算的索引）
function parseRange(spec, total) {
  if (!spec) return [...Array(total).keys()]
  const idx = []
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map((n) => parseInt(n, 10))
    for (let i = a; i <= (b ?? a); i++) idx.push(i - 1)
  }
  return idx.filter((i) => i >= 0 && i < total)
}

const merged = await PDFDocument.create()
for (const src of srcs) {
  // 只把「最後一個冒號後面是頁範圍」當範圍，避免吃掉 Windows 磁碟代號（D:\…）
  const m = src.match(/^(.*?)(?::([\d,\-]+))?$/)
  const [file, spec] = [m[1], m[2]]
  const doc = await PDFDocument.load(readFileSync(file))
  const idx = parseRange(spec, doc.getPageCount())
  const pages = await merged.copyPages(doc, idx)
  pages.forEach((p) => merged.addPage(p))
  console.log(`   + ${file}${spec ? ` [${spec}]` : ''} — ${idx.length} 頁`)
}

writeFileSync(out, await merged.save())
console.log(`✅ ${out}（共 ${merged.getPageCount()} 頁）`)
