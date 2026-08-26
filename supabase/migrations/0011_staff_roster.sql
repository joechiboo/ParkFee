-- 社區工作人員名單（2026-08-26）：供健檢腳本比對「登記為工作人員但不在名單中」者。
--
-- 為什麼要有這張表：線上登記表單開放芳鄰自行勾選「工作人員」，而工作人員**免收維護清潔費**
--   （辦法伍、二（十二）），系統無從驗證身分 → 由 check-roster.mjs 比對本表，名單外者標記
--   交物業逐筆確認（不自動剔除：可能是新進同仁或名單未更新）。
--
-- 為什麼放 DB 而非檔案：名單含員工真名，**本專案 repo 為公開**不能進版控；先前放
--   private/staff-roster.txt 則換一台機器就抓不到 → 改放這裡，任何機器以 service_role 讀取即可。
--
-- 安全：比照 household/vehicle —— RLS enable + 對 anon/authenticated 全 revoke，
--   僅 service_role 可讀寫（service_role 只在信任的本機腳本使用，永不進前端／VITE_）。

create table if not exists public.staff_roster (
  姓名 text primary key,
  崗位 text,                                   -- 例：經理、日班AB、晚班中控（可空）
  在職 boolean not null default true,          -- 離職改 false 保留紀錄，勿直接刪（辦法要求離職前讓出車位）
  備註 text,
  updated_at timestamptz not null default now()
);

alter table public.staff_roster enable row level security;
revoke all on public.staff_roster from anon, authenticated;
grant all on public.staff_roster to service_role;
