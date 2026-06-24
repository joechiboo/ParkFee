// Edge Function 共用：CORS、JSON 回應、admin（service_role）client、整戶查詢。
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

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

// 取整戶（含車輛，依第幾輛排序）；找不到回 null。
export async function fetchHousehold(db: SupabaseClient, hid: string) {
  const { data: h } = await db
    .from('household')
    .select('戶號, 電話, created_at, 車位志願, 志願落選保底')
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
    vehicles: vehicles ?? [],
  }
}
