-- 編輯登記時「保住配位結果」＋「釋放被移除車輛的車位鎖」（2026-09-01）。
--
-- 【修什麼】0009（承自 0002）的做法是「整批刪除該戶車輛再插回」，但插回時只帶登記欄位
--   （車號/車種/第幾輛/身障/志願小位/特徵），於是：
--   ① 連沒被動到的車，其 車位編號／車位類型／配位狀態／簽約期限／已繳費 全被清成預設值。
--      → 11/1–15 物業指派小位＋收費那段，住戶（或物業代改）一改登記，繳費與車位記錄就沒了，
--        且畫面上看不出來。
--   ② 被移除的車若原本有位，locked_seat 沒有人清 → 該位永遠鎖著：選位頁不可選、抽籤也配不出去。
--      （TODO 2026-08-27 記的就是這條，但實際嚴重的是 ①。）
--
-- 【怎麼修】刪除前先把配位欄位快照起來，插回後依「車號」還原；被移除且原本有位者，
--   一併刪掉對應的 locked_seat（重機的「150、151」以「、」展開後逐位刪）。
--   其餘邏輯（跨戶車號衝突檢查、整批取代、電話更新）與 0009 完全相同。
--
-- ⚠️ 改車號＝視為換車（舊車移除＋新車加入）：舊車的位會被釋放、配位欄位不還原，
--    須由物業於 /seat-admin 重新指派。這是刻意的——車位跟著「車」走，系統無從分辨
--    「打錯字修正」與「真的換了一台車」。已繳費者退費走線下（辦法財務段）。
-- ⚠️ 自行車車號是合成鍵 自行車-<戶號>-<序>，序號會在刪車後重排：刪掉第 1 輛時，
--    原第 2 輛會遞補成第 1 輛的鍵，因而繼承其車位。自行車免費、隨機配位，
--    差別僅在「哪一輛掛哪個位」，故不另做位移偵測。

create or replace function public.app_update_household(
  p_hid text,
  p_phone text,
  p_vehicles jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  conflict text;
  old_v jsonb;
begin
  if not exists (select 1 from household where 戶號 = p_hid) then
    raise exception '戶號 % 尚未登記，無法編輯', p_hid;
  end if;

  -- 有無車號被「其他戶」占用（排除本戶舊車；本戶舊車稍後整批刪除再插回，不算衝突）
  select string_agg(x.車號, ', ')
    into conflict
  from jsonb_to_recordset(p_vehicles) as x(車號 text)
  join vehicle vv on vv.車號 = x.車號 and vv.戶號 <> p_hid;

  if conflict is not null then
    raise exception '車號 % 已被其他戶登記', conflict;
  end if;

  -- 快照本戶目前的配位欄位（下面的整批刪除會一併帶走）
  select coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb)
    into old_v
  from (
    select 車號, 車位編號, 車位類型, 配位狀態, 簽約期限, 已繳費
      from vehicle
     where 戶號 = p_hid
  ) o;

  -- ② 被移除的車若原本有位 → 釋放車位鎖，否則該位變成沒人認領的孤鎖
  delete from locked_seat
   where 車位編號 in (
     select btrim(s)
       from jsonb_to_recordset(old_v) as o(車號 text, 車位編號 text)
       cross join lateral unnest(string_to_array(o.車位編號, '、')) as s
      where coalesce(o.車位編號, '') <> ''
        and btrim(s) <> ''
        and not exists (
          select 1 from jsonb_to_recordset(p_vehicles) as n(車號 text) where n.車號 = o.車號
        )
   );

  -- 整批取代
  delete from vehicle where 戶號 = p_hid;

  insert into vehicle (車號, 戶號, 車種, 第幾輛, 身障, 志願小位, 特徵)
  select x.車號, p_hid, x.車種, x.第幾輛, x.身障, x.志願小位, coalesce(x.特徵, '')
  from jsonb_to_recordset(p_vehicles) as x(
    車號 text, 車種 text, 第幾輛 int, 身障 boolean, 志願小位 boolean, 特徵 text
  );

  -- ① 留下來的車：把配位欄位原封還原（jsonb_to_recordset 依 key 名對應，欄位順序無關）
  update vehicle v
     set 車位編號 = o.車位編號,
         車位類型 = o.車位類型,
         配位狀態 = o.配位狀態,
         簽約期限 = o.簽約期限,
         已繳費   = coalesce(o.已繳費, false)
    from jsonb_to_recordset(old_v) as o(
      車號 text, 車位編號 text, 車位類型 text, 配位狀態 text, 簽約期限 text, 已繳費 boolean
    )
   where v.戶號 = p_hid
     and v.車號 = o.車號;

  update household set 電話 = p_phone where 戶號 = p_hid;
end;
$$;

revoke all on function public.app_update_household(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.app_update_household(text, text, jsonb) to service_role;

-- 安全模型不變：vehicle 仍 RLS deny-all、locked_seat 的寫入權本來就只有 service_role，
-- 本函式 SECURITY DEFINER 且僅授權 service_role 呼叫（Edge Function update-household）。


-- ─────────────────────────────────────────────────────────────────────────────
-- 驗證（選用）：套用上面之後，把下面整段去掉註解貼進 SQL Editor 執行。
-- 全段包在 begin…rollback，不留任何測試資料；期望輸出三個 PASS。
--
-- begin;
--
-- -- 一戶三台：AAA-001 已配 9001＋已繳費（保留）／BBB-002 重機已配 9002、9003（移除）／CCC-003 無位（保留）
-- insert into household (戶號, 電話) values ('S1-998', '0900000000');
-- insert into vehicle (車號, 戶號, 車種, 第幾輛, 身障, 志願小位, 特徵, 車位編號, 車位類型, 配位狀態, 簽約期限, 已繳費)
-- values
--   ('AAA-001', 'S1-998', '一般', 1, false, true,  '', '9001',       '小', '分配', '2026-12-06', true),
--   ('BBB-002', 'S1-998', '重機', 2, false, false, '', '9002、9003', '大', '分配', '2026-12-06', false),
--   ('CCC-003', 'S1-998', '一般', 3, false, false, '', null, null, null, null, false);
-- insert into locked_seat (車位編號) values ('9001'), ('9002'), ('9003'), ('9004');  -- 9004＝無關的鎖（控制組）
--
-- -- 編輯登記：移除 BBB-002，其餘不動（前端送的就是這種整批清單）
-- select app_update_household('S1-998', '0911111111',
--   '[{"車號":"AAA-001","車種":"一般","第幾輛":1,"身障":false,"志願小位":true,"特徵":""},
--     {"車號":"CCC-003","車種":"一般","第幾輛":2,"身障":false,"志願小位":false,"特徵":""}]'::jsonb);
--
-- select
--   case when (select 車位編號 from vehicle where 車號 = 'AAA-001') = '9001'
--         and (select 已繳費   from vehicle where 車號 = 'AAA-001') = true
--         and (select 配位狀態 from vehicle where 車號 = 'AAA-001') = '分配'
--        then 'PASS ①留下的車保住車位與繳費' else 'FAIL ①' end as 檢查1,
--   case when not exists (select 1 from locked_seat where 車位編號 in ('9002','9003'))
--        then 'PASS ②移除的重機兩格鎖都釋放' else 'FAIL ②' end as 檢查2,
--   case when exists (select 1 from locked_seat where 車位編號 = '9001')
--         and exists (select 1 from locked_seat where 車位編號 = '9004')
--        then 'PASS ③沒誤刪還在用的鎖與無關的鎖' else 'FAIL ③' end as 檢查3;
--
-- rollback;
