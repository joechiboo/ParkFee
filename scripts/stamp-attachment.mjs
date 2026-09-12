// 在 PDF 第一頁左上角蓋「議題六　附件N」字樣 —— 例會會議紀錄合併成公告文件時，
// 讀者翻到某頁才知道自己在看哪一份附件，故各附件首頁需自帶標示。
//
// ⚠️ 一定要帶「議題六」前綴：管理辦法本身就有【附件一】～【附件四】（承諾書、自行車
//    承諾書、e-Tag 申請書、違規勸導單），且都在標紅版裡一起公告 → 不加前綴會出現
//    兩個「附件四」（辦法的違規勸導單 vs 議題六的車位配置圖），還是相鄰兩頁。
//
// 用法：node scripts/stamp-attachment.mjs              → 蓋預設清單（附件一～三）
//       node scripts/stamp-attachment.mjs <pdf> <標籤>  → 蓋指定檔案
//       加 --force → 蓋過的也重蓋（先用白底蓋掉舊標籤；標籤位置在頁緣空白處，覆蓋安全）
//
// ⚠️ 附件四（B1 車位配置圖 A3）不在此處：該圖左上角本來就是標題列，
//    改由 print-map-a3.mjs --label「附件四」把標籤併進標題，版面才不會疊字。
// ⚠️ 重新產生 PDF（build-docs-pdf.mjs）後標籤會消失 → 要再跑一次本腳本。
import { readFileSync, writeFileSync } from 'node:fs'
import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'

const FONT = 'C:/Windows/Fonts/kaiu.ttf' // 標楷體：公告文件慣用
const SIZE = 15
const X = 36 // 距左緣（pt）
const TOP = 26 // 距上緣（pt）——四份的首行內容都在 y≥44，不會疊到

// 2026-09-03 例會議題六決議所列之附件。附件四見檔頭說明。
const DEFAULTS = [
  ['docs/pdf/20-例會提案單-A4.pdf', '議題六　附件一'], // 由 docs/20-例會提案單-A4.html 重生
  ['docs/pdf/01-車位使用實施細則_20260908.pdf', '議題六　附件二'],
  ['docs/pdf/19-辦法修訂草案-標紅版_20260908.pdf', '議題六　附件三'],
]

const MARK = 'attachment-label' // 蓋過章的記號，避免重跑疊印

const FORCE = process.argv.includes('--force')

async function stamp(file, label) {
  const pdf = await PDFDocument.load(readFileSync(file))
  const keywords = pdf.getKeywords() || ''
  const stamped = keywords.includes(MARK)
  const prevLabel = keywords.match(new RegExp(`${MARK}:(.*)`))?.[1]?.trim() || ''
  if (stamped && !FORCE) {
    console.log(`↷ ${file} 已有標籤，略過（要改字加 --force）`)
    return
  }
  pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(readFileSync(FONT), { subset: true })
  const page = pdf.getPages()[0]
  const { height } = page.getSize()
  if (stamped) {
    // 舊標籤蓋白。寬度必須量舊標籤本身——早期寫死 220pt，把提案單置中的大標題
    // 「管委會例會提案」整段洗成白色（標籤只到 ~105pt，標題從 ~170pt 開始），
    // 合併版 v1.1 就是這樣出去的。要重蓋只清掉舊字佔的範圍。
    page.drawRectangle({
      x: X - 4,
      y: height - TOP - SIZE - 4,
      width: font.widthOfTextAtSize(prevLabel || label, SIZE) + 8,
      height: SIZE + 10,
      color: rgb(1, 1, 1),
    })
  }
  page.drawText(label, {
    x: X,
    y: height - TOP - SIZE,
    size: SIZE,
    font,
    color: rgb(0.1, 0.11, 0.13),
  })
  pdf.setKeywords([`${MARK}:${label}`])
  writeFileSync(file, await pdf.save())
  console.log(`✅ ${file} ← ${label}`)
}

const [argFile, argLabel] = process.argv.slice(2)
const jobs = argFile && argLabel ? [[argFile, argLabel]] : DEFAULTS
for (const [f, l] of jobs) await stamp(f, l)
