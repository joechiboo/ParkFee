// POST /set-locked  { op: 'lock'|'unlock', 異動: string[], password }  → { skipped } | { error }
// 物業批次鎖定／解除。🔒 需管理員密碼（比對 ADMIN_PASSWORD secret）。
// 寫入用 service_role（locked_seat 對 anon 唯讀、不可寫）。
//
// 2026-11-02 由「整批取代」改為「只增減指定格」：整批取代時，管理員頁面若沒重新整理，
// 會洗掉住戶剛線上鎖定的志願小位。解除時略過已掛車的格，否則該格會被第二人選走；
// 要解這些格請到維護頁單格解除，才會一併清掉車輛的指派。
import { corsHeaders, json, adminClient, verifyAdmin } from '../_shared/http.ts'
import { holderOf } from '../_shared/seat-holder.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const body = await req.json()
    const db = adminClient()
    if (!(await verifyAdmin(db, body))) return json({ error: '管理員驗證失敗' }, 403)

    if (body.op !== 'lock' && body.op !== 'unlock')
      return json({ error: '頁面版本過舊，請重新整理後再試' }, 400)

    const ids = Array.isArray(body.異動)
      ? [...new Set(body.異動.map((x: unknown) => String(x).trim()).filter(Boolean))] as string[]
      : []
    if (!ids.length) return json({ error: '沒有要異動的車位' }, 400)

    if (body.op === 'lock') {
      const { error } = await db
        .from('locked_seat')
        .upsert(ids.map((id) => ({ 車位編號: id })), { ignoreDuplicates: true })
      if (error) return json({ error: error.message }, 400)
      return json({ skipped: [] })
    }

    const { data: held } = await db
      .from('vehicle')
      .select('車號, 戶號, 車位編號')
      .not('車位編號', 'is', null)
    const skipped = ids.filter((id) => holderOf(held, id))
    const free = ids.filter((id) => !skipped.includes(id))
    if (free.length) {
      const { error } = await db.from('locked_seat').delete().in('車位編號', free)
      if (error) return json({ error: error.message }, 400)
    }
    return json({ skipped })
  } catch (e) {
    console.error('set-locked error:', e)
    return json({ error: '伺服器錯誤，請稍後再試' }, 500)
  }
})
