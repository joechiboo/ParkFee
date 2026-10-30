// 把 b1-classification.json 的「一般小機車位」清單抄一份到 Edge Function 的 _shared/，
// 讓伺服器端驗得了「住戶線上選定的志願小位真的是小位、而且不是公益位」。
//
// 為什麼不另建 seat_meta 表：只有 claim-seat 一支函式要用、資料一年動一次（盤點/實勘後），
// 檔案隨函式一起部署最省事；改了分類就重跑本腳本再 deploy claim-seat。
//
//   node scripts/build-seat-types-shared.mjs
//
// 產出：supabase/functions/_shared/seat-types.ts（進版控）。測試會比對兩邊一致，避免漏跑。

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cls = JSON.parse(readFileSync(resolve(root, 'src/map/b1-classification.json'), 'utf8'))

export function smallGeneralSeatIds(classification = cls) {
  return classification.seats
    .filter((s) => s.cat === 'small' && !s.public)
    .map((s) => String(s.id))
    .sort((a, b) => +a - +b)
}

const ids = smallGeneralSeatIds()
const body = `// ⚠️ 自動產生：node scripts/build-seat-types-shared.mjs（來源 src/map/b1-classification.json）。
// 一般小機車位（排除公益位）清單 — claim-seat 伺服器端驗證「志願小位」用。
// 共 ${ids.length} 格。改分類後重跑腳本並重新部署 claim-seat。
export const SMALL_GENERAL_SEAT_IDS: ReadonlySet<string> = new Set([
${ids.map((id) => `  '${id}',`).join('\n')}
])

export function isSmallGeneralSeat(id: unknown): boolean {
  return SMALL_GENERAL_SEAT_IDS.has(String(id ?? '').trim())
}
`
const out = resolve(root, 'supabase/functions/_shared/seat-types.ts')
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  writeFileSync(out, body, 'utf8')
  console.log(`寫入 ${out}：${ids.length} 格一般小位`)
}
