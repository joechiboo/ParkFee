// 產生「門牌號碼＋樓層 → 戶號」對照表（src/data/door-map.js）。
// 來源：社區幫「下載範例檔」的全戶門牌（private/，不進 repo）。門牌編號是建物資訊，不含住戶資料。
// 用法：node scripts/build-door-map.mjs [private/shequbang/payment-template-….csv]
// 門牌不會變，只有社區幫的門牌清單改版時才需要重跑。
import { readFileSync, writeFileSync } from 'node:fs'

const src = process.argv[2] || 'private/shequbang/payment-template-20261103-big5.csv'
const text = new TextDecoder('big5').decode(readFileSync(src))
const byDoor = new Map() // 門牌號碼 → Map(樓層 → 房型)
for (const line of text.split(/\r?\n/).slice(1)) {
  const c = line.split(',').map((x) => x.replace(/^"?=?"*|"*$/g, ''))
  const m = (c[0] || '').match(/^#([A-HS]\d+)-(\d+)$/)
  const floor = Number(c[1])
  if (!m || !(floor >= 1)) continue
  const floors = byDoor.get(m[2]) || byDoor.set(m[2], new Map()).get(m[2])
  if (floors.has(floor) && floors.get(floor) !== m[1]) throw new Error(`${m[2]} 號 ${floor} 樓對到兩個房型`)
  floors.set(floor, m[1])
}
// 同房型的連續樓層併成區段：[房型, 起, 迄]
const out = {}
let total = 0
for (const [door, floors] of [...byDoor].sort((a, b) => a[0] - b[0])) {
  const segs = []
  for (const f of [...floors.keys()].sort((a, b) => a - b)) {
    const t = floors.get(f)
    const last = segs[segs.length - 1]
    if (last && last[0] === t && last[2] === f - 1) last[2] = f
    else segs.push([t, f, f])
    total++
  }
  out[door] = segs
}
const body = Object.entries(out)
  .map(([d, segs]) => `  ${d}: ${JSON.stringify(segs)},`)
  .join('\n')
writeFileSync(
  'src/data/door-map.js',
  `// ⚠️ 自動產生，請勿手改。來源與重產方式見 scripts/build-door-map.mjs。
// 門牌號碼 → [[房型, 起始樓層, 結束樓層], …]。共 ${byDoor.size} 個門牌號碼、${total} 戶。
export const DOOR_MAP = {
${body}
}
`,
)
console.log(`門牌號碼 ${byDoor.size} 個、${total} 戶 → src/data/door-map.js`)
