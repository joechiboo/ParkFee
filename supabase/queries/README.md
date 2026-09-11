# Supabase 常用查詢

放在 Dashboard → SQL Editor 執行的查詢，編號存檔以便複用與版控。

## 命名慣例

檔名與 SQL Editor 裡存檔的名稱**用同一個**，方便對照：

```
NN-用途.sql        例：01-匯出登記名冊.sql
```

- 編號一經配給就不再變動，也不回收（刪掉的就讓它空著），以免口頭溝通時對錯號。
- 新增查詢往後接號。

## 清單

| # | 名稱 | 用途 |
|---|---|---|
| 01 | [匯出登記名冊](01-匯出登記名冊.sql) | 抽籤用名冊 CSV，餵 `scripts/draw.mjs` |

## 為什麼不是只用 scripts/

`scripts/export-roster.mjs` 做同一件事，但需要把 **service_role key**（上帝權限、繞過 RLS）
放進本機 `.env`。走 Dashboard 則沿用登入身分，不必把金鑰落地——12/1 抽籤日在現場操作時尤其省事。

兩條路的輸出**必須保持同構**（欄位名稱一致），因為下游 `buildRoster()` 是共用的。
改了其中一邊，記得同步另一邊與 `src/data/registry.js` 的 `REGISTRATION_COLUMNS`。
