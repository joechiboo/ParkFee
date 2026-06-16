// 戶號正規化與驗證 — 戶號是主鍵，影響 registry 去重與「戶號↔車號↔車位」對應。
// 規則（管委會給定 2026-06-16）：
//   棟別 A–H（住宅）+ S（店面，位於 1F）；樓層 1–15；無地下室戶。
//   格式：棟 + 樓 + '-' + 戶，例 H3-6。
//   店面 S 恆在 1F，故 S1-6 或省略樓層的 S-6 皆可。

// 輸入正規化：全形→半形、去空白、各式破折號→連字號、轉大寫。
export function normalizeHousehold(raw) {
  if (raw == null) return ''
  return String(raw)
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // 全形 ASCII → 半形
    .replace(/[—–]/g, '-') // em/en dash → 連字號
    .replace(/[　\s]+/g, '') // 全形空白 + 一般空白，全部去除
    .toUpperCase()
}

// 格式驗證（先正規化再比對）。
export function isValidHousehold(raw) {
  const s = normalizeHousehold(raw)
  // 住宅 A–H：棟 + 樓(1–15) + '-' + 戶(1–3 碼)
  if (/^[A-H](1[0-5]|[1-9])-\d{1,3}$/.test(s)) return true
  // 店面 S（1F）：S + (樓 1 可省) + '-' + 戶
  if (/^S1?-\d{1,3}$/.test(s)) return true
  return false
}
