// 登記儲存層 facade（async）——呼叫端只認這支，不管底層是 localStorage 還是 Supabase。
//
// 切換規則：
//   設定了 VITE_SUPABASE_URL（見 .env）→ 走 supabase-backend.js（Edge Function，跨裝置）。
//   未設定 → 走 local-backend.js（localStorage，單機/離線/測試）。
//
// 介面（全部 async，回傳 Promise）：
//   register({ 戶號, 電話, vehicles }) → 整戶資料；違規 reject(RegistrationError)
//   login(戶號, 車號)                  → 整戶資料 | null
//   getHousehold(戶號)                 → 整戶資料 | null
//
// 安全模型見 docs/12 §4：敏感表 RLS deny-all、service_role 只在 Edge Function、anon key 公開無妨。

import * as local from './local-backend.js'

// ⚠️ 不可直接轉出某一邊的類別：local 與 supabase 兩個 backend 各有自己的 RegistrationError，
//    呼叫端 instanceof 會對不上（走 supabase 時丟的是 supabase 版）→ 後端驗證訊息全被吞成
//    「請檢查網路」。改由 facade 提供共用基底，兩個 backend 都繼承它。
export { RegistrationError } from './registration-error.js'

const useSupabase = !!import.meta.env?.VITE_SUPABASE_URL

let _backend = null
async function backend() {
  if (!useSupabase) return local
  if (!_backend) _backend = await import('./supabase-backend.js')
  return _backend
}

export async function register(input) {
  return (await backend()).register(input)
}
export async function login(戶號, 車號) {
  return (await backend()).login(戶號, 車號)
}
export async function getHousehold(戶號) {
  return (await backend()).getHousehold(戶號)
}
export async function updateHousehold(input) {
  return (await backend()).updateHousehold(input)
}
// 寫該戶車位志願序（戶層級）+ 志願落選保底。認證車號＝登入車號（擁有權證明）。
export async function saveWishes(input) {
  return (await backend()).saveWishes(input)
}
// 物業發佈配位結果（回填 vehicle）。需管理員密碼。
export async function publishResult(input) {
  return (await backend()).publishResult(input)
}
