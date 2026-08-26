-- 社區工作人員旗標（2026-08-24／26 使用者決策，辦法伍、二（十二））：
--   與住戶同梯登記、同樣可填志願，但**配位排在所有住戶之後**——辦法限制的是配位時點
--   （「停車資格程序完結後如有剩餘車位」），非登記時點；且只要仍有住戶未配得車位，
--   工作人員一律暫緩（引擎 distribute.js 最後一輪 + REASON.STAFF_PENDING）。
--   免收維護清潔費（feeFor 帶 { 工作人員: true } → 0）、不得配公益位與無障礙位。
--   公告公開版自動隱藏其配位（src/export/result.js），物業內部版完整保留。
--
-- 工作人員無戶號 → 以合成鍵「員工-<編號>」存於同一個 戶號 欄（src/data/household.js），
--   因登入為「戶號＋車號」比對、其有車牌，故登記/登入/選位/結果整條線均免改。
-- 表已 RLS deny-all + revoke，新欄位不影響安全模型；service_role 已有整表權限。

alter table public.household
  add column if not exists 工作人員 boolean not null default false;
