// POST /assign-seat —— 物業指派/解除「保留．志願小位．無障礙」車位（抽籤前確定+繳費）。
// 🔒 需管理員密碼（ADMIN_PASSWORD）。安全分流：
//   - 車位 id 寫公開的 locked_seat（選位/抽籤排除用，無個資）。
//   - 戶號/車號/繳費 寫 RLS deny-all 的 vehicle（只該戶 login 或本函式讀得到）。
// op：
//   list   → 回傳目前鎖定清單 + 各位指派（管理員專屬讀，含個資）。
//   assign → 鎖定該位；若帶車號則把該車指派到此位（寫 vehicle）。
//   unlock → 解鎖該位；若帶車號則清掉該車的指派。
import { corsHeaders, json, adminClient, verifyAdmin } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const body = await req.json()
    const db = adminClient()
    if (!(await verifyAdmin(db, body))) return json({ error: '管理員驗證失敗' }, 403)
    const op = body.op

    if (op === 'list') {
      // 「不可選」的位 = locked_seat（物業指派/保留/維修） ∪ vehicle 已分配（抽籤回填）。
      // → 抽籤後物業代選落選戶時，不會誤選到中籤者已得的位。
      const { data: locks } = await db.from('locked_seat').select('車位編號')
      const lockedIds = new Set((locks || []).map((l: { 車位編號: string }) => String(l.車位編號)))

      const { data: vs } = await db
        .from('vehicle')
        .select('車號, 戶號, 車種, 車位編號, 配位狀態, 已繳費')
        .not('車位編號', 'is', null)

      // 一台車的車位編號可能是「150、151」(重機雙位) → 逐位攤平到 seat→vehicle。
      const bySeat = new Map<string, Record<string, unknown>>()
      for (const v of vs || []) {
        for (const id of String(v.車位編號).split('、').map((s) => s.trim()).filter(Boolean)) {
          bySeat.set(id, v)
        }
      }

      const allIds = new Set<string>([...lockedIds, ...bySeat.keys()])
      const assignments = [...allIds].map((id) => {
        const v = bySeat.get(id)
        return {
          車位編號: id,
          戶號: v?.戶號 ?? null,
          車號: v?.車號 ?? null,
          車種: v?.車種 ?? null,
          配位狀態: v?.配位狀態 ?? null,
          已繳費: v?.已繳費 ?? false,
          locked: lockedIds.has(id), // true＝物業鎖定(可解鎖)；false＝抽籤分配(僅顯示、不可解鎖)
        }
      })
      return json({ assignments })
    }

    const seat = String(body.車位編號 ?? '').trim()
    if (!seat) return json({ error: '缺少車位編號' }, 400)
    const plate = String(body.車號 ?? '').trim().toUpperCase()

    if (op === 'assign') {
      // 公益位資格檢查（2026-08-16 Q7）：公益位＝社宅戶專用，一般戶不得承租；
      // 反之社宅戶亦不應被指派到一般位。物業指派會繞過配位引擎的分流，故在此攔一次。
      // 車位是否公益由前端帶入（公益編號清單在前端 seat-id.js／spaces.js）；管理員為可信端，
      // 此處目的是防手誤而非防惡意 → 不符時回 needsConfirm，前端確認後帶 強制:true 再送。
      if (plate && !body.強制) {
        const { data: v } = await db.from('vehicle').select('戶號').eq('車號', plate).maybeSingle()
        if (v?.戶號) {
          const { data: h } = await db
            .from('household')
            .select('社宅')
            .eq('戶號', v.戶號)
            .maybeSingle()
          const isSocial = h?.社宅 === true
          const isPublicSeat = body.車位公益 === true
          if (isSocial !== isPublicSeat) {
            return json({
              needsConfirm: true,
              error: isSocial
                ? `${v.戶號} 是社會住宅住戶，依辦法伍二（二）限承租公益設施車位，此位並非公益位。`
                : `車位 ${seat} 為公益設施車位（社宅戶專用），${v.戶號} 並非社會住宅住戶。`,
            }, 409)
          }
        }
      }
      const { error: lkErr } = await db.from('locked_seat').upsert({ 車位編號: seat })
      if (lkErr) return json({ error: lkErr.message }, 400)
      if (plate) {
        const { error: vErr } = await db
          .from('vehicle')
          .update({
            車位編號: seat,
            車位類型: body.車位類型 || null,
            配位狀態: body.配位狀態 || '分配',
            已繳費: !!body.已繳費,
          })
          .eq('車號', plate)
        if (vErr) return json({ error: vErr.message }, 400)
      }
      return json({ ok: true })
    }

    if (op === 'unlock') {
      const { error: dErr } = await db.from('locked_seat').delete().eq('車位編號', seat)
      if (dErr) return json({ error: dErr.message }, 400)
      if (plate) {
        await db
          .from('vehicle')
          .update({ 車位編號: null, 車位類型: null, 配位狀態: null, 已繳費: false, 簽約期限: null })
          .eq('車號', plate)
      }
      return json({ ok: true })
    }

    return json({ error: '未知 op' }, 400)
  } catch (e) {
    console.error('assign-seat error:', e)
    return json({ error: '伺服器錯誤，請稍後再試' }, 500)
  }
})
