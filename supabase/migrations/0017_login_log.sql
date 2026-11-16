-- 登入紀錄（2026-11-16）：純自行車戶開放「車號欄留空、只打戶號」登入後，需要能追查與擋掃描。
--
-- 為什麼要有：戶號不是秘密，空白車號登入等於只靠戶號。保護靠三件事：
--   ① 同一網路位址一小時內用空白車號登入「失敗」超過 30 次就暫時擋（11/16 改為只算失敗）（擋程式一戶一戶掃）；不鎖住戶帳號，
--      否則有心人故意對每一戶亂試就能把大家都鎖住。
--   ② 空白車號登入只能改自行車、不能加機車、不能改電話（後端強制）。
--   ③ 每次登入（成功、失敗）都記在這張表，修改另記稽核，出事查得到；內容可從每日快照還原。
-- 有車牌的戶照舊用車號登入，也一併記錄。
--
-- ip 屬可識別資訊：只給後端（service_role）讀寫，前端碰不到；不記電話、車號。
create table if not exists public.login_log (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  ip      text        not null default '',
  hid     text        not null default '',  -- 輸入的戶號（正規化後）
  method  text        not null default '',  -- 'plate'＝車號登入、'bike'＝空白車號（純自行車戶）
  ok      boolean     not null
);
create index if not exists login_log_ip_at_idx on public.login_log (ip, at desc);
create index if not exists login_log_hid_at_idx on public.login_log (hid, at desc);

alter table public.login_log enable row level security;

-- 後端角色的權限：用 CLI 建的表不會自動帶到 service_role（11/16 實測寫入與計數都靜靜失敗），要明確給。
grant select, insert on public.login_log to service_role;
grant usage, select on sequence public.login_log_id_seq to service_role;
