-- ParkFee 登記資料：household / vehicle
-- 安全模型（見 docs/12 §4）：
--   兩表 RLS deny-all（開 RLS、不建任何 anon/authenticated policy）→ 前端 anon key 直接查表回空/403。
--   一切讀寫只走 Edge Function（register / login），函式內以 service_role 操作（service_role 繞過 RLS）。
--   service_role key 由平台自動注入 Edge Function 環境，永不進前端。

create table if not exists public.household (
  戶號        text primary key,
  電話        text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.vehicle (
  車號        text primary key,
  戶號        text not null references public.household(戶號) on delete cascade,
  車種        text not null check (車種 in ('一般', '重機')),
  第幾輛      integer not null,
  身障        boolean not null default false,
  志願小位    boolean not null default false
);

create index if not exists vehicle_household_idx on public.vehicle (戶號);

-- RLS：開啟但「不建任何 policy」→ 對 anon / authenticated 預設一律拒絕。
alter table public.household enable row level security;
alter table public.vehicle   enable row level security;

-- 雙重保險：撤掉 anon / authenticated 對這兩表的 Data API 權限（與建專案時「不自動 expose new tables」一致）。
revoke all on public.household from anon, authenticated;
revoke all on public.vehicle   from anon, authenticated;

-- 授權 service_role（Edge Function 用）。建專案關閉「auto-expose new tables」後，新表預設不會自動授權給
-- 任何 Data API 角色（含 service_role），故須明確授權；否則連 Edge Function 也會 permission denied。
grant all on public.household to service_role;
grant all on public.vehicle   to service_role;
