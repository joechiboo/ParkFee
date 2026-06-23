-- 鎖定車位（物業保留/已私下承租/維修…，不進抽籤、選位頁不可選）。
-- 非敏感（只有車位編號）→ 允許 anon 讀（住戶選位頁可直接顯示鎖定）；
-- 寫入只走 Edge Function set-locked（service_role + 管理員密碼），anon 不可寫。

create table if not exists public.locked_seat (
  車位編號    text primary key,
  created_at  timestamptz not null default now()
);

alter table public.locked_seat enable row level security;

-- 讀：開放 anon/authenticated（清單公開無妨）。
drop policy if exists locked_seat_read on public.locked_seat;
create policy locked_seat_read on public.locked_seat for select to anon, authenticated using (true);

-- 建專案關了「auto-expose new tables」→ 需明確授權。
grant select on public.locked_seat to anon, authenticated;
grant all on public.locked_seat to service_role;
