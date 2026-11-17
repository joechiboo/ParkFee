-- 名冊警示「已處理」（2026-11-17）：秘書聯繫住戶確認沒問題（例：同電話是家人代填、電動機車真車牌）後標記，
-- 名冊頁該條警示改淺綠、不再列在「需聯繫確認」，免得下次又去問一次。
--
-- 以「戶號＋警示種類」記一筆（種類見 src/data/roster-warnings.js 的 WARN_TYPE）：
--   同一戶之後冒出別種問題照樣亮黃；同一種問題的細節變了（例如同電話又多一戶）不會重新亮，要看備註判斷。
-- 戶被刪除時一併刪除；更正戶號會換成新戶，舊的已處理紀錄跟著舊戶刪掉（新戶號的警示會重新判斷）。
-- 只有後端（service_role）讀寫；標記與取消都寫稽核 roster.review。
create table if not exists public.roster_review (
  戶號   text        not null references public.household(戶號) on delete cascade,
  type   text        not null,
  note   text        not null default '',
  at     timestamptz not null default now(),
  primary key (戶號, type)
);

alter table public.roster_review enable row level security;
-- 用 CLI 建的表不會自動給 service_role 權限（0017 踩過），要明確給。
grant select, insert, update, delete on public.roster_review to service_role;
