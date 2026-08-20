// POST /login  { 戶號, 車號 }  → { household } | { household: null }
// 登入＝戶號 ＋ 任一已登記車號（車號全域唯一，命中且屬該戶才通過）。
//
// 自行車不另開登入路徑（2026-08-19 決策）：自行車無車牌，車號欄存的是系統產生的合成鍵，
// 住戶不會知道、也不該拿來當密碼；電話當憑證則太弱，已否決。
// → **純自行車戶不開放線上登入**，查詢/修改一律臨櫃，由物業在管理頁處理。
//   有機車的戶不受影響（用車牌登入後，同頁可一併看到自行車）。
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
    const { data: v } = await db.from('vehicle').select('戶號').eq('車號', plate).maybeSingle()

    // 車號不存在、或不屬輸入戶號 → 一律回 null（不洩漏「車號存在但戶號錯」）
    if (!v || v.戶號 !== hid) return json({ household: null })

    return json({ household: await fetchHousehold(db, hid) })
  } catch (e) {
    console.error('login error:', e)
    return json({ error: '伺服器錯誤，請稍後再試' }, 500)
  }
})
