-- 編輯登記時「取消志願小位＝一併釋放車位」＋回傳改前快照供稽核（2026-11-26）。
--
-- 【修什麼】
--   ① 取消勾選「志願小位」只改了旗標，線上選定的小位（車位編號＋locked_seat）照 0012 依車號還原，
--      格子一直鎖在這戶。抽籤引擎只看車位編號，於是：
--        - 該戶以為放棄了小位、改排大位志願，抽籤時卻被當成「已有車位」，第 1 輛被跳過；
--        - 那一格地圖上一直是灰的，別戶也選不到。
--      11/26 查到 D7-11（239）、C5-12（58）：住戶線上選位後，秘書代改時取消勾選，格子都還鎖著。
--   ② 0012 的配位快照漏了 0014 新增的 繳費來源／繳費時間 → 12/2 起已繳費的車只要被編輯一次，
--      這兩欄就被清空（已繳費旗標本身有還原）。
--   ③ 稽核只記「車輛數」，看不出改了什麼（E1-10 的輛次被調換、D7-11 的勾被取消都查不到經過）。
--      本函式改為回傳改前快照與釋放清單，由 Edge Function 寫進稽核。
--
-- 【規則】只在「原本是線上志願小位（配位狀態＝志願小位 且 旗標＝true）、車還在、這次旗標改成 false」時釋放。
--   - 櫃台在維護頁指派的小位，配位狀態同樣叫「志願小位」，但旗標多半是 false（assign-seat 不改旗標），
--     用「true → false 的轉變」判斷，不會誤放櫃台指派的位。
--   - 已繳費的志願小位不准用取消勾選放掉（比照 claim-seat 的 release：已繳費不能線上取消），直接報錯。
--   - 車被整台刪掉時照 0012 釋放（不變）。
--
-- 回傳型別由 void 改 jsonb，create or replace 不能改回傳型別 → 先 drop。
-- 呼叫端 update-household 原本就不讀回傳值，先套本檔再部署新版函式不會中斷。

drop function if exists public.app_update_household(text, text, jsonb);

create function public.app_update_household(
  p_hid text,
  p_phone text,
  p_vehicles jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conflict text;
  old_v jsonb;
  released jsonb;
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

  -- 快照本戶目前的車輛（含配位欄位；下面的整批刪除會一併帶走）
  select coalesce(jsonb_agg(to_jsonb(o) order by o.車種 = '自行車', o.第幾輛), '[]'::jsonb)
    into old_v
  from (
    select 車號, 車種, 第幾輛, 志願小位, 車位編號, 車位類型, 配位狀態, 簽約期限, 已繳費, 繳費來源, 繳費時間
      from vehicle
     where 戶號 = p_hid
  ) o;

  -- 這次要取消的線上志願小位：原本旗標 true＋配位狀態志願小位＋有格號，車還在，新旗標 false
  select coalesce(jsonb_agg(jsonb_build_object('車號', o.車號, '車位編號', o.車位編號, '已繳費', coalesce(o.已繳費, false))), '[]'::jsonb)
    into released
  from jsonb_to_recordset(old_v) as o(車號 text, 志願小位 boolean, 車位編號 text, 配位狀態 text, 已繳費 boolean)
  join jsonb_to_recordset(p_vehicles) as n(車號 text, 志願小位 boolean) on n.車號 = o.車號
  where o.配位狀態 = '志願小位'
    and coalesce(o.志願小位, false)
    and coalesce(o.車位編號, '') <> ''
    and not coalesce(n.志願小位, false);

  if exists (select 1 from jsonb_array_elements(released) r where (r->>'已繳費')::boolean) then
    raise exception '已繳費的志願小位不能用取消勾選放掉，請到車位維護頁解除（退費走線下）';
  end if;

  -- 被移除的車、以及取消志願小位的車：釋放車位鎖，否則該位變成沒人認領的孤鎖
  delete from locked_seat
   where 車位編號 in (
     select btrim(s)
       from jsonb_to_recordset(old_v) as o(車號 text, 車位編號 text)
       cross join lateral unnest(string_to_array(o.車位編號, '、')) as s
      where coalesce(o.車位編號, '') <> ''
        and btrim(s) <> ''
        and (
          not exists (select 1 from jsonb_to_recordset(p_vehicles) as n(車號 text) where n.車號 = o.車號)
          or exists (select 1 from jsonb_array_elements(released) r where r->>'車號' = o.車號)
        )
   );

  -- 整批取代
  delete from vehicle where 戶號 = p_hid;

  insert into vehicle (車號, 戶號, 車種, 第幾輛, 身障, 志願小位, 特徵)
  select x.車號, p_hid, x.車種, x.第幾輛, x.身障, x.志願小位, coalesce(x.特徵, '')
  from jsonb_to_recordset(p_vehicles) as x(
    車號 text, 車種 text, 第幾輛 int, 身障 boolean, 志願小位 boolean, 特徵 text
  );

  -- 留下來的車：把配位欄位原封還原（取消志願小位的車除外，維持空白＝回到一般抽籤）
  update vehicle v
     set 車位編號 = o.車位編號,
         車位類型 = o.車位類型,
         配位狀態 = o.配位狀態,
         簽約期限 = o.簽約期限,
         已繳費   = coalesce(o.已繳費, false),
         繳費來源 = o.繳費來源,
         繳費時間 = o.繳費時間
    from jsonb_to_recordset(old_v) as o(
      車號 text, 車位編號 text, 車位類型 text, 配位狀態 text, 簽約期限 text, 已繳費 boolean, 繳費來源 text, 繳費時間 timestamptz
    )
   where v.戶號 = p_hid
     and v.車號 = o.車號
     and not exists (select 1 from jsonb_array_elements(released) r where r->>'車號' = o.車號);

  update household set 電話 = p_phone where 戶號 = p_hid;

  return jsonb_build_object(
    'before', old_v,
    'released', (select coalesce(jsonb_agg(r->>'車位編號'), '[]'::jsonb) from jsonb_array_elements(released) r)
  );
end;
$$;

revoke all on function public.app_update_household(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.app_update_household(text, text, jsonb) to service_role;
