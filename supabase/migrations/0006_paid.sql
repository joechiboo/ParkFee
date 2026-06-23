-- 物業指派小位/無障礙/保留時的繳費旗標（車位編號/類型/狀態欄已在 0005）。
-- 仍在 vehicle（RLS deny-all）→ 戶號/車號/繳費只有該戶 login 或 Edge Function 讀得到。
alter table public.vehicle
  add column if not exists 已繳費 boolean not null default false;
