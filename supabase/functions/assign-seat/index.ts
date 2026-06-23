// POST /assign-seat —— 物業指派/解除「保留．志願小位．無障礙」車位（抽籤前確定+繳費）。
// 🔒 需管理員密碼（ADMIN_PASSWORD）。安全分流：
//   - 車位 id 寫公開的 locked_seat（選位/抽籤排除用，無個資）。
//   - 戶號/車號/繳費 寫 RLS deny-all 的 vehicle（只該戶 login 或本函式讀得到）。
// op：
//   list   → 回傳目前鎖定清單 + 各位指派（管理員專屬讀，含個資）。
//   assign → 鎖定該位；若帶車號則把該車指派到此位（寫 vehicle）。
//   unlock → 解鎖該位；若帶車號則清掉該車的指派。
import { corsHeaders, json, adminClient } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const body = await req.json()
    const ADMIN = Deno.env.get('ADMIN_PASSWORD')
    if (!ADMIN || String(body?.password ?? '') !== ADMIN) return json({ error: '管理員驗證失敗' }, 403)

    const db = adminClient()
    const op = body.op

    if (op === 'list') {
      const { data: locks } = await db.from('locked_seat').select('車位編號')
      const ids = (locks || []).map((l: { 車位編號: string }) => l.車位編號)
      let vs: Array<Record<string, unknown>> = []
      if (ids.length) {
        const { data } = await db
          .from('vehicle')
          .select('車號, 戶號, 車種, 車位編號, 配位狀態, 已繳費')
          .in('車位編號', ids)
        vs = data || []
      }
      const assignments = ids.map((id: string) => {
        const v = vs.find((x) => x.車位編號 === id)
        return { 車位編號: id, ...(v || {}) }
      })
      return json({ assignments })
    }

    const seat = String(body.車位編號 ?? '').trim()
    if (!seat) return json({ error: '缺少車位編號' }, 400)
    const plate = String(body.車號 ?? '').trim().toUpperCase()

    if (op === 'assign') {
      const { error: lkErr } = await db.from('locked_seat').upsert({ 車位編號: seat })
      if (lkErr) return json({ error: lkErr.message }, 400)
      if (plate) {
        const { error: vErr } = await db
          .from('vehicle')
          .update({
            車位編號: seat,
            車位類型: body.車位類型 || null,
            配位狀態: body.配位狀態 || '分配',
            已繳費: !!body.已繳費,
          })
          .eq('車號', plate)
        if (vErr) return json({ error: vErr.message }, 400)
      }
      return json({ ok: true })
    }

    if (op === 'unlock') {
      const { error: dErr } = await db.from('locked_seat').delete().eq('車位編號', seat)
      if (dErr) return json({ error: dErr.message }, 400)
      if (plate) {
        await db
          .from('vehicle')
          .update({ 車位編號: null, 車位類型: null, 配位狀態: null, 已繳費: false, 簽約期限: null })
          .eq('車號', plate)
      }
      return json({ ok: true })
    }

    return json({ error: '未知 op' }, 400)
  } catch (e) {
    console.error('assign-seat error:', e)
    return json({ error: '伺服器錯誤，請稍後再試' }, 500)
  }
})
