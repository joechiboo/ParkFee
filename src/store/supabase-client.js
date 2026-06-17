// Supabase 前端 client（只用公開的 anon key）。
//
// ⚠️ 這裡只放 anon key（VITE_SUPABASE_ANON_KEY）。它本就公開、會被打包進前端、任何人看得到，
//    這是設計如此——資料安全靠「敏感表 RLS deny-all + 只走 Edge Function」，不靠藏 key。
//    service_role key 絕對不可出現在前端（不可取名 VITE_*、不可寫進 src/）。見 docs/12 §4.2/§4.3。

import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error('缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY，請設定 .env（見 .env.example）')
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false }, // 我們用自訂「戶號+車號」登入，不需要 Supabase Auth session
})
