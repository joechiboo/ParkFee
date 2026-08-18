// 管理辦法網頁版：把 docs/05（現行辦法全文）與 docs/19（修訂草案對照表）轉成 HTML，
// 供 /bylaw 頁籤直接渲染；另把「全文標紅版」複製到 public/ 供另開列印。
//
// 用法：node scripts/build-bylaw.mjs（npm run build 會自動先跑，線上版不會落後 docs）
// 改條文請改 docs/05、docs/19 —— 那兩份才是來源，src/data/bylaw-content.js 是產生物、勿手改。
//
// docs 內部工作註記（待確認事項、待補清單）用 <!-- web:skip-start --> / <!-- web:skip-end -->
// 標起來就不會出現在住戶看的網頁上。指向其他 .md 的連結會自動降級為純文字（那些檔沒上線）。
import { readFileSync, writeFileSync, copyFileSync, statSync } from 'node:fs'

const SKIP_START = '<!-- web:skip-start -->'
const SKIP_END = '<!-- web:skip-end -->'

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// 行內語法：粗體、行內碼、連結、表格內換行。
function inline(src) {
  let t = escapeHtml(src)
  t = t.replace(/&lt;br&gt;/g, '<br>') // 表格儲存格內換行（docs 直接寫 <br>）
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>')
  t = t.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // 內部文件連結 → 純文字
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  return t
}

const cells = (row) =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())

const isListLine = (l) => /^\s*([-*]|\d+\.)\s+/.test(l)
const indentOf = (l) => l.match(/^\s*/)[0].length

// 清單（支援巢狀一層以上；- [ ] 待辦框轉成 ☐／☑）
function renderList(lines, start) {
  const base = indentOf(lines[start])
  const ordered = /^\s*\d+\.\s/.test(lines[start])
  const items = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim() || !isListLine(line) || indentOf(line) < base) break
    if (indentOf(line) > base) {
      const [sub, next] = renderList(lines, i)
      if (items.length) items[items.length - 1] += sub
      else items.push(sub)
      i = next
      continue
    }
    const text = line
      .replace(/^\s*([-*]|\d+\.)\s+/, '')
      .replace(/^\[( |x|X)\]\s*/, (_, c) => (c === ' ' ? '☐ ' : '☑ '))
    items.push(`<li>${inline(text)}`)
    i++
  }
  const tag = ordered ? 'ol' : 'ul'
  return [`<${tag}>${items.map((s) => `${s}</li>`).join('')}</${tag}>`, i]
}

function render(lines) {
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      const lv = heading[1].length
      out.push(`<h${lv}>${inline(heading[2])}</h${lv}>`)
      i++
      continue
    }

    if (/^---+$/.test(line.trim())) {
      out.push('<hr>')
      i++
      continue
    }

    if (line.startsWith('>')) {
      const buf = []
      while (i < lines.length && lines[i].startsWith('>')) {
        buf.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      out.push(`<blockquote>${render(buf)}</blockquote>`)
      continue
    }

    // 表格：標頭列 + |---|---| 分隔列
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|[\s|:-]+\|\s*$/.test(lines[i + 1])) {
      const head = cells(line)
      i += 2
      const rows = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(cells(lines[i]))
        i++
      }
      const th = head.map((c) => `<th>${inline(c)}</th>`).join('')
      const tb = rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')
      out.push(`<div class="tbl"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`)
      continue
    }

    if (isListLine(line)) {
      const [html, next] = renderList(lines, i)
      out.push(html)
      i = next
      continue
    }

    // 段落：連續數行併一段（中文換行不補空白）
    const buf = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4}\s|>|\|)/.test(lines[i]) &&
      !isListLine(lines[i]) &&
      !/^---+$/.test(lines[i].trim())
    ) {
      buf.push(lines[i].trim())
      i++
    }
    if (!buf.length) {
      // 落單的表格列等：原樣當一段輸出，避免空轉
      buf.push(lines[i].trim())
      i++
    }
    out.push(`<p>${inline(buf.join(''))}</p>`)
  }
  return out.join('\n')
}

function convert(path) {
  const raw = readFileSync(path, 'utf8')
  const all = raw.split(/\r?\n/)
  const lines = []
  let skipping = false
  for (const line of all) {
    if (line.trim() === SKIP_START) {
      skipping = true
      continue
    }
    if (line.trim() === SKIP_END) {
      skipping = false
      continue
    }
    if (skipping) continue
    lines.push(line)
  }
  // 首個 h1 當標題，不進內文
  const titleAt = lines.findIndex((l) => /^#\s+/.test(l))
  const title = titleAt >= 0 ? lines[titleAt].replace(/^#\s+/, '').trim() : ''
  if (titleAt >= 0) lines.splice(titleAt, 1)

  return {
    title,
    // 開頭若因為濾掉註記而只剩一條分隔線，去掉它
    html: render(lines).replace(/^<hr>\n/, ''),
    // 沿革從原文（未過濾）撈，維持顯示在頁首
    revisions: [...raw.matchAll(/^>\s*-\s*(中華民國.*)$/gm)].map((m) => m[1].trim()),
    updatedAt: statSync(path).mtime.toISOString().slice(0, 10),
  }
}

// 反引號模板字面值需跳脫，內容才不會炸掉產生的 js
const js = (s) => `\`${s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\``

const current = convert('docs/05-停車場管理辦法.md')
const draft = convert('docs/19-辦法修訂草案.md')

copyFileSync('docs/19-辦法修訂草案-標紅版.html', 'public/bylaw-redline.html')

const outPath = 'src/data/bylaw-content.js'
writeFileSync(
  outPath,
  `// ⚠️ 本檔由 scripts/build-bylaw.mjs 產生，請勿手改。
// 條文來源：docs/05-停車場管理辦法.md（現行）、docs/19-辦法修訂草案.md（草案）。
// 改完 docs 後跑 npm run build:bylaw 重生（npm run build 也會自動先跑）。
export const bylawCurrent = {
  title: ${JSON.stringify(current.title)},
  revisions: ${JSON.stringify(current.revisions)},
  updatedAt: ${JSON.stringify(current.updatedAt)},
  html: ${js(current.html)},
}

export const bylawDraft = {
  title: ${JSON.stringify(draft.title)},
  updatedAt: ${JSON.stringify(draft.updatedAt)},
  html: ${js(draft.html)},
}
`,
  'utf8',
)

console.log(`✅ ${outPath}`)
console.log(`   現行辦法 ${current.html.length} 字元（更新 ${current.updatedAt}，沿革 ${current.revisions.length} 筆）`)
console.log(`   修訂草案 ${draft.html.length} 字元（更新 ${draft.updatedAt}）`)
console.log('✅ public/bylaw-redline.html（全文標紅版，另開列印用）')