// 把 docs 內的 Markdown／HTML 文件轉成 PDF（給主委、經理看的版本）。
// Markdown 用內建的極簡轉換（標題／表格／清單／引用／粗體），再交給本機 Edge 無頭模式列印。
//
// 用法：node scripts/build-docs-pdf.mjs                → 預設三份（會議紀錄、實施細則、標紅版）
//       node scripts/build-docs-pdf.mjs docs/xxx.md … → 指定檔案
// 輸出：docs/pdf/<原檔名>.pdf
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const OUT_DIR = 'docs/pdf'
const DEFAULT = ['docs/會議紀錄.md', 'docs/01-車位使用實施細則.md', 'docs/19-辦法修訂草案-標紅版.html']

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const inline = (s) =>
  esc(s)
    .replace(/&lt;br&gt;/g, '<br>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\*(.+)\*$/, '<em>$1</em>')

function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out = []
  let i = 0
  const para = []
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`)
    para.length = 0
  }
  while (i < lines.length) {
    const l = lines[i]
    if (!l.trim()) { flush(); i++; continue }
    if (/^---+$/.test(l.trim())) { flush(); out.push('<hr>'); i++; continue }
    const h = l.match(/^(#{1,4})\s+(.*)$/)
    if (h) { flush(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue }
    if (l.startsWith('|')) {
      flush()
      const rows = []
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++])
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()))
      const [head, , ...body] = rows
      out.push('<table><thead><tr>' + cells(head).map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + cells(r).map((c) => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody></table>')
      continue
    }
    if (l.startsWith('>')) {
      flush()
      const q = []
      while (i < lines.length && lines[i].startsWith('>')) q.push(lines[i++].replace(/^>\s?/, ''))
      out.push(`<blockquote>${mdToHtml(q.join('\n'))}</blockquote>`)
      continue
    }
    const li = l.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/)
    if (li) {
      flush()
      const ordered = /\d/.test(li[2])
      const items = []
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/)
        if (!m) break
        items.push(inline(m[3])); i++
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((x) => `<li>${x}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`)
      continue
    }
    para.push(l); i++
  }
  flush()
  return out.join('\n')
}

const CSS = `
@page { size: A4; margin: 18mm 16mm; }
body { font-family: "Microsoft JhengHei", "PingFang TC", sans-serif; font-size: 11pt; line-height: 1.6; color: #111; }
h1 { font-size: 18pt; border-bottom: 2px solid #333; padding-bottom: 4px; margin: 0 0 12px; }
h2 { font-size: 14pt; margin: 18px 0 6px; border-left: 4px solid #555; padding-left: 8px; page-break-after: avoid; }
h3 { font-size: 12pt; margin: 14px 0 4px; page-break-after: avoid; }
h4 { font-size: 11pt; margin: 10px 0 4px; }
p { margin: 4px 0; }
table { border-collapse: collapse; width: 100%; margin: 6px 0 10px; font-size: 10pt; page-break-inside: avoid; }
th, td { border: 1px solid #999; padding: 4px 6px; vertical-align: top; text-align: left; }
th { background: #eee; }
blockquote { margin: 6px 0; padding: 4px 10px; border-left: 3px solid #bbb; color: #444; background: #f7f7f7; }
ul, ol { margin: 4px 0 6px; padding-left: 22px; }
li { margin: 2px 0; }
code { font-family: Consolas, monospace; font-size: 10pt; background: #f0f0f0; padding: 0 3px; }
hr { border: 0; border-top: 1px solid #ccc; margin: 14px 0; }
s { color: #888; }
em { color: #555; font-size: 10pt; }
`

mkdirSync(OUT_DIR, { recursive: true })
const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT
for (const f of files) {
  const name = basename(f, extname(f))
  const pdf = resolve(OUT_DIR, `${name}.pdf`)
  let src = resolve(f)
  let tmp = null
  if (extname(f) === '.md') {
    const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${esc(name)}</title><style>${CSS}</style></head><body>${mdToHtml(readFileSync(f, 'utf8'))}</body></html>`
    tmp = resolve(OUT_DIR, `.${name}.tmp.html`)
    writeFileSync(tmp, html)
    src = tmp
  }
  execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
    `--print-to-pdf=${pdf}`, 'file:///' + src.replace(/\\/g, '/'),
  ], { stdio: 'ignore', timeout: 60000 })
  if (tmp && existsSync(tmp)) rmSync(tmp)
  console.log('✅', pdf)
}
