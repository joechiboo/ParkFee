// 心跳 Edge Function：更新 keepalive 表時間戳（service_role）。
// 用途：GitHub Actions 每日呼叫 → 產生真實 DB 寫入活動，防免費版閒置暫停。
// 無需驗證（寫入內容固定為 now()，被外人狂打也無害）；回 { ok, at, auditOk }。
//
// ── 順帶當「稽核斷線偵測」的哨兵（2026-09-21 加）──────────────────────────
// 背景：`audit()` 刻意不拋錯（稽核失敗不該讓使用者的操作跟著失敗），代價是
//   壞掉時完全無聲 —— 2026-09-18 就發生過：`0013_audit_log.sql` 漏了
//   `grant all ... to service_role`，表在、RLS 對、卻一筆都寫不進去，
//   是人工去查才發現的。稽核系統最怕這個：出事時才知道那段期間根本沒在記。
//
// 作法：**寫一筆再讀回來**，而不是只讀。只讀證明不了寫得進去（9/18 那次正是
//   讀得到表結構卻寫不進去）。寫入 action='system.ping' 的哨兵列，
//   隨即查最近 2 分鐘內有沒有這筆 —— 有＝稽核鏈路完好。
//   每天一列、一年 365 列，量可忽略；查稽核時用 `action <> 'system.ping'` 濾掉即可。
import { adminClient, json, audit } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({}, 200)
  const db = adminClient()
  const at = new Date().toISOString()

  const { error } = await db.from('keepalive').upsert({ id: 1, at })
  if (error) return json({ error: error.message }, 500)

  // 哨兵：寫一筆稽核，再讀回來確認真的進得去。
  await audit(db, 'system.ping', { target: '-', detail: { at } })
  const since = new Date(Date.now() - 2 * 60 * 1000).toISOString()
  const { data: probe, error: readErr } = await db
    .from('audit_log')
    .select('id')
    .eq('action', 'system.ping')
    .gte('at', since)
    .limit(1)

  const auditOk = !readErr && Array.isArray(probe) && probe.length > 0
  return json({
    ok: true,
    at,
    auditOk,
    // 讀不到時把原因帶出來，workflow 的錯誤訊息才看得出是權限還是別的問題
    auditError: auditOk ? undefined : readErr?.message || '寫入後讀不到哨兵列',
  })
})
