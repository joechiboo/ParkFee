// POST /update-household  { 戶號, 電話, 社宅?, 工作人員?, vehicles, 認證車號 }  → { household } | { error }
// 編輯既有戶：整批取代車輛 + 改電話。戶號不可變。可一併增刪自行車（車號由後端合成，前端不送）。
// 🔒 擁有權驗證：見 http.ts verifyOwnership——認證車號須「目前」屬於該戶，
//    否則任何人拿公開 anon key 就能竄改他戶登記。自行車的合成車號不算憑證。
// 認證車號留空＝純自行車戶（2026-11-16，見 _shared/bike-auth.ts）：只限整戶只有自行車的戶；不能改電話與身分旗標；
//    同一網路位址有次數上限；每次修改寫稽核（含網路位址與新增的機車車號）。
//    可以加機車（11/16 使用者定：12/1 才抽，冒用可在抽籤前從稽核撈出確認）；加了之後就不再是純自行車戶，以後改用車號登入。
import { corsHeaders, json, adminClient, fetchHousehold, verifyOwnership, verifyAdmin, audit } from '../_shared/http.ts'
import { windowClosed } from '../_shared/window.ts'
import { normalizeHousehold } from '../_shared/normalize.ts'
import { buildVehicleRows, isBikeOnly, plateTakenElsewhere } from '../_shared/vehicles.ts'
import { clientIp, isBikeOnlyHousehold, bikeThrottled, logLogin, maskPhone, THROTTLE_MSG } from '../_shared/bike-auth.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const { 戶號, 電話, 社宅, 工作人員, vehicles, 認證車號, admin } = await req.json()

    const hid = normalizeHousehold(戶號)
    if (!hid) return json({ error: '請填寫戶號' }, 400)
    if (!Array.isArray(vehicles) || vehicles.length === 0)
      return json({ error: '至少要保留一台車' }, 400)

    const db = adminClient()

    // 管理員代改（名冊維護頁，2026-11-10）：body.admin 帶管理員憑證（密碼，或管理員戶號＋車牌）。
    // 通過者可改任一戶：不驗擁有權、不受登記時窗限制、可只留自行車（等同臨櫃辦理），並寫稽核。
    const byAdmin = !!admin && (await verifyAdmin(db, admin))

    // 純自行車戶：認證車號留空
    const bikeAuth = !byAdmin && !String(認證車號 ?? '').trim()
    const ip = clientIp(req)
    if (bikeAuth) {
      if (await bikeThrottled(db, ip)) return json({ error: THROTTLE_MSG }, 429)
      const ok = await isBikeOnlyHousehold(db, hid)
      await logLogin(db, { ip, hid, method: 'bike', ok })
      if (!ok) return json({ error: '驗證失敗：請使用登入時的車號再試' }, 403)
      const closed = windowClosed('登記資料修改')
      if (closed) return json({ error: closed }, 403)
    } else if (!byAdmin) {
      // 🔒 擁有權驗證：認證車號目前須屬於 hid
      if (!(await verifyOwnership(db, hid, { 認證車號 })))
        return json({ error: '驗證失敗：請使用登入時的車號再試' }, 403)

      // 登記時窗：管理員戶號修改自己的登記可豁免。
      const closed = windowClosed('登記資料修改')
      if (closed && !(await verifyAdmin(db, { 戶號: hid, 認證車號 }))) return json({ error: closed }, 403)
    }

    const { rows: cleaned, error: vErrMsg } = buildVehicleRows(hid, vehicles)
    if (vErrMsg) return json({ error: vErrMsg }, 400)

    // 原本「線上不可只保留自行車」是因為刪掉最後一台機車就沒有登入憑證；
    // 11/16 起純自行車戶可空白車號登入，改成只要求留電話（櫃台要靠電話聯絡）。
    const stored = bikeAuth ? (await db.from('household').select('電話').eq('戶號', hid).maybeSingle()).data : null
    const phone = bikeAuth ? String(stored?.電話 ?? '') : String(電話 ?? '').trim()
    if (!byAdmin && isBikeOnly(cleaned) && !phone)
      return json({ error: '只登記自行車時電話為必填（自行車沒有車牌，櫃台要靠電話聯絡）' }, 400)

    const taken = await plateTakenElsewhere(db, hid, cleaned)
    if (taken) return json({ error: taken }, 409)

    // 原子整批取代（含跨戶車號衝突檢查）
    const { error } = await db.rpc('app_update_household', {
      p_hid: hid,
      p_phone: phone,
      p_vehicles: cleaned,
    })
    if (error) return json({ error: error.message || '更新失敗，請稍後再試' }, 400)

    // 社宅／工作人員旗標（RPC 未涵蓋的戶欄位，另行更新；省一次 RPC 改版）
    const 戶旗標: Record<string, boolean> = {}
    if (社宅 !== undefined) 戶旗標.社宅 = !!社宅
    if (工作人員 !== undefined) 戶旗標.工作人員 = !!工作人員
    if (!bikeAuth && Object.keys(戶旗標).length) await db.from('household').update(戶旗標).eq('戶號', hid)

    if (byAdmin) await audit(db, 'household.update', { body: admin, target: hid, detail: { 車輛數: cleaned.length } })
    if (bikeAuth) {
      const 新增機車 = cleaned.filter((r) => r.車種 !== '自行車').map((r) => r.車號)
      await audit(db, 'household.update', { body: { 戶號: hid }, target: hid, detail: { via: '空白車號（純自行車戶）', ip, 車輛數: cleaned.length, ...(新增機車.length ? { 新增機車 } : {}) } })
    }
    const h = await fetchHousehold(db, hid)
    // 還是純自行車戶 → 電話照樣遮住、維持空白車號登入；加了機車 → 回完整資料，前端改用那台機車的車號當登入憑證
    const stillBike = bikeAuth && isBikeOnly(cleaned)
    return json({ household: stillBike && h ? { ...h, 電話: maskPhone(h.電話), 僅自行車登入: true } : h })
  } catch (e) {
    console.error('update-household error:', e)
    return json({ error: '伺服器錯誤，請稍後再試' }, 500)
  }
})
