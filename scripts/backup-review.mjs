// 檢視本機備份（ParkFeeBackup）：有哪些快照、每天有沒有跑、這段期間名冊變了什麼。
// 只讀本機 SQL Server Express，不連正式站。
//
// 用法：node scripts/backup-review.mjs            # 列出最近 20 份快照，並比對「最早一份 → 最新一份」
//       node scripts/backup-review.mjs 6 12      # 比對快照 #6 與 #12
// 快照怎麼來的：scripts/backup-to-sqlexpress.mjs（Windows 排程「ParkFee 名冊每日備份」每天 12:30 跑）。
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SERVER = process.env.PARKFEE_BACKUP_SQL || 'localhost\\SQLEXPRESS'
const [a, b] = process.argv.slice(2).map(Number)
const tmp = mkdtempSync(join(tmpdir(), 'parkfee-review-'))
const file = join(tmp, 'q.sql')
writeFileSync(
  file,
  '﻿' +
    `
set nocount on;
declare @from int = ${a || 'null'}, @to int = ${b || 'null'};
if @to is null select @to = max(id) from snapshot;
if @from is null select @from = min(id) from (select top 20 id from snapshot order by id desc) t;

print '── 快照清單（最近 20 份）──';
select concat('#', id, '  ', convert(varchar(16), taken_at, 120), '  ', households, ' 戶 ', vehicles, ' 台車  鎖定 ', locks, ' 格') from (select top 20 * from snapshot order by id desc) t order by id;

print '';
print '── 每天有沒有備份 ──';
select concat(convert(varchar(10), taken_at, 120), '  ', count(*), ' 份') from snapshot group by convert(varchar(10), taken_at, 120) order by 1;

print '';
select concat('── 比對 #', @from, '（', convert(varchar(16), (select taken_at from snapshot where id = @from), 120), '） → #', @to, '（', convert(varchar(16), (select taken_at from snapshot where id = @to), 120), '）──');

select concat('新登記的戶（', count(*), '）：', isnull(string_agg(cast(戶號 as nvarchar(max)), '、') within group (order by 戶號), '無'))
  from household_snap n where snapshot_id = @to and not exists (select 1 from household_snap o where o.snapshot_id = @from and o.戶號 = n.戶號);
select concat('消失的戶（', count(*), '）：', isnull(string_agg(cast(戶號 as nvarchar(max)), '、') within group (order by 戶號), '無'))
  from household_snap o where snapshot_id = @from and not exists (select 1 from household_snap n where n.snapshot_id = @to and n.戶號 = o.戶號);
select concat('電話、志願或身分有變的戶（', count(*), '）：', isnull(string_agg(cast(戶號 as nvarchar(max)), '、') within group (order by 戶號), '無'))
  from (select 戶號, 電話, 車位志願, 志願落選保底, 社宅, 工作人員 from household_snap where snapshot_id = @to
        except select 戶號, 電話, 車位志願, 志願落選保底, 社宅, 工作人員 from household_snap where snapshot_id = @from) d
 where exists (select 1 from household_snap o where o.snapshot_id = @from and o.戶號 = d.戶號);
select concat('車輛有增減或內容有變的戶（', count(distinct 戶號), '）：', isnull((select string_agg(cast(戶號 as nvarchar(max)), '、') within group (order by 戶號) from (select distinct 戶號 from (
        (select 車號, 戶號, 車種, 第幾輛, 身障, 志願小位, 車位編號, 配位狀態, 已繳費 from vehicle_snap where snapshot_id = @to
         except select 車號, 戶號, 車種, 第幾輛, 身障, 志願小位, 車位編號, 配位狀態, 已繳費 from vehicle_snap where snapshot_id = @from)
        union all
        (select 車號, 戶號, 車種, 第幾輛, 身障, 志願小位, 車位編號, 配位狀態, 已繳費 from vehicle_snap where snapshot_id = @from
         except select 車號, 戶號, 車種, 第幾輛, 身障, 志願小位, 車位編號, 配位狀態, 已繳費 from vehicle_snap where snapshot_id = @to)) x
        where exists (select 1 from household_snap o where o.snapshot_id = @from and o.戶號 = x.戶號) and exists (select 1 from household_snap n where n.snapshot_id = @to and n.戶號 = x.戶號)) y), '無'))
  from (
        (select 車號, 戶號, 車種, 第幾輛, 身障, 志願小位, 車位編號, 配位狀態, 已繳費 from vehicle_snap where snapshot_id = @to
         except select 車號, 戶號, 車種, 第幾輛, 身障, 志願小位, 車位編號, 配位狀態, 已繳費 from vehicle_snap where snapshot_id = @from)
        union all
        (select 車號, 戶號, 車種, 第幾輛, 身障, 志願小位, 車位編號, 配位狀態, 已繳費 from vehicle_snap where snapshot_id = @from
         except select 車號, 戶號, 車種, 第幾輛, 身障, 志願小位, 車位編號, 配位狀態, 已繳費 from vehicle_snap where snapshot_id = @to)) x
 where exists (select 1 from household_snap o where o.snapshot_id = @from and o.戶號 = x.戶號) and exists (select 1 from household_snap n where n.snapshot_id = @to and n.戶號 = x.戶號);
select concat('已選定車位的車：', (select count(*) from vehicle_snap where snapshot_id = @from and isnull(車位編號, '') <> ''), ' → ', (select count(*) from vehicle_snap where snapshot_id = @to and isnull(車位編號, '') <> ''), ' 台');
select concat('鎖定車位：', (select count(*) from locked_seat_snap where snapshot_id = @from), ' → ', (select count(*) from locked_seat_snap where snapshot_id = @to), ' 格');
select concat('期間的管理動作（稽核）：', isnull((select string_agg(concat(action, ' ', n), '、') from (select action, count(*) n from audit_log_copy
   where action <> 'system.ping' and at >= convert(varchar(19), dateadd(hour, -8, (select taken_at from snapshot where id = @from)), 120) /* 稽核時間是 UTC，快照時間是台北 */ group by action) t), '無'));
`,
  'utf8',
)
try {
  const buf = execFileSync('sqlcmd', ['-S', SERVER, '-E', '-C', '-d', 'ParkFeeBackup', '-x', '-b', '-W', '-h', '-1', '-f', '65001', '-i', file])
  // sqlcmd 的輸出編碼會跟著環境變（有時 UTF-8、有時系統的 Big5）→ 先當 UTF-8 解，不合法再當 Big5。
  let out
  try {
    out = new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    out = new TextDecoder('big5').decode(buf)
  }
  console.log(out.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim())
} catch (e) {
  console.error('❌ 讀取備份失敗：' + (e.stdout || e.message).toString().trim().slice(0, 500))
  process.exitCode = 1
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
