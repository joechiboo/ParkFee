// POST /rename-household  { 舊戶號, 新戶號, password | (戶號, 認證車號) }  → { 戶號, 車輛數 } | { error }
// POST /rename-household  { op: 'list', ...同上憑證 }  → { households: [整戶資料（含電話、車輛）] }
//   名冊維護頁（/roster）用：列出全部登記供檢視、匯出、修改、更正戶號。含個資，每次撈都寫稽核（只記戶數）。
// POST /rename-household  { op: 'delete', 戶號目標, ...同上憑證 }  → { 戶號, 車輛數, 釋出車位 }（2026-11-16，見下方）
// 更正戶號（2026-11-10）：住戶把戶號填錯時，由管理員改成正確的戶號。🔒 僅管理員。
// 整戶的電話、志願、車輛、已選定車位、繳費紀錄一起搬（資料庫函式 app_rename_household，單一交易）。
// 新戶號必須是社區實際有的戶；舊戶號不檢查格式（本來就是填錯的）。
// 不受登記時窗限制：截止後發現填錯仍要能改，否則出帳會對不到門牌。
import { corsHeaders, json, adminClient, verifyAdmin, audit, fetchHousehold } from '../_shared/http.ts'
import { normalizeHousehold, householdProblem } from '../_shared/normalize.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const body = await req.json()
    const db = adminClient()
    if (!(await verifyAdmin(db, body))) return json({ error: '管理員驗證失敗' }, 403)

    if (body.op === 'list') {
      const { data: hs, error: hErr } = await db.from('household').select('戶號').order('戶號')
      if (hErr) return json({ error: hErr.message }, 400)
      const households = (await Promise.all((hs || []).map((h) => fetchHousehold(db, h.戶號 as string)))).filter(Boolean)
      await audit(db, 'roster.list', { body, detail: { 戶數: households.length, via: 'roster-admin' } })
      return json({ households })
    }

    // 刪除整戶登記（2026-11-16）：同一戶用錯的舊戶號與正確戶號各登記一次、或確認不是住戶時用。
    //   已繳費的車不給刪（退費要先走帳），其餘整戶刪掉，該戶佔的車位一併放回可選。
    //   順序：先記下佔用的車位 → 刪戶（車輛跟著 cascade）→ 再解鎖。萬一解鎖失敗，留下的是「鎖著沒人用」的格，
    //   只是暫時不能選、不會被兩人搶到；反過來先解鎖再刪戶失敗，才會出現車位被重複配出去。
    //   稽核記戶號、車號與釋出的車位（車號是指涉用的識別，不記電話）；內容可從每日快照查回。
    if (body.op === 'delete') {
      const hid = String(body.戶號目標 ?? '').normalize('NFKC').replace(/\s+/g, '').toUpperCase()
      if (!hid) return json({ error: '請指定要刪除的戶號' }, 400)
      const { data: vs, error: vErr } = await db.from('vehicle').select('車號, 車位編號, 已繳費').eq('戶號', hid)
      if (vErr) return json({ error: vErr.message }, 400)
      const { data: h } = await db.from('household').select('戶號').eq('戶號', hid).maybeSingle()
      if (!h) return json({ error: `查無戶號 ${hid}` }, 404)
      if ((vs || []).some((v) => v.已繳費))
        return json({ error: `${hid} 有已繳費的車，不能直接刪除。請先處理退費，再到維護頁解除車位` }, 409)
      const seats = (vs || []).flatMap((v) => String(v.車位編號 || '').split('、').map((s) => s.trim()).filter(Boolean))
      const { error: dErr } = await db.from('household').delete().eq('戶號', hid)
      if (dErr) {
        await audit(db, 'household.delete', { body, target: hid, ok: false, detail: { error: dErr.message } })
        return json({ error: dErr.message }, 400)
      }
      if (seats.length) await db.from('locked_seat').delete().in('車位編號', seats)
      await audit(db, 'household.delete', { body, target: hid, detail: { 車號: (vs || []).map((v) => v.車號), 釋出車位: seats } })
      return json({ 戶號: hid, 車輛數: (vs || []).length, 釋出車位: seats })
    }

    // 舊戶號只做全形、空白、大小寫的整理，不補店面樓層：要能對到資料庫裡填錯的原樣。
    const oldId = String(body.舊戶號 ?? '').normalize('NFKC').replace(/\s+/g, '').toUpperCase()
    const newId = normalizeHousehold(body.新戶號)
    if (!oldId) return json({ error: '請填寫原戶號' }, 400)
    const problem = householdProblem(newId)
    if (problem) return json({ error: `新戶號有誤：${problem}` }, 400)
    if (oldId === newId) return json({ error: '新舊戶號相同' }, 400)

    const { data, error } = await db.rpc('app_rename_household', { p_old: oldId, p_new: newId })
    if (error) {
      await audit(db, 'household.rename', { body, target: `${oldId}→${newId}`, ok: false, detail: { error: error.message } })
      return json({ error: error.message }, 400)
    }
    await audit(db, 'household.rename', { body, target: `${oldId}→${newId}`, detail: { 車輛數: data } })
    return json({ 戶號: newId, 車輛數: data })
  } catch (e) {
    console.error('rename-household error:', e)
    return json({ error: '伺服器錯誤，請稍後再試' }, 500)
  }
})
