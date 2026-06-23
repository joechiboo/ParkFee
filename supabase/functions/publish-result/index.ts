// POST /publish-result  { rows: [{車號, 車位編號, 車位類型, 狀態, 簽約期限}], password }  → { updated } | { error }
// 物業發佈配位結果：回填到 vehicle（住戶登入即可看）。🔒 需管理員密碼（ADMIN_PASSWORD）。
// 先清空所有 vehicle 的結果欄，再依 rows 寫入 → 重新發佈會覆蓋舊結果。
import { corsHeaders, json, adminClient } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const { rows, password } = await req.json()
    const ADMIN = Deno.env.get('ADMIN_PASSWORD')
    if (!ADMIN || String(password ?? '') !== ADMIN) return json({ error: '管理員驗證失敗' }, 403)
    if (!Array.isArray(rows)) return json({ error: '缺少結果資料' }, 400)

    const db = adminClient()

    // 先清空舊結果（整表）。
    const { error: clrErr } = await db
      .from('vehicle')
      .update({ 車位編號: null, 車位類型: null, 配位狀態: null, 簽約期限: null })
      .neq('車號', '__none__')
    if (clrErr) return json({ error: clrErr.message }, 400)

    // 逐筆回填（依車號）。
    let updated = 0
    for (const r of rows) {
      const plate = String(r?.車號 ?? '').trim().toUpperCase()
      if (!plate) continue
      const { error } = await db
        .from('vehicle')
        .update({
          車位編號: r.車位編號 || null,
          車位類型: r.車位類型 || null,
          配位狀態: r.狀態 || null,
          簽約期限: r.簽約期限 || null,
        })
        .eq('車號', plate)
      if (!error) updated += 1
    }

    return json({ updated })
  } catch (e) {
    console.error('publish-result error:', e)
    return json({ error: '伺服器錯誤，請稍後再試' }, 500)
  }
})
