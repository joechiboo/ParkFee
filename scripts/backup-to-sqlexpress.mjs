// 把正式站的登記資料抄一份快照到本機 SQL Server Express（2026-11-10 使用者提議）。
//
// 為什麼要有：Supabase 免費方案沒有自動備份。名冊被誤改或管理密碼外洩被亂改時，
//   稽核紀錄只知道「哪一戶被動過」，不知道原本的值；有每天的快照才比得出來、改得回去（docs/40）。
//
// 做什麼：用 Supabase CLI 的唯讀查詢撈 household／vehicle／locked_seat／audit_log，
//   寫進本機資料庫 ParkFeeBackup。每跑一次新增一份快照（不覆蓋舊的）；稽核紀錄只補新的。
//   🔒 對正式站完全唯讀。資料含電話與車號，只存在這台電腦，不進 repo。
//
// 用法：node scripts/backup-to-sqlexpress.mjs
//   需要：已 `npx supabase login`、本機有 SQL Server Express（預設 localhost\SQLEXPRESS，Windows 驗證）。
//   換執行個體：設環境變數 PARKFEE_BACKUP_SQL，例 `localhost\SQLEXPRESS`。
//
// 怎麼查：見 docs/40 第五節（列出快照、比對兩份快照差異、查某一戶的歷次內容）。
import { execSync, execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SERVER = process.env.PARKFEE_BACKUP_SQL || 'localhost\\SQLEXPRESS'
const DB = 'ParkFeeBackup'

function pg(sql) {
  const out = execSync(`npx --yes supabase db query --remote --read-only --output-format json "${sql.replace(/"/g, '\\"')}"`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 256 * 1024 * 1024,
  })
  const j = JSON.parse(out.slice(out.indexOf('{')))
  if (!j.rows) throw new Error(j.error?.message || 'Supabase CLI 查詢失敗（先跑 npx supabase login）')
  return j.rows
}
const tmp = mkdtempSync(join(tmpdir(), 'parkfee-backup-'))
function mssql(sql, { db = DB } = {}) {
  const file = join(tmp, `q${Date.now()}${Math.random().toString(16).slice(2)}.sql`)
  writeFileSync(file, '﻿' + sql, 'utf8')
  // -C 信任本機自簽憑證；-x 關閉 $(變數) 展開（資料裡可能有這種字樣）；-b 出錯回非零；-f 65001 輸入檔為 UTF-8
  return execFileSync('sqlcmd', ['-S', SERVER, '-E', '-C', '-d', db, '-x', '-b', '-W', '-h', '-1', '-f', '65001', '-i', file], { encoding: 'utf8' })
}
const lit = (rows) => `N'${JSON.stringify(rows).replace(/'/g, "''")}'`

