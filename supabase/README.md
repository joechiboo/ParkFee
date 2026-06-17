# Supabase 設定（ParkFee）

架構與安全模型見 [../docs/12-機制合規與建置規劃.md §4](../docs/12-機制合規與建置規劃.md)。
重點：純前端 + Supabase + Edge Functions，**敏感表 RLS deny-all、一切讀寫走 Edge Function**，
service_role 只活在函式環境、永不進前端。

---

## 0. 你需要的工具

- 已建立的 Supabase 專案（建立時：**Automatically expose new tables 取消勾選、Enable automatic RLS 勾選**）。
- Supabase CLI：`npm i -g supabase` 或 `npx supabase ...`（以下用 `npx`）。

## 1. 連結專案

到 Project Settings → General 取得 **Reference ID**（`abcdefgh...`），然後：

```bash
npx supabase login          # 一次性，開瀏覽器授權
npx supabase link --project-ref <你的 reference id>
```

## 2. 套用資料表 + RLS

```bash
npx supabase db push        # 套用 migrations/0001_init.sql（建表、開 RLS、撤 anon 權限）
```

> 不想用 CLI 也可：到 Dashboard → SQL Editor，貼上 `migrations/0001_init.sql` 全文執行。

## 3. 部署 Edge Functions

```bash
npx supabase functions deploy register
npx supabase functions deploy login
```

> service_role 不必手動設定——`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 由平台自動注入函式環境。

## 4. 設定前端 .env

到 Project Settings → API 複製 **Project URL** 與 **anon/publishable key**：

```bash
cp .env.example .env
# 編輯 .env：
#   VITE_SUPABASE_URL=https://<ref>.supabase.co
#   VITE_SUPABASE_ANON_KEY=<anon key>
```

設好後 `npm run dev`，db.js 會自動改走 Supabase（沒設則維持 localStorage）。

---

## 5. ✅ 上線前必做：anon key 洩漏測試

確認「拿到前端公開的 anon key 也撈不到敏感資料」。在終端機跑（值換成你的）：

```bash
curl "https://<ref>.supabase.co/rest/v1/vehicle?select=*" \
  -H "apikey: <anon key>" \
  -H "Authorization: Bearer <anon key>"
```

**預期回傳空陣列 `[]` 或權限錯誤**（因 RLS deny-all + 已 revoke）。
對 `household` 再測一次。**若回得出任何一筆資料 = RLS 沒設對，停止上線、回頭檢查第 2 步。**

正常流程（透過 Edge Function）則應成功：

```bash
curl -X POST "https://<ref>.supabase.co/functions/v1/login" \
  -H "Authorization: Bearer <anon key>" -H "Content-Type: application/json" \
  -d '{"戶號":"H3-6","車號":"ABC-123"}'
# → {"household": ... } 或 {"household": null}
```

---

## 安全紅線（重申）

- **service_role key 永不進前端**：不可命名 `VITE_*`、不可寫進 `src/`、不可進 `.env`（前端讀得到的都算）、不可進 git。它只屬於 Edge Function。
- 敏感表（household/vehicle）**永遠不要**為 anon/authenticated 加 SELECT policy。要讀就加一支 Edge Function。
- 新增任何含個資的表，記得 `enable row level security`（建專案已開 automatic RLS，仍要確認）。
