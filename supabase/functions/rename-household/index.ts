// POST /rename-household  { 舊戶號, 新戶號, password | (戶號, 認證車號) }  → { 戶號, 車輛數 } | { error }
// 更正戶號（2026-11-10）：住戶把戶號填錯時，由管理員改成正確的戶號。🔒 僅管理員。
// 整戶的電話、志願、車輛、已選定車位、繳費紀錄一起搬（資料庫函式 app_rename_household，單一交易）。
// 新戶號必須是社區實際有的戶；舊戶號不檢查格式（本來就是填錯的）。
// 不受登記時窗限制：截止後發現填錯仍要能改，否則出帳會對不到門牌。
import { corsHeaders, json, adminClient, verifyAdmin, audit } from '../_shared/http.ts'
import { normalizeHousehold, householdProblem } from '../_shared/normalize.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const body = await req.json()
    const db = adminClient()
    if (!(await verifyAdmin(db, body))) return json({ error: '管理員驗證失敗' }, 403)

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
