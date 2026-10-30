// POST /claim-seat —— 住戶線上「志願小位」：登記時直接選定一個一般小機車位並當場鎖定。
//   { op: 'claim', 戶號, 車位編號, 認證車號 }   → { household }
//   { op: 'release', 戶號, 認證車號 }           → { household }
//
// 依據：辦法伍二（五）志願小位免抽籤、依登記順序選位；2026-10-29 臨時管委會：登記與選位同一動作、
//   限每戶第一輛一般機車（docs/34）。登記順序＝鎖定當下，先到先得。
//
// 鎖的實作：沿用公開表 locked_seat 的主鍵互斥 —— insert 撞 23505 ＝ 已被選走，不需另開表或 DB function。
//   選位頁／抽籤引擎本就把 locked_seat 視為不可選／不進池，所以鎖下去後：
//     · 其他住戶地圖上立刻變「已承租」不可點（refreshLocked）
//     · export-roster 帶出 車位編號 → distribute 以 preset 跳過、不重複配位
//     · 櫃台在 SeatAdminView 看得到該格掛哪台車，可解鎖（逾期未繳）或標已繳費
//
// 安全：擁有權驗證同 save-wishes（認證車號須目前屬於該戶）；車位型別以伺服器端清單為準
//   （_shared/seat-types.ts，由腳本自 b1-classification 產生），不信前端帶來的型別。
//
// 開放時窗（2026-10-30 會議定：11/15 00:00 – 11/30 23:59 台北時間）：預設寫死在 DEFAULT_WINDOW；
//   測試期要提前開放可設環境變數 CLAIM_WINDOW="2026-10-01..2026-12-31" 覆蓋（supabase secrets set），上線前記得刪掉。
//   CLAIM_OPEN_HOUR（如 "08"）可另限每日幾點起開放，會議未要求 → 不設。
import { corsHeaders, json, adminClient, verifyOwnership, fetchHousehold, audit } from '../_shared/http.ts'
import { normalizeHousehold, isValidHousehold } from '../_shared/normalize.ts'
import { isSmallGeneralSeat } from '../_shared/seat-types.ts'

const STATUS_CLAIM = '志願小位' // 與 SeatAdminView 櫃台指派同一個狀態字，結果頁／維護頁不用分流

function taipeiNow(): { date: string; hour: number } {
  const t = new Date(Date.now() + 8 * 3600 * 1000)
  return { date: t.toISOString().slice(0, 10), hour: t.getUTCHours() }
}

// 回傳 null＝開放；否則回拒絕訊息。
const DEFAULT_WINDOW = '2026-11-15..2026-11-30'

