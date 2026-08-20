-- 自行車整合（docs/10 Q18，2026-08-19）。
--
-- 純加法：不改既有欄位語意、不動 PK、不動 locked_seat → 12/1 機車抽籤路徑完全不受影響。
--
-- 【車輛識別】自行車無車牌，改「綁戶號」：車號欄存系統產生的合成鍵 '自行車-<戶號>-<序>'
--   （例 自行車-H3-6-1）。該值含中文字元，與台灣車牌的值域（大寫英數＋連字號）天然不相交，
--   不可能與真實車牌互撞，故沿用 車號 PK 即可，免改主鍵。
--   未來發貼紙時，貼紙上印的是**車位號**，車位編號本身即識別證（不另發證號）。
--
-- 【車位編號】自行車存前綴正規形 B001–B164，機車維持裸數字 1–655。
--   盤點檔裡兩者的地面號碼有 155 個字面重複，前綴後交集為 0。見 src/map/seat-id.js。
--
-- 【第幾輛】依辦法伍三(四)，自行車的「第一輛/第二輛」是**獨立於機車的序列**；
--   故 (戶號, 車種群組, 第幾輛) 才是唯一。機車類（一般/重機）共用一個序列，自行車另一個。

-- 1) 車種放行 '自行車'。既有 check 由 Postgres 自動命名，故先查名再 drop（不寫死名稱）。
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'public.vehicle'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%車種%'
   limit 1;
  if c is not null then
    execute format('alter table public.vehicle drop constraint %I', c);
  end if;
end $$;

alter table public.vehicle
  add constraint vehicle_車種_check check (車種 in ('一般', '重機', '自行車'));

-- 2) 自行車辨識特徵（廠牌/顏色）。取代車牌，供管理中心在車架旁認車；非必填。
alter table public.vehicle
  add column if not exists 特徵 text not null default '';

-- 3) 「第幾輛」在其序列內不得重複。
--    分組鍵用 (車種 = '自行車') 而非 車種 本身：機車類（一般/重機）共用一個序列，
--    若寫成 (戶號, 車種, 第幾輛)，一般#1 與 重機#1 會雙雙通過，等於沒擋到。
--    既有資料：第幾輛 為送出順序 1..n、全為機車類 → 建索引不會失敗。
create unique index if not exists vehicle_household_seq_idx
  on public.vehicle (戶號, (車種 = '自行車'), 第幾輛);

-- 4) 編輯登記的 RPC 補上 特徵 欄。
--    原版（0002）的 jsonb_to_recordset 沒宣告 特徵 → 整批取代時會被還原成預設值，
--    住戶一改登記，自行車的廠牌/顏色就沒了。其餘邏輯與 0002 相同。
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

  insert into vehicle (車號, 戶號, 車種, 第幾輛, 身障, 志願小位, 特徵)
  select x.車號, p_hid, x.車種, x.第幾輛, x.身障, x.志願小位, coalesce(x.特徵, '')
  from jsonb_to_recordset(p_vehicles) as x(
    車號 text, 車種 text, 第幾輛 int, 身障 boolean, 志願小位 boolean, 特徵 text
  );

  update household set 電話 = p_phone where 戶號 = p_hid;
end;
$$;

revoke all on function public.app_update_household(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.app_update_household(text, text, jsonb) to service_role;

-- 安全模型不變：vehicle 仍 RLS deny-all、已 revoke anon/authenticated、service_role 已有整表權限，
-- 新欄位與新索引不需再授權（見 0001）。
