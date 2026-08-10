-- 心跳表：GitHub Actions 每日經 Edge Function `ping` 更新時間戳，
-- 讓免費版專案有「真實 DB 寫入活動」→ 不被閒置暫停（純 REST 讀取實測不算活動，2026-08 已中招兩次）。
-- RLS deny-all：只有 Edge Function（service_role）能寫；anon 讀寫皆拒。
create table if not exists keepalive (
  id int primary key,
  at timestamptz not null default now()
);
alter table keepalive enable row level security; -- 不建 policy = anon deny-all
insert into keepalive (id, at) values (1, now())
  on conflict (id) do update set at = now();
