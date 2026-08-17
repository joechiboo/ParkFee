-- 社會住宅住戶旗標（2026-08-16 小組決議 Q7，見 docs/17）：
--   公益位 20 格＝社宅戶專用；登記時自選、物業核對身分。
--   社宅戶選位/配位限公益位（前端 SelectView + 引擎 distribute.js eligibleFor 分流）。
-- 表已 RLS deny-all + revoke，新欄位不影響安全模型；service_role 已有整表權限。

alter table public.household
  add column if not exists 社宅 boolean not null default false;
