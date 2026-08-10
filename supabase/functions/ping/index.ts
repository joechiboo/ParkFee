// 心跳 Edge Function：更新 keepalive 表時間戳（service_role）。
// 用途：GitHub Actions 每日呼叫 → 產生真實 DB 寫入活動，防免費版閒置暫停。
// 無需驗證（寫入內容固定為 now()，被外人狂打也無害）；回 { ok, at }。
import { adminClient, json } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({}, 200)
  const db = adminClient()
  const at = new Date().toISOString()
  const { error } = await db.from('keepalive').upsert({ id: 1, at })
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true, at })
})
