// 純自行車戶的「空白車號登入」（2026-11-16 使用者定）：自行車沒有車牌，車號欄留空、只打戶號即可登入。
//
// ⚠️ 戶號不是秘密，這等於只靠戶號。保護措施（都不需要住戶多輸入東西）：
//   ① 擋掃描：同一網路位址一小時內用空白車號「失敗」超過 BIKE_LIMIT_PER_HOUR 次 → 暫時擋。不鎖住戶帳號
//      （鎖帳號的話，有心人對每一戶故意輸錯就能把大家都鎖住）。
//      只算失敗（11/16 改）：櫃台用同一台電腦幫多位住戶登入、住戶登入後每換一頁會自動重抓資料，
//      成功也算的話正常使用就會被鎖。掃描的人不知道哪幾戶是純自行車戶，絕大多數會失敗，照樣擋得住。
//   ② 權限縮小：只限「整戶只有自行車」的戶；只能改自行車、不能加機車（免得替別人加一台被收 1,200 元）、
//      不能改電話（電話回傳時遮住）。要加機車或改電話請洽管理中心。
//   ③ 留紀錄：每次登入寫 login_log（0017），每次修改寫稽核，內容可從每日快照還原。
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export const BIKE_LIMIT_PER_HOUR = 30

// 呼叫端的網路位址（Supabase Edge 前面有 proxy，取 x-forwarded-for 第一個）
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') || ''
  return (xff.split(',')[0] || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || '').trim()
}

// 整戶只有自行車（沒有任何機車、重機）才算。戶不存在也回 false。
export async function isBikeOnlyHousehold(db: SupabaseClient, hid: string): Promise<boolean> {
  if (!hid) return false
  const { data } = await db.from('vehicle').select('車種').eq('戶號', hid)
  return !!data && data.length > 0 && data.every((v) => v.車種 === '自行車')
}

// 這個網路位址最近一小時用空白車號失敗了幾次
export async function bikeThrottled(db: SupabaseClient, ip: string): Promise<boolean> {
  const since = new Date(Date.now() - 3600 * 1000).toISOString()
  const { count, error } = await db
    .from('login_log')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .eq('method', 'bike')
    .eq('ok', false)
    .gte('at', since)
  if (error) console.error('login_log count failed', error) // 查不到就放行（不能因紀錄表故障擋住所有住戶），但要留下錯誤
  return (count ?? 0) >= BIKE_LIMIT_PER_HOUR
}

// 寫登入紀錄；失敗不影響登入本身。
export async function logLogin(db: SupabaseClient, row: { ip: string; hid: string; method: string; ok: boolean }) {
  try {
    const { error } = await db.from('login_log').insert(row)
    if (error) console.error('login_log insert failed', error)
  } catch (e) {
    console.error('login_log failed', e)
  }
}

// 電話遮住中間：0912-345-678 → 09**-***-678（空白車號登入的人看不到完整電話）
export function maskPhone(p: unknown): string {
  const d = String(p ?? '').replace(/[^0-9]/g, '')
  if (d.length < 6) return d ? '***' : ''
  return `${d.slice(0, 2)}**-***-${d.slice(-3)}`
}

export const THROTTLE_MSG = '嘗試次數過多，請一小時後再試，或洽管理中心'
