-- 繳費旗標的「來源」與「時間」：區分櫃台指派時勾的、還是 12/11 從社區幫匯出批次標的。
--
-- 為什麼要有（2026-11-03）：已繳費只是一個 bool，批次從社區幫餵回來之後，
-- 維護頁看到 ✓繳 分不出是櫃台當場收的還是社區幫對帳來的；住戶爭執「我明明繳了／我沒繳你怎麼標我繳了」
-- 時要能回答「這筆是 12/11 依社區幫匯出批次標的」。稽核表（audit_log）只記筆數，不記到車，
-- 所以每台車自己要帶來源。
--
-- 值：'櫃台指派'（assign-seat op=assign 勾已繳費）、'社區幫 2026-12-11'（op=pay 批次，來源字串由腳本帶）。
-- 解除車位（op=unlock）時與已繳費一起清空。

alter table public.vehicle
  add column if not exists 繳費來源 text,
  add column if not exists 繳費時間 timestamptz;

comment on column public.vehicle.繳費來源 is '已繳費旗標的來源：櫃台指派／社區幫 <日期>（批次）。unlock 時清空。';
comment on column public.vehicle.繳費時間 is '已繳費旗標最後一次被設定的時間（非住戶實際付款時間，那在社區幫）。';
