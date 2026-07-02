// POST /publish-result  { rows: [{車號, 車位編號, 車位類型, 狀態, 簽約期限}], password }
//   → { updated, notFound: [車號…] } | { error }
// 物業發佈配位結果：回填到 vehicle（住戶登入即可看）。🔒 需管理員密碼（ADMIN_PASSWORD）。
// 先清空所有 vehicle 的結果欄，再依 rows 寫入 → 重新發佈會覆蓋舊結果。
// ⚠️ updated 用 .select() 取「實際更新到的列」＝真實命中數（避免 .eq() 配 0 列仍算成功的虛報）；
//    車號不在 vehicle 者列入 notFound，讓物業知道哪些沒寫進（多半是匯入了非本 DB 的名冊）。
import { corsHeaders, json, adminClient, verifyAdmin } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const body = await req.json()
    const rows = body.rows
    const db = adminClient()
    if (!(await verifyAdmin(db, body))) return json({ error: '管理員驗證失敗' }, 403)
    if (!Array.isArray(rows)) return json({ error: '缺少結果資料' }, 400)

    // 先清空舊結果（整表）。
    const { error: clrErr } = await db
      .from('vehicle')
      .update({ 車位編號: null, 車位類型: null, 配位狀態: null, 簽約期限: null })
      .neq('車號', '__none__')
    if (clrErr) return json({ error: clrErr.message }, 400)

    // 逐筆回填（依車號）。.select() 回實際更新到的列 → 真實命中；查無者列入 notFound。
    const updated: string[] = []
    const notFound: string[] = []
    for (const r of rows) {
      const plate = String(r?.車號 ?? '').trim().toUpperCase()
      if (!plate) continue
      const { data, error } = await db
        .from('vehicle')
        .update({
          車位編號: r.車位編號 || null,
          車位類型: r.車位類型 || null,
          配位狀態: r.狀態 || null,
          簽約期限: r.簽約期限 || null,
        })
        .eq('車號', plate)
        .select('車號')
      if (!error && data && data.length) updated.push(plate)
      else notFound.push(plate)
    }

    return json({ updated: updated.length, notFound })
  } catch (e) {
    console.error('publish-result error:', e)
    return json({ error: '伺服器錯誤，請稍後再試' }, 500)
  }
})
