// 台灣車牌正規化（登記／匯入用）。
// 原則：統一大寫、去空白、字母段與數字段之間補單一連字號。
// 註：O/0、I/1、B/8 之類的 OCR 誤判修正屬「車牌辨識(LPR, Phase II)」範疇，
//     對人工輸入的登記資料盲修會誤改正確車牌，故此處刻意不做。
export function normalizeTWPlate(raw) {
  if (raw == null) return ''
  // 全形→半形連字號、去所有空白、轉大寫
  const s = String(raw)
    .toUpperCase()
    .replace(/[\s　]/g, '')
    .replace(/[—–－‐]/g, '-')
  const compact = s.replace(/-/g, '')
  // 台灣車牌多為「字母段 + 數字段」或「數字段 + 字母段」兩段，於邊界補一個連字號
  const m = compact.match(/^([A-Z]+)(\d+)$/) || compact.match(/^(\d+)([A-Z]+)$/)
  if (m) return `${m[1]}-${m[2]}`
  // 不規則或多段者保留（已大寫去空白），不強拆
  return s
}
