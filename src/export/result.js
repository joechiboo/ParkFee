// 配位結果 → 清單列 / CSV（純函式）。
//   來源：distribute() 的回傳（assigned / 落選）。欄位依 HANDOFF §8 + 備註。
//   供 ExportView 下載 CSV，亦供 ResultView 顯示清單（同一份資料）。

import { feeFor } from '../data/fee.js'
import { toCSV } from '../data/csv.js'

// HANDOFF §8 配位結果欄位（末欄 備註 為作業輔助：配位方式／落選原因）。
export const RESULT_COLUMNS = ['戶號', '車號', '車位編號', '車位類型', '應繳金額', '簽約期限', '狀態', '備註']

// 簽約期限 = 公告日 + 5 日（辦法：公告後 5 日內簽約）。公告日為 'YYYY-MM-DD'；空/無效則回 ''。
export function signDeadline(公告日) {
  if (!公告日) return ''
  const d = new Date(`${公告日}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() + 5)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// distribute() 結果 → 清單列陣列（分配在前、未中在後）。
//   opts.公告日（'YYYY-MM-DD'）→ 帶出簽約期限。
export function resultRows(result, { 公告日 = '' } = {}) {
  const 期限 = signDeadline(公告日)
  const rows = []
  for (const a of result.assigned || []) {
    rows.push({
      戶號: a.戶號,
      車號: a.車號,
      車位編號: a.車位編號,
      車位類型: a.車位類型,
      應繳金額: feeFor(a.車種),
      簽約期限: 期限,
      狀態: '分配',
      備註: a.配位方式 || '',
    })
  }
  for (const l of result.落選 || []) {
    rows.push({
      戶號: l.戶號,
      車號: l.車號,
      車位編號: '',
      車位類型: '',
      應繳金額: '',
      簽約期限: '',
      狀態: '未中', // 交物業第二階段：勾保底→就近補、未勾→候補
      備註: l.原因 || '',
    })
  }
  return rows
}

// distribute() 結果 → CSV 字串（不含 BOM；下載時再加 BOM 供 Excel 正確顯示中文）。
export function resultCSV(result, opts) {
  return toCSV(resultRows(result, opts), RESULT_COLUMNS)
}
