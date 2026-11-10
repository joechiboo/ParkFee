// 戶號正規化與驗證 — 戶號是主鍵，影響 registry 去重與「戶號↔車號↔車位」對應。
// 規則（建商編法，2026-11-10 使用者確認）：
//   戶號 = 房型 + '-' + 樓層，例 H3-6 = H3 房型 6 樓。房型 = 棟別字母 A–H + 編號；店面 S1–S15 在 1 樓。
//   社區工作人員無戶號（非住戶）→ 以合成鍵「員工-<編號>」代之（2026-08-26）。
//   之所以沿用同一個欄位而非另開識別體系：登入是「戶號＋車號」比對，工作人員有車牌，
//   給了戶號就能沿用登記/登入/選位/結果整條線，不必另做一套。
//   ⚠️ 與 supabase/functions/_shared/normalize.ts 的同名規則必須同步改。

// 輸入正規化：全形→半形、去空白、各式破折號→連字號、轉大寫。
export function normalizeHousehold(raw) {
  if (raw == null) return ''
  return String(raw)
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // 全形 ASCII → 半形
    .replace(/[—–]/g, '-') // em/en dash → 連字號
    .replace(/[　\s]+/g, '') // 全形空白 + 一般空白，全部去除
    .toUpperCase()
    .replace(/^([A-HS])0*(\d+)-0*(\d+)$/, '$1$2-$3') // H03-06 → H3-6，避免同一戶兩種寫法
    .replace(/^S(\d{1,2})$/, 'S$1-1') // 店面只打 S6 → S6-1
}

// 社區實際有的戶（建商編法，2026-11-10 改）：戶號 = 房型 + '-' + 樓層，例 H3-6 = H3 房型 6 樓。
//   來源：社區幫全戶門牌 655 戶（住宅 640 + 店面 15）。房型編號跳過 4。
//   店面在 1 樓，房型 S1–S15，寫 S6-1；只打 S6 會補成 S6-1。
//   ⚠️ 2026-11-10 前本檔把 H3-6 當成「3 樓第 6 戶」，與住戶實際填法相反；出帳腳本曾因此對錯門牌。
const FULL = [2, 15]
const FROM3 = [3, 15]
const FLOORS = {
  A: { 1: FULL, 2: FULL, 3: FULL, 5: FULL, 6: FULL, 7: FULL, 8: [3, 3] },
  B: { 1: FULL, 2: FULL, 3: FULL, 5: FULL, 6: FULL, 7: [2, 2] },
  C: { 1: FULL, 2: FULL, 3: FULL, 5: FULL, 6: FULL, 7: [2, 2], 8: [2, 2] },
  D: { 1: FULL, 2: FULL, 3: FULL, 5: FULL, 6: FULL, 7: FULL },
  E: { 1: FULL, 2: FULL, 3: FULL, 5: FULL, 6: FULL, 7: FULL, 8: FULL },
  F: { 1: FULL, 2: FROM3, 3: FROM3, 5: FROM3, 6: FROM3 },
  G: { 1: FULL, 2: FROM3, 3: FROM3, 5: FROM3, 6: FROM3 },
  H: { 1: FULL, 2: FULL, 3: FULL, 5: FULL, 6: FULL, 7: FULL, 8: FULL },
}
const STAFF_RE = /^員工-.+$/
// 測試帳號（不是住戶，開放登記前清除；check-roster 會列為殘留）：
//   測試棟 Z（Z99，給經理／委員試玩）、/dev 產生的假戶（樓層段 9X，如 A1-90）、種子帳號 S1-99X。
//   樓層 90 以上不可能是真實戶，所以不會放行填錯的住戶。
const TEST_RE = /^(Z\d{1,3}|[A-HS]\d-9\d|S1-99\d)$/

// 戶號哪裡不對：回 null＝沒問題；否則回一句給填寫者看的說明。
export function householdProblem(raw) {
  const s = normalizeHousehold(raw)
  if (!s) return '請填寫戶號'
  // 工作人員合成鍵、測試棟 Z（試玩用，開放登記前清除）不比對戶清單
  if (STAFF_RE.test(s) || TEST_RE.test(s)) return null
  const m = s.match(/^([A-HS])(\d{1,2})-(\d{1,3})$/)
  if (!m) return '戶號格式不對，請填「房型-樓層」，例：H3 房型 6 樓填 H3-6（店面填 S6-1）'
  const type = `${m[1]}${Number(m[2])}`
  const floor = Number(m[3])
  if (m[3].length === 3) return `「${m[3]}」像是門牌號碼。戶號後面要填樓層，例：${type} 房型 6 樓填 ${type}-6`
  if (m[1] === 'S') {
    if (Number(m[2]) < 1 || Number(m[2]) > 15) return `社區沒有 ${type} 這間店面（店面是 S1–S15）`
    return floor === 1 ? null : `店面都在 1 樓，請填 ${type}-1`
  }
  const range = FLOORS[m[1]][Number(m[2])]
  if (!range) return `社區沒有 ${type} 這個房型，請確認戶號（例：H3 房型 6 樓填 H3-6）`
  if (floor < range[0] || floor > range[1])
    return `${type} 房型沒有 ${floor} 樓（${range[0] === range[1] ? `只有 ${range[0]} 樓` : `${range[0]}–${range[1]} 樓`}）。${floor === 1 ? '一樓店面請填 S 開頭的編號，例 S6-1' : '請確認樓層'}`
  return null
}

// 格式＋戶清單驗證（先正規化再比對）。
export function isValidHousehold(raw) {
  return householdProblem(raw) === null
}

export function isTestHousehold(raw) {
  return TEST_RE.test(normalizeHousehold(raw))
}

// 社區工作人員的合成戶號：員工-<姓名或編號>。由櫃檯代打、僅需在社區內唯一。
// 用姓名而非流水號＝物業不必另外維護對照表（2026-08-26 決）；姓名不外洩，因公告公開版已隱藏工作人員。

// 是否為工作人員之合成戶號（非住戶）。配位時排在住戶之後，費用比照住戶（辦法伍二（十二））。
export function isStaffHousehold(raw) {
  return STAFF_RE.test(normalizeHousehold(raw))
}

// 產生工作人員戶號：staffHousehold('陳大明') → '員工-陳大明'；給數字則補零 staffHousehold(1) → '員工-01'。
export function staffHousehold(nameOrNo) {
  const v = String(nameOrNo ?? '').trim()
  return `員工-${/^\d+$/.test(v) ? v.padStart(2, '0') : v}`
}
