// 戶號正規化與驗證 — 戶號是主鍵，影響 registry 去重與「戶號↔車號↔車位」對應。
// 規則（管委會給定 2026-06-16）：
//   棟別 A–H（住宅）+ S（店面，位於 1F）；樓層 1–15；無地下室戶。
//   格式：棟 + 樓 + '-' + 戶，例 H3-6。
//   店面 S 恆在 1F，故 S1-6 或省略樓層的 S-6 皆可。
//   社區工作人員無戶號（非住戶）→ 以合成鍵「員工-<編號>」代之（2026-08-26）。
//   之所以沿用同一個欄位而非另開識別體系：登入是「戶號＋車號」比對，工作人員有車牌，
//   給了戶號就能沿用登記/登入/選位/結果整條線，不必另做一套。

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
  // 社區工作人員：員工-<姓名或編號>
  if (STAFF_RE.test(s)) return true
  return false
}

// 社區工作人員的合成戶號：員工-<姓名或編號>。由櫃檯代打、僅需在社區內唯一。
// 用姓名而非流水號＝物業不必另外維護對照表（2026-08-26 決）；姓名不外洩，因公告公開版已隱藏工作人員。
const STAFF_RE = /^員工-.+$/

// 是否為工作人員之合成戶號（非住戶）。配位時排在住戶之後、免收費（辦法伍二（十二））。
export function isStaffHousehold(raw) {
  return STAFF_RE.test(normalizeHousehold(raw))
}

// 產生工作人員戶號：staffHousehold('陳大明') → '員工-陳大明'；給數字則補零 staffHousehold(1) → '員工-01'。
export function staffHousehold(nameOrNo) {
  const v = String(nameOrNo ?? '').trim()
  return `員工-${/^\d+$/.test(v) ? v.padStart(2, '0') : v}`
}
