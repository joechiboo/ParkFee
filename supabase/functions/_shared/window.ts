// 登記開放時窗（2026-10-30 會議定：11/15 00:00 – 11/30 23:59 台北時間，含兩端）。
// register、update-household、save-wishes、claim-seat 共用；登入與查詢不受限。
// 測試期或試玩可用 secret 覆蓋：supabase secrets set CLAIM_WINDOW="2026-10-01..2026-12-31"，上線前 unset。
// 管理員是否豁免由各函式自行判斷（櫃台補登紙本走 verifyAdmin）。
export const DEFAULT_WINDOW = '2026-11-15..2026-11-30'

// 回傳 null＝開放；否則回拒絕訊息。純函式，方便測邊界。
export function closedMessage(win: string, nowMs: number, label: string): string | null {
  const today = new Date(nowMs + 8 * 3600 * 1000).toISOString().slice(0, 10) // 台北日期
  const [from, to] = win.split('..').map((s) => s.trim())
  if (from && today < from) return `${label}尚未開放（${from.replaceAll('-', '/')} 起）`
  if (to && today > to) return `${label}已於 ${to.replaceAll('-', '/')} 截止，如需協助請洽管理中心`
  return null
}

export function windowClosed(label: string): string | null {
  return closedMessage(Deno.env.get('CLAIM_WINDOW') || DEFAULT_WINDOW, Date.now(), label)
}
