// POST /save-wishes  { 戶號, 車位志願[], 志願落選保底, 認證車號 }  → { household } | { error }
// 寫該戶「車位志願序」（戶層級，全戶共用一份）+ 志願落選保底。
// 🔒 擁有權驗證：認證車號（登入時用的車號）必須「目前」屬於該戶，才允許寫入——
//    與 update-household 同招，避免任何人拿公開 anon key 改他戶志願。
import { corsHeaders, json, adminClient, fetchHousehold } from '../_shared/http.ts'
import { normalizeHousehold, isValidHousehold, normalizeTWPlate } from '../_shared/normalize.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const { 戶號, 車位志願, 志願落選保底, 認證車號 } = await req.json()

    const hid = normalizeHousehold(戶號)
    if (!hid) return json({ error: '請填寫戶號' }, 400)
    if (!isValidHousehold(hid)) return json({ error: '戶號格式不對（例 H3-6／店面 S1-6）' }, 400)

    // 志願：去空白、去重、保序的字串陣列
    const seen = new Set<string>()
    const wishes: string[] = []
    if (Array.isArray(車位志願)) {
      for (const x of 車位志願) {
        const id = String(x).trim()
        if (id && !seen.has(id)) {
          seen.add(id)
          wishes.push(id)
        }
      }
    }

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

    const { error } = await db
      .from('household')
      .update({ 車位志願: wishes, 志願落選保底: !!志願落選保底 })
      .eq('戶號', hid)
    if (error) return json({ error: error.message || '儲存失敗，請稍後再試' }, 400)

    return json({ household: await fetchHousehold(db, hid) })
  } catch (e) {
    console.error('save-wishes error:', e)
    return json({ error: '伺服器錯誤，請稍後再試' }, 500)
  }
})
