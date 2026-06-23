// POST /set-locked  { 車位編號: string[], password }  → { locked } | { error }
// 物業設定「鎖定車位」清單（整批取代）。🔒 需管理員密碼（比對 ADMIN_PASSWORD secret）。
// 寫入用 service_role（locked_seat 對 anon 唯讀、不可寫）。
import { corsHeaders, json, adminClient } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const { 車位編號, password } = await req.json()
    const ADMIN = Deno.env.get('ADMIN_PASSWORD')
    if (!ADMIN || String(password ?? '') !== ADMIN) return json({ error: '管理員驗證失敗' }, 403)

    const ids = Array.isArray(車位編號)
      ? [...new Set(車位編號.map((x: unknown) => String(x).trim()).filter(Boolean))]
      : []

    const db = adminClient()
    // 整批取代：先清空、再插入新清單。
    const { error: delErr } = await db.from('locked_seat').delete().neq('車位編號', '__none__')
    if (delErr) return json({ error: delErr.message }, 400)
    if (ids.length) {
      const { error: insErr } = await db.from('locked_seat').insert(ids.map((id) => ({ 車位編號: id })))
      if (insErr) return json({ error: insErr.message }, 400)
    }
    return json({ locked: ids })
  } catch (e) {
    console.error('set-locked error:', e)
    return json({ error: '伺服器錯誤，請稍後再試' }, 500)
  }
})
