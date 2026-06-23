// 管理員（物業）權限 — v1 前端守衛。
// 管理員身分有兩種：
//   1) 特例帳號：戶號 `admin` ＋ 車號 `樂菲莊園`（前端寫死，免後端）。
//   2) 白名單戶號：用真實戶號＋車號登入即具管理權（如本人 H3-6）。
// 寫入（鎖定/發佈結果）一律送 ADMIN_PASSWORD，由 Edge Function 比對 ADMIN_PASSWORD secret 把關。
// ⚠️ 這是「方便用」的前端 gate + 共用密碼，不是真資安（密碼在 bundle 內）。真正關卡是後端
//    secret 比對；要更嚴須改 household.is_admin + 認證車號擁有權驗證（後續）。

const ADMIN_ID = 'admin'
export const ADMIN_PASSWORD = '樂菲莊園' // 寫入 Edge Function 驗的管理員密碼（＝後端 ADMIN_PASSWORD secret）
const ADMIN_HOUSEHOLDS = ['H3-6'] // 額外管理員戶號（真實戶號登入也具管理權）

// 嘗試管理員特例登入：符合回 admin 假戶資料（帶 is_admin），否則 null。
export function tryAdminLogin(id, plate) {
  const a = String(id ?? '').trim().toLowerCase()
  const b = String(plate ?? '').trim()
  if (a === ADMIN_ID && b === ADMIN_PASSWORD) {
    return { 戶號: 'admin', 電話: '', vehicles: [], 車位志願: [], 志願落選保底: false, is_admin: true }
  }
  return null
}

export const isAdmin = (household) =>
  !!household?.is_admin || ADMIN_HOUSEHOLDS.includes(household?.戶號)
