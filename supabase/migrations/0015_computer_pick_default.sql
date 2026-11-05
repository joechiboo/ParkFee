-- 電腦選號預設同意：只登記、沒存過志願的戶，一律視為同意由電腦配位（2026-11-05 使用者定）。
--
-- 為什麼要改：選位頁的勾選框預設打勾，但要按「儲存志願序」才寫入，而沒點車位按不了儲存。
-- 所以只登記的戶畫面上有勾、資料庫卻是 false，12/1 志願落空會落選。經理的紙本登記確認表也已是同意。
--
-- 存過志願且取消勾選的戶維持 false（車位志願非空），不受影響。register 不帶這欄，新戶吃欄位預設值。

alter table public.household
  alter column 志願落選保底 set default true;

update public.household
  set 志願落選保底 = true
  where cardinality(車位志願) = 0
    and 志願落選保底 = false;
