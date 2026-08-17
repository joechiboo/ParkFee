// POST /register  { 戶號, 電話, 社宅?, vehicles:[{車號,車種,身障,志願小位}] }
// → { household } | { error }
// 登記即註冊：建戶 + 建車。戶號/車號皆 PK，重複由 DB 唯一鍵擋下。
import { corsHeaders, json, adminClient, fetchHousehold } from '../_shared/http.ts'
import { normalizeHousehold, isValidHousehold, normalizeTWPlate } from '../_shared/normalize.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const { 戶號, 電話, 社宅, vehicles } = await req.json()

    const hid = normalizeHousehold(戶號)
    if (!hid) return json({ error: '請填寫戶號' }, 400)
    if (!isValidHousehold(hid)) return json({ error: '戶號格式不對（例 H3-6／店面 S1-6）' }, 400)
    if (!Array.isArray(vehicles) || vehicles.length === 0)
      return json({ error: '至少要登記一台機車' }, 400)

    // 正規化 + 同次提交內查重
    const cleaned: Array<Record<string, unknown>> = []
    const seen = new Set<string>()
    for (let i = 0; i < vehicles.length; i++) {
      const plate = normalizeTWPlate(vehicles[i]?.車號)
      if (!plate) return json({ error: `第 ${i + 1} 台未填車號` }, 400)
      if (seen.has(plate)) return json({ error: `車號 ${plate} 重複填寫` }, 400)
      seen.add(plate)
      cleaned.push({
        車號: plate,
        戶號: hid,
        車種: vehicles[i].車種 === '重機' ? '重機' : '一般',
        第幾輛: i + 1,
        身障: !!vehicles[i].身障,
        志願小位: !!vehicles[i].志願小位,
      })
    }

    const db = adminClient()

    // 1) 建戶（戶號 PK；重複 → 已登記過）
    const { error: hErr } = await db
      .from('household')
      .insert({ 戶號: hid, 電話: String(電話 ?? '').trim(), 社宅: !!社宅 })
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
      throw vErr
    }

    return json({ household: await fetchHousehold(db, hid) })
  } catch (e) {
    console.error('register error:', e)
    return json({ error: '伺服器錯誤，請稍後再試' }, 500)
  }
})
