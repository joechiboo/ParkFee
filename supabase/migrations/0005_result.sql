-- 配位結果回填到 vehicle（住戶登入即可看自己分到哪）。
-- 寫入只走 Edge Function publish-result（service_role + 管理員密碼）；vehicle 仍 RLS deny-all。
-- 讀：經 login/fetchHousehold（service_role，只回該戶）。

alter table public.vehicle
  add column if not exists 車位編號  text,
  add column if not exists 車位類型  text,
  add column if not exists 配位狀態  text, -- 分配 / 候補 / 未中
  add column if not exists 簽約期限  text; -- 公告日 + 5（發佈時算好）
