// 管理員（物業）權限 — v1 前端守衛。
// 特例帳號：戶號 `admin` ＋ 車號 `樂菲莊園` → 管理員（前端寫死，免後端）。
// ⚠️ 這是「方便用」的前端 gate，不是真資安（值在 bundle 內、看得到）。維護頁目前只寫本機
//    localStorage、風險低。等「鎖定清單」改存 Supabase，必須改由後端 household.is_admin +
//    Edge Function 驗證，不可只靠這個。

const ADMIN_ID = 'admin'
const ADMIN_PASS = '樂菲莊園'

// 嘗試管理員特例登入：符合回 admin 假戶資料（帶 is_admin），否則 null。
export function tryAdminLogin(id, plate) {
  const a = String(id ?? '').trim().toLowerCase()
  const b = String(plate ?? '').trim()
  if (a === ADMIN_ID && b === ADMIN_PASS) {
    return { 戶號: 'admin', 電話: '', vehicles: [], 車位志願: [], 志願落選保底: false, is_admin: true }
  }
  return null
}

export const isAdmin = (household) => !!household?.is_admin
