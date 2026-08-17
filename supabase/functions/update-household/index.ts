// POST /update-household  { 戶號, 電話, 社宅?, vehicles, 認證車號 }  → { household } | { error }
// 編輯既有戶：整批取代車輛 + 改電話。戶號不可變。
// 🔒 擁有權驗證：認證車號（登入時用的車號）必須「目前」屬於該戶，才允許編輯——
//    否則任何人拿公開 anon key 就能竄改他戶登記。
import { corsHeaders, json, adminClient, fetchHousehold } from '../_shared/http.ts'
import { normalizeHousehold, isValidHousehold, normalizeTWPlate } from '../_shared/normalize.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const { 戶號, 電話, 社宅, vehicles, 認證車號 } = await req.json()

    const hid = normalizeHousehold(戶號)
    if (!hid) return json({ error: '請填寫戶號' }, 400)
    if (!isValidHousehold(hid)) return json({ error: '戶號格式不對（例 H3-6／店面 S1-6）' }, 400)
    if (!Array.isArray(vehicles) || vehicles.length === 0)
      return json({ error: '至少要保留一台機車' }, 400)

    const db = adminClient()

    // 🔒 擁有權驗證：認證車號目前須屬於 hid
    const authPlate = normalizeTWPlate(認證車號)
    const { data: auth } = await db
      .from('vehicle')
      .select('戶號')
      .eq('車號', authPlate)
      .maybeSingle()
    if (!auth || auth.戶號 !== hid)
      return json({ error: '驗證失敗：請使用登入時的車號再試' }, 403)

    // 正規化 + 同次提交內查重；重編第幾輛
    const cleaned: Array<Record<string, unknown>> = []
    const seen = new Set<string>()
    for (let i = 0; i < vehicles.length; i++) {
      const plate = normalizeTWPlate(vehicles[i]?.車號)
      if (!plate) return json({ error: `第 ${i + 1} 台未填車號` }, 400)
      if (seen.has(plate)) return json({ error: `車號 ${plate} 重複填寫` }, 400)
      seen.add(plate)
      cleaned.push({
        車號: plate,
        車種: vehicles[i].車種 === '重機' ? '重機' : '一般',
        第幾輛: i + 1,
        身障: !!vehicles[i].身障,
        志願小位: !!vehicles[i].志願小位,
      })
    }

    // 原子整批取代（含跨戶車號衝突檢查）
    const { error } = await db.rpc('app_update_household', {
      p_hid: hid,
      p_phone: String(電話 ?? '').trim(),
      p_vehicles: cleaned,
    })
    if (error) return json({ error: error.message || '更新失敗，請稍後再試' }, 400)

    // 社宅旗標（RPC 未涵蓋的戶欄位，另行更新；省一次 RPC 改版）
    if (社宅 !== undefined) await db.from('household').update({ 社宅: !!社宅 }).eq('戶號', hid)

    return json({ household: await fetchHousehold(db, hid) })
  } catch (e) {
    console.error('update-household error:', e)
    return json({ error: '伺服器錯誤，請稍後再試' }, 500)
  }
})
