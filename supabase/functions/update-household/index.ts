// POST /update-household  { 戶號, 電話, 社宅?, vehicles, 認證車號 }  → { household } | { error }
// 編輯既有戶：整批取代車輛 + 改電話。戶號不可變。可一併增刪自行車（車號由後端合成，前端不送）。
// 🔒 擁有權驗證：見 http.ts verifyOwnership——認證車號須「目前」屬於該戶，
//    否則任何人拿公開 anon key 就能竄改他戶登記。自行車的合成車號不算憑證。
import { corsHeaders, json, adminClient, fetchHousehold, verifyOwnership } from '../_shared/http.ts'
import { normalizeHousehold, isValidHousehold } from '../_shared/normalize.ts'
import { buildVehicleRows, isBikeOnly } from '../_shared/vehicles.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const { 戶號, 電話, 社宅, vehicles, 認證車號 } = await req.json()

    const hid = normalizeHousehold(戶號)
    if (!hid) return json({ error: '請填寫戶號' }, 400)
    if (!isValidHousehold(hid)) return json({ error: '戶號格式不對（例 H3-6／店面 S1-6）' }, 400)
    if (!Array.isArray(vehicles) || vehicles.length === 0)
      return json({ error: '至少要保留一台車' }, 400)

    const db = adminClient()

    // 🔒 擁有權驗證：認證車號目前須屬於 hid
    if (!(await verifyOwnership(db, hid, { 認證車號 })))
      return json({ error: '驗證失敗：請使用登入時的車號再試' }, 403)

    const { rows: cleaned, error: vErrMsg } = buildVehicleRows(hid, vehicles)
    if (vErrMsg) return json({ error: vErrMsg }, 400)

    // 刪掉最後一台機車＝從此沒有登入憑證，之後只能臨櫃 → 擋下並要住戶臨櫃辦理，避免自鎖。
    if (isBikeOnly(cleaned))
      return json(
        { error: '線上不可只保留自行車（車號是登入憑證）。要移除全部機車請至管理中心辦理' },
        400,
      )

    const phone = String(電話 ?? '').trim()

    // 原子整批取代（含跨戶車號衝突檢查）
    const { error } = await db.rpc('app_update_household', {
      p_hid: hid,
      p_phone: phone,
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
