// POST /register  { 戶號, 電話, 社宅?, vehicles:[{車號,車種,身障,志願小位,特徵}] }
// → { household } | { error }
// 登記即註冊：建戶 + 建車。戶號/車號皆 PK，重複由 DB 唯一鍵擋下。
// 自行車（車種='自行車'）無車牌 → 車號由 buildVehicleRows 產生綁戶號的合成鍵，見 docs/10 Q18。
import { corsHeaders, json, adminClient, fetchHousehold } from '../_shared/http.ts'
import { normalizeHousehold, isValidHousehold } from '../_shared/normalize.ts'
import { buildVehicleRows, isBikeOnly } from '../_shared/vehicles.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const { 戶號, 電話, 社宅, vehicles } = await req.json()

    const hid = normalizeHousehold(戶號)
    if (!hid) return json({ error: '請填寫戶號' }, 400)
    if (!isValidHousehold(hid)) return json({ error: '戶號格式不對（例 H3-6／店面 S1-6）' }, 400)
    if (!Array.isArray(vehicles) || vehicles.length === 0)
      return json({ error: '至少要登記一台車' }, 400)

    const { rows: cleaned, error: vErrMsg } = buildVehicleRows(hid, vehicles)
    if (vErrMsg) return json({ error: vErrMsg }, 400)

    const phone = String(電話 ?? '').trim()
    const db = adminClient()

    // 1) 建戶（戶號 PK；重複 → 已登記過）
    const { error: hErr } = await db
      .from('household')
      .insert({ 戶號: hid, 電話: phone, 社宅: !!社宅 })
    if (hErr) {
      if (hErr.code === '23505')
        return json({ error: `戶號 ${hid} 已登記過，請改用登入查看或修改` }, 409)
      throw hErr
    }

    // 2) 建車（車號 PK；重複 → 已被其他戶登記）。失敗則回滾剛建的戶，避免孤兒。
    const { error: vErr } = await db.from('vehicle').insert(cleaned)
    if (vErr) {
      await db.from('household').delete().eq('戶號', hid)
      if (vErr.code === '23505')
        return json({ error: '其中有車號已被其他戶登記，請確認車號' }, 409)
      if (vErr.code === '23514')
        return json({ error: '車種不正確（限 一般／重機／自行車）' }, 400)
      throw vErr
    }

    // 純自行車戶沒有車牌可當登入憑證 → 之後無法線上查詢/修改，前端據此提示「請臨櫃辦理」。
    return json({ household: await fetchHousehold(db, hid), 僅自行車: isBikeOnly(cleaned) })
  } catch (e) {
    console.error('register error:', e)
    return json({ error: '伺服器錯誤，請稍後再試' }, 500)
  }
})