function windowCheck(): string | null {
  const win = Deno.env.get('CLAIM_WINDOW') || DEFAULT_WINDOW
  const { date, hour } = taipeiNow()
  if (win) {
    const [from, to] = win.split('..').map((s) => s.trim())
    if (from && date < from) return `志願小位尚未開放選定（${from.replaceAll('-', '/')} 起）`
    if (to && date > to) return `志願小位選定已於 ${to.replaceAll('-', '/')} 截止`
  }
  const openHour = Number(Deno.env.get('CLAIM_OPEN_HOUR') ?? '')
  if (Number.isFinite(openHour) && openHour > 0 && hour < openHour)
    return `志願小位每日 ${String(openHour).padStart(2, '0')}:00 起開放選定`
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const body = await req.json()
    const hid = normalizeHousehold(body.戶號)
    if (!hid || !isValidHousehold(hid)) return json({ error: '戶號格式不對' }, 400)

    const db = adminClient()
    if (!(await verifyOwnership(db, hid, body))) return json({ error: '驗證失敗：請使用登入時的車號再試' }, 403)

    const { data: h } = await db.from('household').select('社宅, 工作人員').eq('戶號', hid).maybeSingle()
    if (!h) return json({ error: '查無此戶登記' }, 404)
    if (h.工作人員) return json({ error: '社區工作人員配位排在全體住戶之後，不適用志願小位' }, 403)
    if (h.社宅) return json({ error: '社會住宅住戶由社宅單位安排公益位，不適用志願小位' }, 403)

    // 限每戶第一輛一般機車（2026-10-29 決議；重機不適用小位）。
    const { data: first } = await db
      .from('vehicle')
      .select('車號, 車種, 車位編號, 配位狀態, 已繳費')
      .eq('戶號', hid)
      .eq('第幾輛', 1)
      .neq('車種', '自行車')
      .maybeSingle()
    if (!first) return json({ error: '查無第一輛機車登記' }, 404)
    if (first.車種 !== '一般') return json({ error: '志願小位限一般機車（重機不適用）' }, 403)

    const held = first.配位狀態 === STATUS_CLAIM && first.車位編號 ? String(first.車位編號) : null

    if (body.op === 'release') {
      if (!held) return json({ error: '目前沒有選定中的志願小位' }, 400)
      if (first.已繳費) return json({ error: '已完成繳費的車位不能線上取消，請洽管理中心' }, 403)
      await db.from('locked_seat').delete().eq('車位編號', held)
      const { error } = await db
        .from('vehicle')
        .update({ 車位編號: null, 車位類型: null, 配位狀態: null, 已繳費: false, 簽約期限: null })
        .eq('車號', first.車號)
      if (error) return json({ error: error.message }, 400)
      await audit(db, 'seat.release', { body, target: held, detail: { 車號: first.車號, by: 'resident' } })
      return json({ household: await fetchHousehold(db, hid) })
    }

    if (body.op !== 'claim') return json({ error: '未知 op' }, 400)

    const seat = String(body.車位編號 ?? '').trim()
    if (!seat) return json({ error: '請先在地圖上點一個小位' }, 400)
    if (!isSmallGeneralSeat(seat)) return json({ error: `車位 ${seat} 不是一般小機車位` }, 400)

    const closed = windowCheck()
    if (closed) return json({ error: closed }, 403)

    // 這台車已經有位（櫃台指派／抽籤結果／已繳費）→ 不給線上改。只有「自己線上選的、尚未繳費」可以換。
    if (first.車位編號 && !held) return json({ error: `第一輛已有車位 ${first.車位編號}，如需變更請洽管理中心` }, 409)
    if (held && first.已繳費) return json({ error: '已完成繳費的車位不能線上變更，請洽管理中心' }, 403)
    if (held === seat) return json({ household: await fetchHousehold(db, hid) })

    // 先搶鎖：主鍵互斥 → 23505 就是被人選走了。
    const { error: lkErr } = await db.from('locked_seat').insert({ 車位編號: seat })
    if (lkErr) {
      if (lkErr.code === '23505') {
        await audit(db, 'seat.claim', { body, target: seat, ok: false, detail: { reason: 'taken' } })
        return json({ error: `車位 ${seat} 剛被其他住戶選走了，請改選其他小位`, taken: true }, 409)
      }
      return json({ error: lkErr.message }, 400)
    }

    const { error: vErr } = await db
      .from('vehicle')
      .update({ 車位編號: seat, 車位類型: '小', 配位狀態: STATUS_CLAIM, 志願小位: true, 已繳費: false })
      .eq('車號', first.車號)
    if (vErr) {
      await db.from('locked_seat').delete().eq('車位編號', seat) // 寫車失敗就把鎖還回去，不留死格
      return json({ error: vErr.message }, 400)
    }
    // 換位：新格到手後才放掉舊格（順序反過來會有一瞬間兩格都沒鎖）。
    if (held) await db.from('locked_seat').delete().eq('車位編號', held)

    await audit(db, 'seat.claim', { body, target: seat, detail: { 車號: first.車號, 換自: held ?? '-' } })
    return json({ household: await fetchHousehold(db, hid) })
  } catch (e) {
    console.error('claim-seat error:', e)
    return json({ error: '伺服器錯誤，請稍後再試' }, 500)
  }
})
