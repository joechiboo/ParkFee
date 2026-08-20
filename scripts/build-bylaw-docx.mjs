// 產生管理辦法的 Word 檔（.docx），供日後直接編輯維護。
//
// 來源：docs/19-辦法修訂草案-標紅版.html —— 那份已是整份辦法（壹～玖＋附件一～四）的
// 結構化全文，且異動處以 <ins>/<del> 標記，因此同一份來源可導出兩個版本：
//   現行版：保留 <del> 的字、丟掉 <ins>          → public/forms/管理辦法-現行版.docx
//   修訂版：保留 <ins> 的字、丟掉 <del>          → public/forms/管理辦法-修訂版.docx
// 條文若有更動，改 docs/19（與 docs/05）後重跑本腳本即可，Word 不會與條文漂移。
//
// 排版對齊正式公告版 PDF（docs/社區地下室停車場管理辦法.pdf）：A4、標楷體、
// 標題置中、沿革右對齊（第二筆紅字）、章名粗體、條文與款次階層縮排、頁碼置中。
// ⚠️ 正式版 PDF 的附件有裝飾用外框線，Word 需以節(section)層級設定、成本高且不影響
//    內容，故未重現；如需要請在 Word 中一次加上即可。
//
// 用法：node scripts/build-bylaw-docx.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import {
  Document, Packer, Paragraph, TextRun, AlignmentType, PageNumber, Footer, PageBreak,
} from 'docx'

const SRC = 'docs/19-辦法修訂草案-標紅版.html'
const OUT_DIR = 'public/forms'
const FONT = { ascii: 'DFKai-SB', eastAsia: '標楷體' } // 標楷體；ascii 名稱供非中文字元對應

// ---------- 解析來源 HTML ----------
const html = readFileSync(SRC, 'utf8')
const body = html.slice(html.indexOf('<h2>壹、依據</h2>'), html.lastIndexOf('</body>'))

const decode = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')

// 把一段 inline HTML 轉成 docx 的 TextRun[]；variant 決定 ins/del 取捨。
function runs(inner, variant, base = {}) {
  const out = []
  const re = /<(ins|del|b|span)(?:\s+class="([^"]*)")?>([\s\S]*?)<\/\1>/g
  let last = 0, m
  const plain = (t, extra = {}) => {
    const text = decode(t.replace(/<[^>]+>/g, ''))
    if (text) out.push(new TextRun({ text, font: FONT, size: 24, ...base, ...extra }))
  }
  while ((m = re.exec(inner))) {
    plain(inner.slice(last, m.index))
    const [, tag, cls, content] = m
    if (tag === 'ins') { if (variant === 'draft') out.push(...runs(content, variant, base)) }
    else if (tag === 'del') { if (variant === 'current') out.push(...runs(content, variant, base)) }
    else if (tag === 'b') out.push(...runs(content, variant, { ...base, bold: true }))
    else if (cls === 'blank') plain(content, { underline: {} })
    else out.push(...runs(content, variant, base))
    last = re.lastIndex
  }
  plain(inner.slice(last))
  return out
}

// ---------- 版面樣式 ----------
const P = (children, opts = {}) =>
  new Paragraph({ spacing: { line: 320, before: 0, after: 40 }, ...opts, children })

const clause = (inner, variant) => // 條：一、二、…（懸掛縮排，數字凸出）
  P(runs(inner, variant), { indent: { left: 640, hanging: 640 } })
const sub = (inner, variant) => // 款：（一）（二）…
  P(runs(inner, variant), { indent: { left: 1280, hanging: 640 } })
const chapter = (text) => // 章：壹、貳、…
  new Paragraph({
    spacing: { before: 260, after: 100 },
    children: [new TextRun({ text, font: FONT, size: 28, bold: true })],
  })

// ---------- 組裝內容 ----------
function buildBody(variant) {
  const blocks = []
  const re = /<(h2|p)(?:\s+class="([^"]*)")?>([\s\S]*?)<\/\1>/g
  let m
  while ((m = re.exec(body))) {
    const [, tag, cls = '', inner] = m
    if (cls.includes('note')) continue // 說明／欄位註記：草擬用，不入正式文件
    if (tag === 'h2') {
      const text = decode(inner.replace(/<span class="tag">[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, '')).trim()
      const isAttachment = text.startsWith('【附件')
      if (isAttachment) {
        blocks.push(new Paragraph({ children: [new PageBreak()] }))
        blocks.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({ text, font: FONT, size: 32, bold: true })],
        }))
      } else blocks.push(chapter(text))
      continue
    }
    blocks.push(cls.includes('sub') ? sub(inner, variant) : clause(inner, variant))
  }
  return blocks
}

// 沿革（取自 docs/05 的訂定／修訂清單）；正式版 PDF 中第二筆為紅字。
const history = readFileSync('docs/05-停車場管理辦法.md', 'utf8')
  .split(/\r?\n/)
  .filter((l) => /^> - 中華民國/.test(l))
  .map((l) => l.replace(/^> - /, '').trim())

function head(variant) {
  const out = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: '樂菲莊園　社區地下室停車場管理辦法', font: FONT, size: 36, bold: true })],
    }),
  ]
  history.forEach((h, i) =>
    out.push(new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: i === history.length - 1 ? 240 : 40 },
      children: [new TextRun({ text: h, font: FONT, size: 24, color: i > 0 ? 'C00000' : '000000' })],
    })))
  if (variant === 'draft')
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: '（修訂草案　尚未經管委會例會表決，不具效力）', font: FONT, size: 24, bold: true, color: 'C00000' })],
    }))
  return out
}

function makeDoc(variant) {
  return new Document({
    styles: { default: { document: { run: { font: FONT, size: 24 } } } },
    sections: [{
      properties: { page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } }, // 2cm
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 20 })],
          })],
        }),
      },
      children: [...head(variant), ...buildBody(variant)],
    }],
  })
}

mkdirSync(OUT_DIR, { recursive: true })
for (const [variant, name] of [['current', '管理辦法-現行版.docx'], ['draft', '管理辦法-修訂版.docx']]) {
  const buf = await Packer.toBuffer(makeDoc(variant))
  writeFileSync(`${OUT_DIR}/${name}`, buf)
  console.log(`已寫入 ${OUT_DIR}/${name}　${(buf.length / 1024).toFixed(0)} KB`)
}
