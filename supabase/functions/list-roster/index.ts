// POST /list-roster —— 管理員取得完整登記名冊（供 /allocate 直接抽籤、/export 匯出）。
// 🔒 需管理員驗證（ADMIN_PASSWORD 或管理員戶號＋車牌，同 assign-seat）。
//
// 為什麼要有這支：`household`／`vehicle` 是 RLS deny-all，前端 anon key 讀不到，
//   原本只能靠 `scripts/export-roster.mjs`（需 service_role）產 CSV 再從 /dev 匯入兩步。
//   有了這支，物業在瀏覽器按一顆鈕就能載入真實名冊 —— 12/1 抽籤日不必帶 service_role key 出門。
//
// 回傳 rows 的欄位＝ registry.js 的 REGISTRATION_COLUMNS，與 export-roster.mjs 產的 CSV 同構，
//   前端可直接餵 buildRoster()。
import { corsHeaders, json, adminClient, verifyAdmin } from '../_shared/http.ts'

const yn = (b: unknown) => (b ? 'Y' : 'N')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const body = await req.json()
    const db = adminClient()
    if (!(await verifyAdmin(db, body))) return json({ error: '管理員驗證失敗' }, 403)

    const { data: households, error: he } = await db
      .from('household')
      .select('戶號, 電話, 車位志願, 志願落選保底, 社宅, 工作人員, created_at')
    if (he) return json({ error: he.message }, 400)

    const { data: vehicles, error: ve } = await db
      .from('vehicle')
      .select('車號, 戶號, 車種, 第幾輛, 身障, 志願小位, 車位編號, 已繳費')
      .order('戶號')
      .order('第幾輛')
    if (ve) return json({ error: ve.message }, 400)

    const byId = new Map((households ?? []).map((h: Record<string, unknown>) => [h.戶號, h]))
    const rows = (vehicles ?? []).map((v: Record<string, unknown>) => {
      const h = (byId.get(v.戶號) ?? {}) as Record<string, unknown>
      return {
        戶號: v.戶號,
        車號: v.車號,
        車種: v.車種,
        第幾輛: v.第幾輛,
        身障: yn(v.身障),
        志願小位: yn(v.志願小位),
        登記時間: h.created_at ?? '',
        聯絡電話: h.電話 ?? '',
        // 戶層級；buildRoster 會再傳播到同戶各列（車位志願／社宅／工作人員皆同）
        車位志願: Array.isArray(h.車位志願) ? (h.車位志願 as string[]).join('、') : '',
        志願落選保底: yn(h.志願落選保底),
        社宅: yn(h.社宅),
        工作人員: yn(h.工作人員),
        來源: '線上',
        車位編號: v.車位編號 ?? '', // 物業抽籤前已指派者；重機為兩位頓號分隔
        已繳費: yn(v.已繳費),
      }
    })

    return json({
      rows,
      戶數: new Set(rows.map((r) => r.戶號)).size,
      台數: rows.length,
      產生時間: new Date().toISOString(),
    })
  } catch (e) {
    console.error('list-roster error:', e)
    return json({ error: '伺服器錯誤，請稍後再試' }, 500)
  }
})
