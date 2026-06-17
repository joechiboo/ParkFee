// POST /login  { 戶號, 車號 }  → { household } | { household: null }
// 登入＝戶號 ＋ 任一已登記車號（車號全域唯一，命中且屬該戶才通過）。
import { corsHeaders, json, adminClient, fetchHousehold } from '../_shared/http.ts'
import { normalizeHousehold, normalizeTWPlate } from '../_shared/normalize.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const { 戶號, 車號 } = await req.json()
    const hid = normalizeHousehold(戶號)
    const plate = normalizeTWPlate(車號)
    if (!hid || !plate) return json({ household: null })

    const db = adminClient()
    const { data: v } = await db
      .from('vehicle')
      .select('戶號')
      .eq('車號', plate)
      .maybeSingle()

    // 車號不存在、或不屬輸入戶號 → 一律回 null（不洩漏「車號存在但戶號錯」）
    if (!v || v.戶號 !== hid) return json({ household: null })

    return json({ household: await fetchHousehold(db, hid) })
  } catch (e) {
    console.error('login error:', e)
    return json({ error: '伺服器錯誤，請稍後再試' }, 500)
  }
})
