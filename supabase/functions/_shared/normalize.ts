// 戶號 / 車號 正規化與驗證 —— 與前端 src/data/household.js、src/data/plate.js 對齊。
// ⚠️ 伺服器端必須自行正規化/驗證，不可信任前端送來的值。

// 戶號：全形→半形、各式破折號→連字號、去空白、轉大寫。
export function normalizeHousehold(raw: unknown): string {
  if (raw == null) return ''
  return String(raw)
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // 全形 ASCII → 半形
    .replace(/[—–]/g, '-') // em/en dash → 連字號
    .replace(/[　\s]+/g, '') // 全形 + 一般空白全去
    .toUpperCase()
}

// 戶號格式：住宅 A–H + 樓(1–15) + '-' + 戶(1–3 碼)；店面 S（1F，樓可省）+ '-' + 戶。
export function isValidHousehold(raw: unknown): boolean {
  const s = normalizeHousehold(raw)
  if (/^[A-H](1[0-5]|[1-9])-\d{1,3}$/.test(s)) return true
  if (/^S1?-\d{1,3}$/.test(s)) return true
  return false
}

// 自行車（docs/10 Q18）：無車牌 → 車號欄存「綁戶號」的合成鍵 '自行車-<戶號>-<序>'。
// 含中文字元，與台灣車牌值域（大寫英數＋連字號）天然不相交 → 不可能與真實車牌互撞，故沿用車號 PK。
export const BIKE = '自行車'

export function bikeVehicleKey(hid: string, seq: number): string {
  return `${BIKE}-${hid}-${seq}`
}

export function isBikeVehicleKey(v: unknown): boolean {
  return String(v ?? '').startsWith(`${BIKE}-`)
}

// 台灣車牌：大寫、去空白、字母段與數字段間補單一連字號。
export function normalizeTWPlate(raw: unknown): string {
  if (raw == null) return ''
  const s = String(raw)
    .toUpperCase()
    .replace(/[\s　]/g, '')
    .replace(/[—–－‐]/g, '-')
  const compact = s.replace(/-/g, '')
  const m = compact.match(/^([A-Z]+)(\d+)$/) || compact.match(/^(\d+)([A-Z]+)$/)
  if (m) return `${m[1]}-${m[2]}`
  return s
}