try {
  // ── 1. 撈正式站（唯讀）──
  const households = pg('select "戶號", "電話", to_jsonb("車位志願")::text as "車位志願", "志願落選保底", "社宅", "工作人員", created_at::text as created_at from household order by "戶號"')
  const vehicles = pg('select "車號", "戶號", "車種", "第幾輛", "身障", "志願小位", "車位編號", "車位類型", "配位狀態", "簽約期限"::text as "簽約期限", "已繳費", "特徵", "繳費來源", "繳費時間"::text as "繳費時間" from vehicle order by "戶號", "第幾輛"')
  const locks = pg('select "車位編號" from locked_seat order by 1')
  const audit = pg('select id, at::text as at, action, actor, target, ok, detail::text as detail from audit_log order by id')

  // ── 2. 建庫建表（已存在就跳過）──
  mssql(`if db_id('${DB}') is null create database [${DB}];`, { db: 'master' })
  mssql(`
if object_id('snapshot') is null
  create table snapshot (id int identity primary key, taken_at datetime2(0) not null default sysdatetime(), households int, vehicles int, locks int, audit_rows int);
if object_id('household_snap') is null
  create table household_snap (snapshot_id int not null, 戶號 nvarchar(50) not null, 電話 nvarchar(50), 車位志願 nvarchar(max), 志願落選保底 bit, 社宅 bit, 工作人員 bit, created_at nvarchar(40), primary key (snapshot_id, 戶號));
if object_id('vehicle_snap') is null
  create table vehicle_snap (snapshot_id int not null, 車號 nvarchar(80) not null, 戶號 nvarchar(50), 車種 nvarchar(20), 第幾輛 int, 身障 bit, 志願小位 bit, 車位編號 nvarchar(50), 車位類型 nvarchar(20), 配位狀態 nvarchar(30), 簽約期限 nvarchar(40), 已繳費 bit, 特徵 nvarchar(200), 繳費來源 nvarchar(100), 繳費時間 nvarchar(40), primary key (snapshot_id, 車號));
if object_id('locked_seat_snap') is null
  create table locked_seat_snap (snapshot_id int not null, 車位編號 nvarchar(20) not null, primary key (snapshot_id, 車位編號));
if object_id('audit_log_copy') is null
  create table audit_log_copy (id bigint primary key, at nvarchar(40), action nvarchar(50), actor nvarchar(50), target nvarchar(200), ok bit, detail nvarchar(max));
`)

  // ── 3. 寫入一份新快照（單一交易，失敗整份不留）──
  const out = mssql(`
set nocount on; set xact_abort on;
declare @h nvarchar(max) = ${lit(households)};
declare @v nvarchar(max) = ${lit(vehicles)};
declare @l nvarchar(max) = ${lit(locks)};
declare @a nvarchar(max) = ${lit(audit)};
begin tran;
insert snapshot (households, vehicles, locks, audit_rows) values (${households.length}, ${vehicles.length}, ${locks.length}, ${audit.length});
declare @id int = scope_identity();
insert household_snap select @id, * from openjson(@h) with (戶號 nvarchar(50), 電話 nvarchar(50), 車位志願 nvarchar(max), 志願落選保底 bit, 社宅 bit, 工作人員 bit, created_at nvarchar(40));
insert vehicle_snap select @id, * from openjson(@v) with (車號 nvarchar(80), 戶號 nvarchar(50), 車種 nvarchar(20), 第幾輛 int, 身障 bit, 志願小位 bit, 車位編號 nvarchar(50), 車位類型 nvarchar(20), 配位狀態 nvarchar(30), 簽約期限 nvarchar(40), 已繳費 bit, 特徵 nvarchar(200), 繳費來源 nvarchar(100), 繳費時間 nvarchar(40));
insert locked_seat_snap select @id, * from openjson(@l) with (車位編號 nvarchar(20));
insert audit_log_copy select j.* from openjson(@a) with (id bigint, at nvarchar(40), action nvarchar(50), actor nvarchar(50), target nvarchar(200), ok bit, detail nvarchar(max)) j
 where not exists (select 1 from audit_log_copy c where c.id = j.id);
declare @newAudit int = @@rowcount;
commit;
-- 與上一份快照比：新增、消失、內容有變的戶數與車數
declare @prev int = (select max(id) from snapshot where id < @id);
select concat('快照 #', @id, '（', convert(varchar(16), sysdatetime(), 120), '）：', ${households.length}, ' 戶、', ${vehicles.length}, ' 台車、鎖定 ', ${locks.length}, ' 格；稽核新增 ', @newAudit, ' 筆');
if @prev is null select '這是第一份快照，沒有可比對的前一份';
else select concat('與快照 #', @prev, ' 比：戶 新增 ',
  (select count(*) from household_snap n where n.snapshot_id = @id and not exists (select 1 from household_snap o where o.snapshot_id = @prev and o.戶號 = n.戶號)), '、消失 ',
  (select count(*) from household_snap o where o.snapshot_id = @prev and not exists (select 1 from household_snap n where n.snapshot_id = @id and n.戶號 = o.戶號)), '、內容變動 ',
  (select count(*) from (select 戶號, 電話, 車位志願, 志願落選保底, 社宅, 工作人員 from household_snap where snapshot_id = @id except select 戶號, 電話, 車位志願, 志願落選保底, 社宅, 工作人員 from household_snap where snapshot_id = @prev) d
     where exists (select 1 from household_snap o where o.snapshot_id = @prev and o.戶號 = d.戶號)), '；車 新增 ',
  (select count(*) from vehicle_snap n where n.snapshot_id = @id and not exists (select 1 from vehicle_snap o where o.snapshot_id = @prev and o.車號 = n.車號)), '、消失 ',
  (select count(*) from vehicle_snap o where o.snapshot_id = @prev and not exists (select 1 from vehicle_snap n where n.snapshot_id = @id and n.車號 = o.車號)), '、內容變動 ',
  (select count(*) from (select 車號, 戶號, 車種, 第幾輛, 身障, 志願小位, 車位編號, 配位狀態, 已繳費 from vehicle_snap where snapshot_id = @id except select 車號, 戶號, 車種, 第幾輛, 身障, 志願小位, 車位編號, 配位狀態, 已繳費 from vehicle_snap where snapshot_id = @prev) d
     where exists (select 1 from vehicle_snap o where o.snapshot_id = @prev and o.車號 = d.車號)));
`)
  console.log(out.trim().split(/\r?\n/).filter(Boolean).map((l) => '✓ ' + l.trim()).join('\n'))
} catch (e) {
  console.error('❌ 備份失敗：' + (e.stdout || e.message || e).toString().trim().slice(0, 600))
  process.exitCode = 1
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
