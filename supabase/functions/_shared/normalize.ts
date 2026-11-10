// 戶號 / 車號 正規化與驗證 —— 與前端 src/data/household.js、src/data/plate.js 對齊。
// ⚠️ 伺服器端必須自行正規化/驗證，不可信任前端送來的值。
//
// ⚠️⚠️ 改本檔後，**所有引用它的函式都要一起重新部署**，否則會出現「登記過得了、選位過不了」
//     這種半通不通的狀態（Edge Function 各自打包一份 _shared，不是共用執行期）。
//     戶清單比對（householdProblem）只在新建戶的 register 與更正戶號的 rename-household 做；
//     其餘函式靠擁有權驗證，既有戶就算戶號填錯也還能登入、修改，等櫃台更正。
//     一次部署：npx supabase functions deploy login register save-wishes update-household claim-seat rename-household
//     查有無新增引用者：grep -rl "normalize.ts" supabase/functions/*/index.ts

// 戶號：全形→半形、各式破折號→連字號、去空白、轉大寫。
export function normalizeHousehold(raw: unknown): string {
  if (raw == null) return ''
  return String(raw)
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // 全形 ASCII → 半形
    .replace(/[—–]/g, '-') // em/en dash → 連字號
    .replace(/[　\s]+/g, '') // 全形 + 一般空白全去
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
const FLOORS: Record<string, Record<number, number[]>> = {
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
// 測試帳號（Z99、/dev 假戶 A1-90、種子 S1-99X），與前端 household.js 同步；開放登記前清除。
const TEST_RE = /^(Z\d{1,3}|[A-HS]\d-9\d|S1-99\d)$/

// 戶號哪裡不對：回 null＝沒問題；否則回一句給填寫者看的說明。
export function householdProblem(raw: unknown): string | null {
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
export function isValidHousehold(raw: unknown): boolean {
  return householdProblem(raw) === null
}

export function isStaffHousehold(raw: unknown): boolean {
  return STAFF_RE.test(normalizeHousehold(raw))
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
