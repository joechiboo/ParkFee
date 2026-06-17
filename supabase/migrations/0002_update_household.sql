-- 編輯既有戶登記：整批取代該戶車輛 + 更新電話，全程在單一交易內（原子）。
-- 為何用 RPC：update 牽涉「刪舊車 + 插新車」，必須原子；中途失敗不可留下殘缺車輛。
-- SECURITY DEFINER：以函式擁有者（postgres）身分執行 → 有表存取權；僅授權 service_role 可呼叫。

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

  -- 整批取代
  delete from vehicle where 戶號 = p_hid;

  insert into vehicle (車號, 戶號, 車種, 第幾輛, 身障, 志願小位)
  select x.車號, p_hid, x.車種, x.第幾輛, x.身障, x.志願小位
  from jsonb_to_recordset(p_vehicles) as x(
    車號 text, 車種 text, 第幾輛 int, 身障 boolean, 志願小位 boolean
  );

  update household set 電話 = p_phone where 戶號 = p_hid;
end;
$$;

-- 僅 service_role（Edge Function）可執行；撤掉 public/anon/authenticated，避免有人直接打 /rest/v1/rpc。
revoke all on function public.app_update_household(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.app_update_household(text, text, jsonb) to service_role;
