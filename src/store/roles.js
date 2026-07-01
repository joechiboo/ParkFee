// 管理員（物業）權限 — v2（2026-07-01 資安）：管理密碼**不再寫死在前端 bundle**。
// 登入：戶號 `admin` ＋ 於「車號」欄輸入**管理密碼**（＝後端 ADMIN_PASSWORD secret，只物業知道）。
//   - 前端不比對密碼（bundle 不放它）＝樂觀登入；真正把關在 Edge Function 比對 secret。
//   - 輸入的密碼存為 sessionPlate、寫入/讀敏感資料時送後端；密碼錯 → 後端回 403（進得了管理頁但撈不到資料、寫不進）。
// 呼叫寫入/管理讀取的 password 一律傳 sessionPlate.value（使用者輸入的密碼），不再有前端常數。
// ⚠️ 仍是「共用密碼」等級。要更嚴（per-household）＝ household.is_admin + 認證車號擁有權驗證（A 版，後續）。

const ADMIN_ID = 'admin'

// 戶號 admin → 回 admin 假戶（帶 is_admin）。輸入的「車號」＝管理密碼，由呼叫端存為 sessionPlate；此處不比對。
export function tryAdminLogin(id) {
  if (String(id ?? '').trim().toLowerCase() === ADMIN_ID) {
    return { 戶號: 'admin', 電話: '', vehicles: [], 車位志願: [], 志願落選保底: false, is_admin: true }
  }
  return null
}

export const isAdmin = (household) => !!household?.is_admin

// 是否為「特例管理帳號」（admin/樂菲莊園，無真實登記）。
// 真實住戶就算具管理權（白名單，如 H3-6）也回 false → 仍看得到自己的車輛/編輯/選位。
export const isAdminAccount = (household) => household?.戶號 === ADMIN_ID
