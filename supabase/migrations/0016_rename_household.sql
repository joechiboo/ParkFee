-- 更正戶號（2026-11-10）：住戶登記時把戶號填錯（例如填成門牌號碼 B3-385、沒填樓層），
-- 由管理員在維護頁改成正確戶號。整戶的電話、志願、車輛、已選定車位、繳費紀錄原封搬到新戶號。
--
-- 為什麼要寫成資料庫函式：戶號是 household 主鍵、vehicle 以外鍵指向它，自行車車號又是
--   含戶號的合成鍵（自行車-<戶號>-<序>）。三處要一起改，中途失敗不能留下半套，所以包在同一筆交易。
-- 車位鎖（locked_seat）只存車位編號，不含戶號，不用動。
-- 新戶號已有登記時不合併，直接拒絕：兩戶的車與志願怎麼併沒有唯一答案，請櫃台人工處理。
-- 回傳搬移的車輛數。

create or replace function public.app_rename_household(p_old text, p_new text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  moved integer;
begin
  if p_old = p_new then
    raise exception '新舊戶號相同';
  end if;
  if not exists (select 1 from household where 戶號 = p_old) then
    raise exception '戶號 % 尚未登記', p_old;
  end if;
  if exists (select 1 from household where 戶號 = p_new) then
    raise exception '戶號 % 已有登記，無法併入，請先確認是不是同一戶重複登記', p_new;
  end if;

  -- 整列照抄（含登記時間與日後新增的欄位），只換戶號
  insert into household
  select (jsonb_populate_record(null::household, to_jsonb(h) || jsonb_build_object('戶號', p_new))).*
    from household h
   where h.戶號 = p_old;

  update vehicle
     set 戶號 = p_new,
         車號 = case
                  when 車號 like '自行車-' || p_old || '-%'
                    then '自行車-' || p_new || substr(車號, length('自行車-' || p_old) + 1)
                  else 車號
                end
   where 戶號 = p_old;
  get diagnostics moved = row_count;

  delete from household where 戶號 = p_old;
  return moved;
end;
$$;

revoke all on function public.app_rename_household(text, text) from public, anon, authenticated;
grant execute on function public.app_rename_household(text, text) to service_role;
