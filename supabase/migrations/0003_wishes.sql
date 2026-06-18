-- 車位志願序（戶層級）：household 加兩欄。
-- 安全模型不變：household 仍 RLS deny-all、僅 service_role（Edge Function）可寫；見 docs/12 §4。
--   車位志願      = 有序車位編號陣列（志願序＝陣列順序），例 {大123,大087,小45}
--   志願落選保底  = 志願全落空時，是否同意由物業就近補位

alter table public.household
  add column if not exists 車位志願 text[] not null default '{}',
  add column if not exists 志願落選保底 boolean not null default false;
