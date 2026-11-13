// 開放登記當天（11/15）的實測：用一個測試戶把住戶會做的事在正式站走一遍，確認都成功，最後清掉。
//
// 走的步驟：新戶登記 → 登入 → 修改登記（加一台車）→ 排大車位志願 → 選定小車位 → 放棄小車位 → 刪除測試戶。
// 測試戶：Z97（Z 開頭＝測試棟，社區沒有這一棟，不會撞到真實住戶）；車號 TEST-097、TEST-098。
//
// 用法：node scripts/verify-opening.mjs
//   - 時窗還沒開：第一步就被擋（顯示尚未開放），不會建立任何資料，直接結束。開放前可以先跑一次確認這點。
//   - 時窗已開：七步全走完。最後一步用 Supabase CLI 刪除測試戶（會寫入正式資料庫，僅刪 Z97）；
//     需先 `npx supabase login`。刪除失敗會印出要手動執行的 SQL。
//   - 加 --keep 不刪測試戶（想再用瀏覽器登入 Z97／TEST-097 看畫面時用；看完再跑一次不加 --keep 即清掉）。
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { motorSeats } from '../src/map/seats.js'

const ENV = (() => {
  const env = { ...process.env }
  try {
    for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
      if (m && env[m[1]] == null) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* 無 .env 也行 */
  }
  return env
})()
const URL_ = ENV.VITE_SUPABASE_URL
const KEY = ENV.VITE_SUPABASE_ANON_KEY
if (!URL_ || !KEY) {
  console.error('缺少 VITE_SUPABASE_URL／VITE_SUPABASE_ANON_KEY（.env）')
  process.exit(2)
}
const KEEP = process.argv.includes('--keep')
const HID = 'Z97'
const PLATE = 'TEST-097'
const PLATE2 = 'TEST-098'

async function call(name, body) {
  const res = await fetch(`${URL_}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, data }
}
async function lockedIds() {
  const res = await fetch(`${URL_}/rest/v1/locked_seat?select=車位編號`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  return new Set((await res.json()).map((r) => String(r.車位編號)))
}
let failed = 0
function record(step, ok, note) {
  if (!ok) failed++
  console.log(`${ok ? '✅' : '❌'} ${step}${note ? ` — ${note}` : ''}`)
}
const errOf = (r) => r.data?.error || JSON.stringify(r.data)

console.log(`=== 開放登記實測（測試戶 ${HID}）===`)

// 1) 新戶登記
const reg = await call('register', {
  戶號: HID,
  電話: '0900-000-097',
  vehicles: [{ 車號: PLATE, 車種: '一般', 身障: false, 志願小位: true }],
})
if (reg.status === 403 && /尚未開放|已於 .* 截止/.test(reg.data?.error || '')) {
  console.log(`⏳ 登記目前是關閉的：${reg.data.error}`)
  console.log('   沒有建立任何資料。開放後再跑一次。')
  process.exit(0)
}
if (reg.status === 409) record('新戶登記', true, `${HID} 已存在（上次跑有留下），沿用它繼續`)
else record('新戶登記', reg.status === 200 && !!reg.data?.household, reg.status === 200 ? '成功' : `${reg.status} ${errOf(reg)}`)

// 2) 登入
const login = await call('login', { 戶號: HID, 車號: PLATE })
const h = login.data?.household
record('登入（戶號＋車號）', !!h, h ? `${h.vehicles.length} 台車` : `${login.status} ${errOf(login)}`)

if (h) {
  // 3) 修改登記：加第二台車
  const upd = await call('update-household', {
    戶號: HID,
    電話: h.電話,
    社宅: false,
    工作人員: false,
    vehicles: [
      { 車號: PLATE, 車種: '一般', 身障: false, 志願小位: true },
      { 車號: PLATE2, 車種: '一般', 身障: false, 志願小位: false },
    ],
    認證車號: PLATE,
  })
  record('修改登記（加第二台車）', upd.status === 200 && upd.data?.household?.vehicles?.length === 2, upd.status === 200 ? '成功，共 2 台' : `${upd.status} ${errOf(upd)}`)

  // 挑車位：沒被鎖的大位 3 格當志願、沒被鎖的小位 1 格來選定（都從編號最大的挑，離熱門區遠）
  const locked = await lockedIds()
  const free = motorSeats().filter((s) => !s.public && !locked.has(String(s.id)))
  const big = free.filter((s) => s.type === '大').map((s) => String(s.id)).slice(-3)
  const small = free.filter((s) => s.type === '小').map((s) => String(s.id)).pop()

  // 4) 排大車位志願
  const wish = await call('save-wishes', { 戶號: HID, 車位志願: big, 志願落選保底: true, 認證車號: PLATE })
  const saved = wish.data?.household?.車位志願?.map(String) || []
  record('排大車位志願', wish.status === 200 && saved.join() === big.join(), wish.status === 200 ? `存了 ${saved.join('、')}` : `${wish.status} ${errOf(wish)}`)

  // 5) 選定小車位
  const claim = await call('claim-seat', { op: 'claim', 戶號: HID, 車位編號: small, 認證車號: PLATE })
  const got = claim.data?.household?.vehicles?.find((v) => v.車號 === PLATE)?.車位編號
  const lockedAfter = await lockedIds()
  record(
    '選定小車位',
    claim.status === 200 && String(got) === small && lockedAfter.has(small),
    claim.status === 200 ? `選到 ${got}，該格${lockedAfter.has(small) ? '已鎖定、別人不能再選' : '⚠ 沒有被鎖定'}` : `${claim.status} ${errOf(claim)}`,
  )

  // 6) 放棄小車位
  const rel = await call('claim-seat', { op: 'release', 戶號: HID, 認證車號: PLATE })
  const lockedEnd = await lockedIds()
  record(
    '放棄小車位',
    rel.status === 200 && !lockedEnd.has(small) && lockedEnd.size === locked.size,
    rel.status === 200 ? `${small} 已放回可選，鎖定數回到 ${lockedEnd.size} 格` : `${rel.status} ${errOf(rel)}`,
  )
}

// 7) 清掉測試戶
const WIPE = `delete from public.locked_seat where 車位編號 in (select 車位編號 from public.vehicle where 戶號 = '${HID}' and 車位編號 is not null); delete from public.household where 戶號 = '${HID}';`
if (KEEP) {
  console.log(`⚠ --keep：測試戶 ${HID}（車號 ${PLATE}）留著沒刪。看完畫面後再跑一次不加 --keep 清掉。`)
} else {
  try {
    execSync(`npx --yes supabase db query --remote --yes "${WIPE}"`, { stdio: ['ignore', 'pipe', 'pipe'] })
    const gone = !(await call('login', { 戶號: HID, 車號: PLATE })).data?.household
    record('刪除測試戶', gone, gone ? `${HID} 已不存在` : '刪除指令跑了但還登得進去')
  } catch (e) {
    record('刪除測試戶', false, '自動刪除失敗，請手動執行：')
    console.log(`   npx --yes supabase db query --remote --yes "${WIPE}"`)
  }
}

console.log(failed ? `\n❌ ${failed} 項不符` : '\n✅ 全部通過：登記、修改、排志願、選小位、放棄都正常')
process.exit(failed ? 1 : 0)
