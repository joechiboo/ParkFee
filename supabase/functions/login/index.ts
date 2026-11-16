// POST /login  { 戶號, 車號 }  → { household } | { household: null } | 429 { error }
// 登入＝戶號 ＋ 任一已登記車號（車號全域唯一，命中且屬該戶才通過）。
//
// 純自行車戶（2026-11-16 使用者定，取代 08-19「純自行車戶不開放線上登入」）：
//   車號欄留空、只打戶號即可登入。保護措施見 _shared/bike-auth.ts（擋掃描、只能改自行車、電話遮住、留紀錄）。
//   自行車的合成車號（自行車-<戶號>-<序>）仍不能當憑證——從戶號就推得出來，等於沒有意義。
// 每次登入（成功、失敗）都寫 login_log（0017）。
import { corsHeaders, json, adminClient, fetchHousehold } from '../_shared/http.ts'
import { isBikeVehicleKey, normalizeHousehold, normalizeTWPlate } from '../_shared/normalize.ts'
import { clientIp, isBikeOnlyHousehold, bikeThrottled, logLogin, maskPhone, THROTTLE_MSG } from '../_shared/bike-auth.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const { 戶號, 車號 } = await req.json()
    const hid = normalizeHousehold(戶號)
    if (!hid) return json({ household: null })
    const db = adminClient()
    const ip = clientIp(req)

    // ── 車號留空：純自行車戶 ──
    if (!String(車號 ?? '').trim()) {
      if (await bikeThrottled(db, ip)) return json({ error: THROTTLE_MSG }, 429)
      const ok = await isBikeOnlyHousehold(db, hid)
      await logLogin(db, { ip, hid, method: 'bike', ok })
      if (!ok) return json({ household: null })
      const h = await fetchHousehold(db, hid)
      return json({ household: h && { ...h, 電話: maskPhone(h.電話), 僅自行車登入: true } })
    }

    // ── 有車號：照舊 ──
    const plate = normalizeTWPlate(車號)
    // 合成車號從戶號即可推得（自行車-<戶號>-1），當憑證等於免密碼 → 一律擋（原始值與正規化後都檢查）
    if (!plate || isBikeVehicleKey(車號) || isBikeVehicleKey(plate)) {
      await logLogin(db, { ip, hid, method: 'plate', ok: false })
      return json({ household: null })
    }
    const { data: v } = await db.from('vehicle').select('戶號').eq('車號', plate).maybeSingle()
    const ok = !!v && v.戶號 === hid
    await logLogin(db, { ip, hid, method: 'plate', ok })
    // 車號不存在、或不屬輸入戶號 → 一律回 null（不洩漏「車號存在但戶號錯」）
    if (!ok) return json({ household: null })
    return json({ household: await fetchHousehold(db, hid) })
  } catch (e) {
    console.error('login error:', e)
    return json({ error: '伺服器錯誤，請稍後再試' }, 500)
  }
})
