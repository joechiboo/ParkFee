-- 稽核流水帳：記「誰、什麼時候、對誰、做了什麼、結果如何」。
--
-- 為什麼要有：2026-09-01 盤點發現系統幾乎沒有稽核能力 —— Edge Function 只有
--   console.error（且只記錯誤、平台 log 約 7 天就沒了），DB 無任何稽核表。
--   於是下列問題事後查不出來：
--     · 住戶說「我明明繳了費」→ 誰把繳費狀態改掉的、何時改的？
--     · 某格車位被解鎖 → 誰解的？
--     · 名冊被撈走 → 誰撈的、撈了幾次？
--
-- 記錄範圍（只記「動到錢或個資、事後會有爭議」的動作）：
--   roster.list      撈全名冊（list-roster）
--   seat.assign      指派車位／同時寫入繳費狀態（assign-seat op=assign）
--   seat.unlock      解除車位（assign-seat op=unlock）
--   result.publish   發佈配位結果（publish-result）
-- 不記：登入、查自己的資料、唯讀腳本、assign-seat op=list（量大、價值低）。
--
-- ⚠️ **不得把名冊內容寫進 detail** —— 那等於在 DB 裡再複製一份個資。
--    只記筆數、車位編號、戶號/車號這類「指涉」層級的識別，不記電話、姓名。
--
-- ⚠️ 限制：管理員目前是**單一共用密碼**，故 actor 只能記到「以哪種方式通過驗證」
--    （password＝共用密碼；household＝管理員戶號＋車牌，這種才追得到人）。
--    要真正可歸責需管理員分帳號，列後續議題。

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  action      text        not null,              -- 見上方範圍
  actor       text        not null default '',   -- 'password' | 戶號（車牌驗證者）
  target      text        not null default '',   -- 車位編號／車號／'-'
  ok          boolean     not null default true, -- 動作是否成功
  detail      jsonb       not null default '{}'  -- 僅筆數等摘要，**不放個資**
);

create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_action_idx on public.audit_log (action, at desc);

-- RLS：開啟但不建 policy → anon/authenticated 一律拒絕；只有 service_role
-- （Edge Function 內部）寫得進去、讀得出來。稽核紀錄不該讓前端碰。
alter table public.audit_log enable row level security;

comment on table public.audit_log is
  '稽核流水帳：動到錢或個資的管理員動作。僅 service_role 可存取；detail 不得含個資。';
