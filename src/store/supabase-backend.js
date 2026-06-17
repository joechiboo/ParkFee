// 登記儲存層 — Supabase 後端。介面與 local-backend.js 一致（皆 async）。
//
// 全部走 Edge Function（register / login / get-household）：
//   - 敏感表（household/vehicle）RLS deny-all，anon key 直接查表會回空/403。
//   - Edge Function 內部用 service_role（平台自動注入，永不進前端）讀寫，且只回「該戶」資料。
// 見 docs/12 §4。

import { supabase } from './supabase-client.js'

export class RegistrationError extends Error {}

// 統一呼叫 Edge Function：成功回 data；後端業務錯誤（{ error }）→ 拋 RegistrationError。
async function invoke(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    // 嘗試從回應 body 取後端訊息（FunctionsHttpError 會帶 context）
    let msg = error.message || '伺服器錯誤，請稍後再試'
    try {
      const j = await error.context?.json?.()
      if (j?.error) msg = j.error
    } catch {
      /* ignore */
    }
    throw new RegistrationError(msg)
  }
  if (data?.error) throw new RegistrationError(data.error)
  return data
}

export async function register({ 戶號, 電話, vehicles }) {
  const data = await invoke('register', { 戶號, 電話, vehicles })
  return data.household
}

export async function login(戶號, 車號) {
  const data = await invoke('login', { 戶號, 車號 })
  return data.household ?? null
}

// 安全考量：以「戶號」單獨查詢會讓任何人列舉他戶的車號/電話（enumeration 洩漏），
// 故 Supabase 後端不提供此入口。需取整戶資料請走 login(戶號, 車號)（雙因子）。
export async function getHousehold() {
  throw new RegistrationError('請改用登入（戶號 ＋ 任一車號）查看整戶資料')
}
