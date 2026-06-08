// 探查 B1 PDF 的 Square 標註：抽出每個的 Rect 尺寸、顏色(/C 邊框、/IC 填色)、Contents 文字，
// 看「框尺寸／顏色」能不能區分 汽車位 / 機車位 / 自行車位 / 尺寸標註。
import { readFileSync, readdirSync } from 'node:fs'

const dir = 'docs'
const name = readdirSync(dir).find((f) => f.includes('A2-5') || f.includes('平面'))
const data = readFileSync(`${dir}/${name}`)
const raw = data.toString('latin1')

const decode = (s) => {
  if (!s) return ''
  if (s.startsWith('<')) {
    let hex = s.slice(1, -1)
    if (hex.toLowerCase().startsWith('feff')) hex = hex.slice(4)
    let o = ''
    for (let i = 0; i + 3 < hex.length + 1; i += 4) o += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16))
    return o
  }
  return s.slice(1, -1)
}

// 抓每個 Square 標註整段（到下一個 endobj 或下一個 /Subtype），再從裡面分別取欄位
const annRe = /\/Subtype\s*\/Square\b([\s\S]*?)(?=\/Subtype\s*\/|endobj)/g
const rectRe = /\/Rect\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/
const contentsRe = /\/Contents\s*(<[0-9a-fA-F]*>|\([^)]*\))/
const cRe = /\/C\s*\[\s*([\d.\s]*?)\]/      // 邊框顏色
const icRe = /\/IC\s*\[\s*([\d.\s]*?)\]/    // 填充顏色

const rows = []
for (const m of raw.matchAll(annRe)) {
  const body = m[1]
  const rm = body.match(rectRe)
  if (!rm) continue
  const [x1, y1, x2, y2] = rm.slice(1, 5).map(Number)
  const w = Math.abs(x2 - x1)
  const h = Math.abs(y2 - y1)
  const cm = body.match(contentsRe)
  const text = cm ? decode(cm[1]) : ''
  const c = (body.match(cRe)?.[1] || '').trim().replace(/\s+/g, ',')
  const ic = (body.match(icRe)?.[1] || '').trim().replace(/\s+/g, ',')
  rows.push({ text, w: +w.toFixed(1), h: +h.toFixed(1), long: +Math.max(w, h).toFixed(1), short: +Math.min(w, h).toFixed(1), c, ic })
}

const numbered = rows.filter((r) => /^\d{1,3}$/.test(r.text))
console.log(`總 Square 標註: ${rows.length}，其中數字編號: ${numbered.length}`)

// 顏色分佈
const byColor = {}
for (const r of numbered) {
  const key = `C[${r.c}] IC[${r.ic}]`
  byColor[key] = (byColor[key] || 0) + 1
}
console.log('\n=== 依顏色分組（數字標註）===')
for (const [k, v] of Object.entries(byColor).sort((a, b) => b[1] - a[1])) console.log(`  ${v.toString().padStart(4)}  ${k}`)

// 框尺寸分佈（長邊 bucket）
const byLong = {}
for (const r of numbered) {
  const b = Math.round(r.long / 5) * 5
  byLong[b] = (byLong[b] || 0) + 1
}
console.log('\n=== 依長邊尺寸 bucket（每 5pt）===')
for (const [k, v] of Object.entries(byLong).sort((a, b) => +a[0] - +b[0])) console.log(`  長邊~${k.padStart(4)}pt : ${v}`)

// 取樣前 25 筆看長相
console.log('\n=== 取樣（前 25 筆數字標註）===')
for (const r of numbered.slice(0, 25)) console.log(`  id=${r.text.padStart(3)}  ${r.short}x${r.long}  C[${r.c}] IC[${r.ic}]`)

// 非數字的 Contents 文字取樣（可能有「機車/汽車/自行車」字樣）
const textual = rows.filter((r) => r.text && !/^\d{1,3}$/.test(r.text))
console.log(`\n=== 非數字 Contents 取樣（共 ${textual.length}）===`)
for (const r of textual.slice(0, 30)) console.log(`  "${r.text}"  ${r.short}x${r.long}`)
