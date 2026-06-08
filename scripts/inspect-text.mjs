// 用 mupdf 抽 B1 頁面的結構化文字，找車種區標（機車/汽車/自行車/機踏車…）及其座標，
// 並分析數字編號的數值分佈（推測各車種是否各自從 1 編號）。
import { readFileSync, readdirSync } from 'node:fs'
import * as mupdf from 'mupdf'

const dir = 'docs'
const name = readdirSync(dir).find((f) => f.includes('A2-5') || f.includes('平面'))
const data = readFileSync(`${dir}/${name}`)
const page = mupdf.Document.openDocument(data, 'application/pdf').loadPage(0)

const st = JSON.parse(page.toStructuredText('preserve-whitespace').asJSON())

// 收集所有文字 span（含座標）
const spans = []
for (const block of st.blocks || []) {
  if (block.type !== 'text') continue
  for (const line of block.lines || []) {
    const t = (line.text || '').trim()
    if (!t) continue
    const b = line.bbox
    spans.push({ t, x: +(b.x + b.w / 2).toFixed(0), y: +(b.y + b.h / 2).toFixed(0) })
  }
}
console.log(`文字 line 總數: ${spans.length}`)

// 找車種關鍵字
const kw = ['機車', '汽車', '自行車', '機踏車', '腳踏車', '停車', '車位', '殘障', '無障礙', '車格']
console.log('\n=== 含車種關鍵字的文字（座標）===')
const hits = spans.filter((s) => kw.some((k) => s.t.includes(k)))
for (const h of hits.slice(0, 60)) console.log(`  (${String(h.x).padStart(5)},${String(h.y).padStart(5)})  "${h.t}"`)
console.log(`  ...共 ${hits.length} 筆`)

// 數字 line 的數值分佈
const nums = spans.filter((s) => /^\d{1,3}$/.test(s.t)).map((s) => +s.t)
if (nums.length) {
  console.log(`\n=== 純數字文字: ${nums.length} 筆，max=${Math.max(...nums)}, min=${Math.min(...nums)} ===`)
  // 看有幾個 "1"、幾個 "2"（重複次數暗示有幾個獨立編號序列）
  const cnt = {}
  for (const n of nums) cnt[n] = (cnt[n] || 0) + 1
  const dup1 = cnt[1] || 0
  console.log(`  數值=1 出現 ${dup1} 次（暗示約有 ${dup1} 個獨立編號序列）`)
  console.log(`  數值=2 出現 ${cnt[2] || 0} 次, =3: ${cnt[3] || 0} 次`)
}
