// 套用 2026-08-19 現場實勘（陳進茂）對車位大小的更正到 seat-select-demo.html。
// 結果：大車位 317 + 無障礙 8 = 325、小車位 330，合計 655。
// 用法: node scripts/apply-field-survey-2026-08-19.mjs [--write]
import fs from 'fs'

const DEMO = 'public/demo/seat-select-demo.html'
const WRITE = process.argv.includes('--write')
// 由「大」更正為「小」：208-228 整排、119、95-96、596
const TO_SMALL = new Set([...Array.from({ length: 21 }, (_, i) => 208 + i), 119, 95, 96, 596])

let html = fs.readFileSync(DEMO, 'utf8')
const RE = /<g class="seat cat-([\w-]+)((?: \w+)*)" data-id="([^"]*)" data-cat="([\w-]+)">/g
const changed = []
const out = html.replace(RE, (full, cls, extra, id, cat) => {
  if (!['small', 'motor', 'access'].includes(cat)) return full   // 只動機車位，汽車/自行車/排除點的 id 是另一套編號
  const n = +id
  if (!TO_SMALL.has(n) || cat === 'small') return full
  changed.push(n)
  return `<g class="seat cat-small${extra}" data-id="${id}" data-cat="small">`
})
console.log(`更正 ${changed.length} 格為小車位：${changed.sort((a, b) => a - b).join(',')}`)
const miss = [...TO_SMALL].filter(n => !changed.includes(n))
if (miss.length) console.log(`（已是小車位、不需更動：${miss.sort((a, b) => a - b).join(',')}）`)
if (WRITE) { fs.writeFileSync(DEMO, out); console.log(`已寫入 ${DEMO}`) }
else console.log('(未加 --write，未變更檔案)')
