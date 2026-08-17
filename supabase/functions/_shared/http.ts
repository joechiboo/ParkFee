// Edge Function 共用：CORS、JSON 回應、admin（service_role）client、整戶查詢、管理員驗證。
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { normalizeHousehold, normalizeTWPlate } from './normalize.ts'

// 額外管理員戶號：真實戶號 + 已登記車牌登入即可管理（免共用密碼）。要加管理員就改這裡。
const ADMIN_HOUSEHOLDS = ['H3-6']

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // 之後可收斂為 GitHub Pages 來源
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// service_role client：繞過 RLS。SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由平台自動注入。
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )
}

// 管理員驗證（寫入/管理讀取用）。任一條成立即通過：
//   A 路：password === ADMIN_PASSWORD secret（admin 帳號用）。
//   B 路：戶號在白名單 + 認證車號確屬該戶（擁有權；H3-6 等真實戶號用，免密碼）。
export async function verifyAdmin(
  db: SupabaseClient,
  body: { password?: string; 戶號?: string; 認證車號?: string },
): Promise<boolean> {
  const secret = Deno.env.get('ADMIN_PASSWORD')
  if (secret && String(body?.password ?? '') === secret) return true // A 路：密碼
  const hid = normalizeHousehold(body?.戶號)
  const plate = normalizeTWPlate(body?.認證車號)
  if (!hid || !plate || !ADMIN_HOUSEHOLDS.includes(hid)) return false
  const { data } = await db.from('vehicle').select('戶號').eq('車號', plate).maybeSingle() // B 路：車牌擁有權
  return !!data && data.戶號 === hid
}

// 取整戶（含車輛，依第幾輛排序）；找不到回 null。
export async function fetchHousehold(db: SupabaseClient, hid: string) {
  const { data: h } = await db
    .from('household')
    .select('戶號, 電話, created_at, 車位志願, 志願落選保底, 社宅')
    .eq('戶號', hid)
    .maybeSingle()
  if (!h) return null
  const { data: vehicles } = await db
    .from('vehicle')
    .select('車號, 戶號, 車種, 第幾輛, 身障, 志願小位, 車位編號, 車位類型, 配位狀態, 簽約期限, 已繳費')
    .eq('戶號', hid)
    .order('第幾輛')
  return {
    戶號: h.戶號,
    電話: h.電話,
    createdAt: h.created_at,
    車位志願: h.車位志願 ?? [],
    志願落選保底: !!h.志願落選保底,
    社宅: !!h.社宅, // 社會住宅住戶：限公益位（2026-08-16 Q7）
    vehicles: vehicles ?? [],
  }
}
