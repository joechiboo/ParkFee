// 填志願 + 統一分發引擎（決策 A2 / docs/09 §選位作業模式）— 純函式、固定 seed → 可重現、可稽核。
//
// 本檔是「選位＝填志願 + 統一分發」定版配位引擎（取代已移除的舊 seq-based allocate.js）。
// 為定版模型的 **第一階段（自動、可重現）**：
//   抽順序號 → 依順序號由小到大逐戶，分到「該戶志願序中、目前仍剩的最高志願」。
//   志願全落空者 **pass、列入「落選名單」**，不中斷分發、續跑下一順位。全程批次算完、不等住戶。
// 第二階段（物業處理落選者：勾保底→就近補、未勾→候補）為**人工裁量，不在引擎內**。
//
// 座位來源 = 現場盤點 motorSeats()（數字編號 1..655、type 大/小/無障礙、public 公益旗標）。
// 志願編號 = 同一套地面數字編號（住戶對照 B1 平面圖排序）。**非** spaces.js 的「大N/小N」合成編號。
//
// 車位志願為「戶層級」一份（與車輛數無關）：同戶多車依順序號輪流，各取仍剩最高志願（跨輪共用、自動消耗）。
//
// 輪次政策依辦法（選位方式為志願分發，非 seq 取號）：
//   Round 0 無障礙：身障優先，≤可用全配、>可用抽滿（無障礙位非志願制）。
//   Round 1 一戶一位：志願小位免抽依登記序選小位；其餘抽順序號、依序取志願中最高可得。
//   Round 2+ 第二位起：抽順序號依序取志願（剩餘耗盡則自然全落選）。
//
// 重機（2026-08-16 小組決議，docs/17）：不設專區，穿插一般車位取「相鄰兩格」（編號連號；
//   不限大小、可含無障礙——無障礙保留 2 格已走 locked_seat 鎖定、天然排除）。
//   吃戶志願（志願中可湊相鄰對者優先）、否則全場最低號相鄰對；無相鄰對 → 落選 HEAVY_SHORT。
// 社宅（2026-08-16 決議 Q7）：公益位＝社會住宅住戶專用。登記戶帶 社宅 旗標 → 只配公益位；
//   一般戶反之只配非公益位。池預設含公益位（motorSeats），由資格判斷分流。
// v1 限制（待後續/管委會）：未填志願者直接列落選（原因「未填志願」），交物業第二階段保底/候補。

import { mulberry32, hashSeed, seededShuffle } from './rng.js'
import { KIND } from '../map/seat-id.js'
import { motorSeats } from '../map/seats.js'
import towerPriority from '../map/tower-priority.json'
import seatAdjacency from '../map/seat-adjacency.json'

export const VIA = {
  ACCESSIBLE: '無障礙',
  VOLUNTEER_SMALL: '志願小位',
  WISH: '志願分發',
  PRESET: '物業指派', // 抽籤前由物業指派（保留/大位保底/重機雙位等），免抽、直接記入結果
  COMPUTER: '電腦選號', // 志願落空且勾電腦選號 → 系統自動配本棟靠電梯剩位
  STAFF: '工作人員', // 住戶全部配完後，工作人員撿剩餘一般位（免費、可收回）
}

// 戶號首字母 → 棟（電梯核心）。A/B→AB、C/D→CD、E/F→EF、G/H→GH。其他（如 S）→ null（無本棟，直接走鄰棟全域序）。
const LETTER_TOWER = { A: 'AB', B: 'AB', C: 'CD', D: 'CD', E: 'EF', F: 'EF', G: 'GH', H: 'GH' }
function householdTower(hid) {
  const m = String(hid || '').toUpperCase().match(/[A-Z]/)
  return m ? (LETTER_TOWER[m[0]] ?? null) : null
}

// 電腦選位候選序：本棟優先序（靠電梯）→ 其餘棟（依核心距離「鄰棟先」）串接。tower-priority.json 由 build-tower-priority.mjs 產。
// 該檔另有 zones（與 towers 並列的區順序）：公益＝社宅戶候選序；自行車＝預留。
const ZONE_PUBLIC = '公益'
const TP_CORES = towerPriority.meta?.cores ?? {}
function towerCandidateIds(tower) {
  const towers = towerPriority.towers ?? {}
  const own = (tower && towers[tower]) ? towers[tower] : []
  const others = Object.keys(towers).filter((t) => t !== tower)
  if (tower && TP_CORES[tower]) {
    const c = TP_CORES[tower]
    others.sort(
      (a, b) =>
        (TP_CORES[a].x - c.x) ** 2 + (TP_CORES[a].y - c.y) ** 2 -
        ((TP_CORES[b].x - c.x) ** 2 + (TP_CORES[b].y - c.y) ** 2),
    )
  }
  return [...own, ...others.flatMap((t) => towers[t] ?? [])]
}

export const REASON = {
  LOST: '志願全落選', // 有填志願、但都被先順位取走
  NO_WISH: '未填志願',
  NO_SMALL: '小位不足',
  HEAVY_SHORT: '無相鄰兩格可配重機',
  STAFF_PENDING: '暫緩（尚有住戶未配到車位）', // 工作人員專用：住戶優先，讓位義務在前
}

// 車種 → 可停型別（志願篩選用）。重機取相鄰兩格（HEAVY_PAIR_TYPES）或單格無障礙、不走此表。
const COMPAT = { general: ['大', '小'], small: ['小'] }
// 重機「相鄰兩格」的配對候選＝一般機車位（大／小不限，可一大一小或兩小——辦法肆五）。
// **無障礙位不列入配對**：該型車位較寬，一台重機停一格即足（2026-08-24 使用者確認）
// → 走單格路徑，避免一台重機吃掉兩格無障礙位。
const HEAVY_PAIR_TYPES = new Set(['大', '小'])

// 相鄰＝**實體相鄰**（同排橫連或同列直連、中間不夾其他格），不是編號連號。
// 654 對編號連號裡有 71 對其實隔著走道、轉角或跨排（最遠的 276-277 相距 667 單位，
// 橫跨整個地下室）——照編號配，重機車主會拿到兩個停不了的格子。
// 資料由 scripts/build-seat-adjacency.mjs 依座標產生；底圖或分類更動後需重跑。
const REAL_ADJ = seatAdjacency.adj || {}

function toEntry(r, index) {
  return {
    戶號: String(r.戶號),
    車號: String(r.車號 ?? '').toUpperCase(),
    車種: r.車種 === '重機' ? '重機' : '一般',
    第幾輛: Number(r.第幾輛) || 1,
    身障: r.身障 === true || r.身障 === 'Y' || r.身障 === 'y',
    志願小位: r.志願小位 === true || r.志願小位 === 'Y' || r.志願小位 === 'y',
    車位志願: Array.isArray(r.車位志願) ? r.車位志願.map((x) => String(x)) : [], // 戶層級
    車位編號: String(r.車位編號 ?? '').trim(), // 物業抽籤前已指派（空＝待抽）；重機兩位頓號分隔
    已繳費: r.已繳費 === true || r.已繳費 === 'Y' || r.已繳費 === 'y',
    社宅: r.社宅 === true || r.社宅 === 'Y' || r.社宅 === 'y', // 社會住宅住戶 → 只配公益位
    // 社區工作人員（辦法伍二（十二））：與住戶一起登記選位，但**配位排在最後**、只撿剩餘位。
    // 辦法限制的是配位時點（「停車資格程序完結後如有剩餘車位」），不限制登記時點。
    工作人員: r.工作人員 === true || r.工作人員 === 'Y' || r.工作人員 === 'y',

    // 電腦選號：志願落空時是否要系統自動配本棟剩位。相容舊欄位「志願落選保底」。
    電腦選號:
      r.電腦選號 === true || r.電腦選號 === 'Y' || r.電腦選號 === 'y' ||
      r.志願落選保底 === true || r.志願落選保底 === 'Y' || r.志願落選保底 === 'y',
    _order: index, // 穩定登記序：志願小位選位序、並列決勝
  }
}

// 可變座位池：以 id 追蹤已取，提供「取指定 id」「取某型別最低號」「型別餘量」。
// ok＝資格判斷（社宅 ↔ 公益位分流），預設不限。
function makePool(seats) {
  const byId = new Map(seats.map((s) => [String(s.id), s]))
  const taken = new Set()
  const remainingOf = (type, ok = () => true) =>
    seats
      .filter((s) => s.type === type && !taken.has(String(s.id)) && ok(s))
      .sort((a, b) => +a.id - +b.id)
  return {
    seatOf: (id) => byId.get(String(id)) ?? null,
    typeOf: (id) => (byId.get(String(id)) || {}).type ?? null,
    isAvail: (id) => byId.has(String(id)) && !taken.has(String(id)),
    take(id) {
      const k = String(id)
      if (!byId.has(k) || taken.has(k)) return null
      taken.add(k)
      return byId.get(k)
    },
    takeLowest(type, ok) {
      const s = remainingOf(type, ok)[0]
      return s ? this.take(s.id) : null
    },
    countOf: (type, ok) => remainingOf(type, ok).length,
    remaining: () => byId.size - taken.size,
  }
}

// 從戶志願取「仍剩、且車種可停、且資格相符」的最高志願；取得即占用。無則 null。
function pickWish(pool, wishes, compatTypes, ok = () => true) {
  for (const id of wishes) {
    const s = pool.seatOf(id)
    if (s && pool.isAvail(id) && compatTypes.includes(s.type) && ok(s)) return pool.take(id)
  }
  return null
}

// 戶別 → 車位資格：社宅戶只配公益位、一般戶只配非公益位（2026-08-16 Q7 決議）。
const eligibleFor = (e) => (s) => (e.社宅 ? !!s.public : !s.public)

export function distribute({
  registrations,
  seats = motorSeats(), // 含公益位；社宅/一般由 eligibleFor 分流（呼叫端仍應先扣鎖定位）
  seed = 'parkfee',
  runAt = null,
  // 電腦選位候選序：戶號 → 依優先度排好的車位 id 陣列。預設＝本棟靠電梯（tower-priority.json）。可注入供測試。
  computerPickOrder = null,
  // 車位實體相鄰表 { 車位id: [鄰格id…] }。預設讀 seat-adjacency.json（由座標產生）。
  // 測試用合成車位（id 與真實地圖撞號但幾何無關）時注入自己的，否則會被真實幾何否決。
  adjacency = null,
}) {
  const ADJ = adjacency ?? REAL_ADJ
  const rng = mulberry32(hashSeed(seed))
  const pool = makePool(seats)
  // 只處理機車列。自行車走另一支引擎（distribute-bikes.js）—— 若不篩掉，toEntry 會把
  // 車種「自行車」歸成「一般」，然後配給它一個機車位。名冊自 11/15 起會混入自行車。
  const entries = registrations.filter((r) => r.車種 !== KIND.BIKE).map(toEntry)
  // 物業抽籤前已指派者（vehicle 已有車位編號）：直接列入結果、佔住該戶名額，不進任何抽籤輪。
  const preset = entries.filter((e) => e.車位編號)
  const pendingAll = entries.filter((e) => !e.車位編號)
  // 工作人員抽離住戶輪次（R0/R1/R2+/電腦選位），另於最後一輪撿剩位。
  const staff = pendingAll.filter((e) => e.工作人員)
  const pending = pendingAll.filter((e) => !e.工作人員)

  const assigned = []
  const lost = [] // 落選名單 → 交物業第二階段（勾保底→就近補、未勾→候補）
  const rounds = []
  const log = []
  const say = (m) => log.push(m)
  const assignedHouse = new Set()
  // 順序號：跨輪「連續累加」(R1 是 1..N₁、R2 接續 N₁+1…)，每台抽籤車一個唯一號、不重來、不共用。
  // 免抽者(無障礙/志願小位)不佔號。
  let seqCounter = 0

  const record = (e, taken, via, round, seqNo = null) => {
    assigned.push({
      戶號: e.戶號,
      車號: e.車號,
      車種: e.車種,
      第幾輛: e.第幾輛,
      車位編號: taken.map((s) => s.id).join('、'),
      車位類型: taken.map((s) => s.type).join('、'),
      占用位數: taken.length,
      配位方式: via,
      順序號: seqNo,
      輪次: round,
      已繳費: !!e.已繳費, // 物業已指派+繳費者為 true → 結果狀態顯「已繳」；大位中籤者 false →「分配」
    })
  }
  const lose = (e, round, reason, seqNo = null) =>
    lost.push({ 戶號: e.戶號, 車號: e.車號, 第幾輛: e.第幾輛, 輪次: round, 順序號: seqNo, 原因: reason })

  // 重機：穿插一般車位取「相鄰兩格」（編號連號；不限大小、可含無障礙——2026-08-16 決議）。
  // 先取志願中「可湊相鄰對」的格；志願落空/沒填 → 全場最低號相鄰對；無相鄰對 → null（HEAVY_SHORT）。
  // 重機配位（辦法肆五修訂）：相鄰之兩個一般機車位，**或**單獨一個無障礙機車位。
  // 順序：①志願指名的無障礙位 → 單格 ②志願／全池的相鄰兩格 ③湊不到兩格時，退而取剩餘無障礙單格。
  const takeHeavy = (wishList = [], ok = () => true) => {
    const usable = seats.filter((s) => pool.isAvail(s.id) && ok(s))
    const accessibleById = new Map(
      usable.filter((s) => s.type === '無障礙').map((s) => [String(s.id), s]),
    )
    const takeSingle = (ids) => {
      for (const id of ids) {
        const s = accessibleById.get(String(id))
        if (s) return [pool.take(s.id)]
      }
      return null
    }

    // 相鄰兩格：**實體相鄰**（見 ADJ 註解），不是編號連號。
    const availIds = usable
      .filter((s) => HEAVY_PAIR_TYPES.has(s.type))
      .map((s) => String(s.id))
      .sort((a, b) => +a - +b)
    const avail = new Set(availIds)
    // 一格可能左右/上下都有鄰居 → 優先取**編號較大**者，讓指定的格當起點（3 → 3、4 而非 2、3）；
    // 沒有較大的才回頭取較小的。固定規則＝結果可重現。
    const partnerOf = (id) => {
      const ns = (ADJ[String(id)] || [])
        .filter((n) => avail.has(n) && n !== String(id))
        .sort((a, b) => +a - +b)
      return ns.find((n) => +n > +id) ?? ns[ns.length - 1] ?? null
    }
    const pairFrom = (id) => {
      if (!avail.has(String(id))) return null
      const p = partnerOf(id)
      return p ? [String(id), p].sort((a, b) => +a - +b) : null
    }

    // ① **依志願序**逐一嘗試，先中者勝：該志願是無障礙位→取單格（該型較寬，一台重機停一格即足，
    //    2026-08-24 決）；是一般位→取它＋可用鄰格。
    //    ⚠️ 2026-09-02 手動實測修正：原本先掃「志願中有沒有無障礙位」再看配對，
    //    導致排第 5 的無障礙位贏過排第 1 的大位（實例：志願 207、262、190、189、197 → 配到 197），
    //    違反志願序語意。無障礙是**可選的取位方式**，不是優先權。
    for (const w of wishList) {
      const acc = accessibleById.get(String(w))
      if (acc) return [pool.take(acc.id)]
      const p = pairFrom(w)
      if (p) return p.map((x) => pool.take(x))
    }

    // ② 志願全落空 → 全場最低號可湊對者
    for (const id of availIds) {
      const p = pairFrom(id)
      if (p) return p.map((x) => pool.take(x))
    }

    return takeSingle([...accessibleById.keys()]) // ③
  }

  // 車位編號 → 型別查詢：優先用傳入 pool，否則查完整主檔（已指派位多半已 locked、不在 pool）。
  const masterType = new Map(motorSeats().map((s) => [String(s.id), s.type]))
  const lookupType = (id) => pool.typeOf(id) ?? masterType.get(String(id)) ?? ''

  // ── 已指派（物業抽籤前確定：志願小位/無障礙/保留/大位保底 + 繳費）──────────
  if (preset.length) {
    const a = []
    for (const e of preset) {
      const ids = e.車位編號.split('、').map((x) => x.trim()).filter(Boolean)
      const taken = ids.map((id) => {
        pool.take(id) // 防呆：若該位仍在池中則移除，避免重複分配
        return { id, type: lookupType(id) }
      })
      const types = taken.map((s) => s.type)
      const via =
        taken.length > 1
          ? VIA.PRESET
          : types[0] === '無障礙'
            ? VIA.ACCESSIBLE
            : types[0] === '小'
              ? VIA.VOLUNTEER_SMALL
              : VIA.PRESET
      record(e, taken, via, 0)
      assignedHouse.add(e.戶號)
      a.push({ 戶號: e.戶號, 車位編號: taken.map((s) => s.id).join('、'), 配位方式: via })
    }
    say(`已指派（物業抽籤前確定）：${preset.length} 台，免抽、直接記入結果`)
    rounds.push({ round: '指派', name: '物業指派（免抽）', draws: [], assignments: a })
  }

  // ── Round 0：無障礙（身障第 1 輛優先）──────────────────────────────
  // 無障礙位不分社宅／一般身分：有實際需要（身障）即可承租（2026-08-24 使用者決策）。
  // 公益區 20 格無無障礙格，故社宅身障戶配到的是一般無障礙位——這是 Q7「社宅限公益位」
  // 的明文例外；未中籤者仍回 R1 走公益位分流。
  {
    const nonPublic = (s) => !s.public
    const cands = pending.filter((e) => e.身障 && e.第幾輛 === 1)
    const cap = pool.countOf('無障礙', nonPublic)
    const draws = []
    let winners
    if (cands.length <= cap) {
      winners = cands
      say(`R0 無障礙：登記 ${cands.length} ≤ 可用 ${cap}，全配`)
    } else {
      const order = seededShuffle(cands, rng)
      winners = order.slice(0, cap)
      order.forEach((e, i) => draws.push({ 戶號: e.戶號, 車號: e.車號, 順序號: i + 1, 中籤: i < cap }))
      say(`R0 無障礙：登記 ${cands.length} > 可用 ${cap}，抽 ${cap}，未中 ${cands.length - cap} 併入 R1`)
    }
    const a = []
    for (const e of winners) {
      const s = pool.takeLowest('無障礙', nonPublic)
      if (!s) break
      record(e, [s], VIA.ACCESSIBLE, 0)
      assignedHouse.add(e.戶號)
      a.push({ 戶號: e.戶號, 車位編號: s.id })
    }
    rounds.push({ round: 0, name: '無障礙', draws, assignments: a })
  }

  // ── Round 1：一戶一位（每戶第 1 個，未在 R0 取得者）──────────────────
  {
    const firstCars = pending.filter((e) => e.第幾輛 === 1 && !assignedHouse.has(e.戶號))
    const volunteers = firstCars.filter((e) => e.志願小位).sort((a, b) => a._order - b._order)
    const others = firstCars.filter((e) => !e.志願小位)
    const a = []
    const draws = []

    // 志願小位：免抽、依登記序。先取志願中的小位，否則最低號小位（社宅戶＝公益小位）。
    for (const e of volunteers) {
      const ok = eligibleFor(e)
      const s = pickWish(pool, e.車位志願, COMPAT.small, ok) || pool.takeLowest('小', ok)
      if (!s) {
        lose(e, 1, REASON.NO_SMALL)
        continue
      }
      record(e, [s], VIA.VOLUNTEER_SMALL, 1)
      assignedHouse.add(e.戶號)
      a.push({ 戶號: e.戶號, 車位編號: s.id, 配位方式: VIA.VOLUNTEER_SMALL })
    }

    // 其餘第 1 輛：抽順序號，依序取志願。
    const order = seededShuffle(others, rng)
    order.forEach((e, i) => {
      const seq = ++seqCounter
      if (e.車種 === '重機') {
        const taken = takeHeavy(e.車位志願, eligibleFor(e))
        draws.push({ 戶號: e.戶號, 車號: e.車號, 車種: '重機', 順序號: seq, 中籤: !!taken })
        if (!taken) return lose(e, 1, REASON.HEAVY_SHORT, seq)
        record(e, taken, VIA.WISH, 1, seq)
        assignedHouse.add(e.戶號)
        return a.push({ 戶號: e.戶號, 車位編號: taken.map((s) => s.id).join('、'), 順序號: seq, 配位方式: VIA.WISH })
      }
      const s = pickWish(pool, e.車位志願, COMPAT.general, eligibleFor(e))
      draws.push({ 戶號: e.戶號, 車號: e.車號, 順序號: seq, 中籤: !!s })
      if (!s) return lose(e, 1, e.車位志願.length ? REASON.LOST : REASON.NO_WISH, seq)
      record(e, [s], VIA.WISH, 1, seq)
      assignedHouse.add(e.戶號)
      a.push({ 戶號: e.戶號, 車位編號: s.id, 順序號: seq, 配位方式: VIA.WISH })
    })

    say(`R1 一戶一位：志願小位 ${volunteers.length}、抽籤 ${others.length}，剩餘 ${pool.remaining()}`)
    rounds.push({ round: 1, name: '一戶一位', draws, assignments: a })
  }

  // ── Round 2+：第二位起（依序用前一輪剩餘；耗盡則自然全落選）──────────
  const extraNths = [...new Set(pending.filter((e) => e.第幾輛 >= 2).map((e) => e.第幾輛))].sort(
    (x, y) => x - y,
  )
  for (const nth of extraNths) {
    const cands = pending.filter((e) => e.第幾輛 === nth)
    const a = []
    const draws = []
    const order = seededShuffle(cands, rng)
    order.forEach((e, i) => {
      const seq = ++seqCounter
      if (e.車種 === '重機') {
        const taken = takeHeavy(e.車位志願, eligibleFor(e))
        draws.push({ 戶號: e.戶號, 車號: e.車號, 車種: '重機', 順序號: seq, 中籤: !!taken })
        if (!taken) return lose(e, nth, REASON.HEAVY_SHORT, seq)
        record(e, taken, VIA.WISH, nth, seq)
        return a.push({ 戶號: e.戶號, 車位編號: taken.map((s) => s.id).join('、'), 順序號: seq, 配位方式: VIA.WISH })
      }
      const s = pickWish(pool, e.車位志願, COMPAT.general, eligibleFor(e))
      draws.push({ 戶號: e.戶號, 車號: e.車號, 順序號: seq, 中籤: !!s })
      if (!s) return lose(e, nth, e.車位志願.length ? REASON.LOST : REASON.NO_WISH, seq)
      record(e, [s], VIA.WISH, nth, seq)
      a.push({ 戶號: e.戶號, 車位編號: s.id, 順序號: seq, 配位方式: VIA.WISH })
    })
    say(`R${nth} 第 ${nth} 位：登記 ${cands.length}，剩餘 ${pool.remaining()}`)
    rounds.push({ round: nth, name: `第 ${nth} 位`, draws, assignments: a })
  }

  // ── 電腦選位：志願落空 + 勾「電腦選號」的一般車，自動配剩餘位 ──
  //    一般戶＝「本棟·靠電梯」（tower-priority.json，本棟無剩往鄰棟）；
  //    社宅戶＝「公益位由小到大」（僅 20 格、同一區，不需分棟排序；tower-priority 不含公益位）。
  //    保底一位優先：先第 1 輛、再第 2 輛+，同組依順序號。凍結位不在池中 → 自動略過。
  //    重機、志願小位不足（NO_SMALL）不走電腦選位（v1）；配不到者維持落選、交物業。
  {
    const key = (x) => `${x.戶號}|${x.車號}|${x.第幾輛}`
    // 公益位候選序：優先用 tower-priority.json 的區順序（zones.公益，可手排），
    // 其後補上池中未列於該序的公益位（依編號）→ 測試 fixture／新解鎖格都吃得到。
    const zonePublic = (towerPriority.zones?.[ZONE_PUBLIC] ?? []).map(String)
    const inZone = new Set(zonePublic)
    const publicSeatIds = [
      ...zonePublic,
      ...seats
        .filter((s) => s.public && !inZone.has(String(s.id)))
        .map((s) => String(s.id))
        .sort((x, y) => +x - +y),
    ]
    // 第 2 參數 entry 供社宅分流；注入版（測試用）只吃戶號、行為不變。
    const pickOrder =
      computerPickOrder ||
      ((hid, e) => (e?.社宅 ? publicSeatIds : towerCandidateIds(householdTower(hid))))
    const entryOf = new Map(pending.map((e) => [key(e), e]))
    const targets = lost
      .filter((l) => l.原因 === REASON.LOST || l.原因 === REASON.NO_WISH)
      .map((l) => ({ l, e: entryOf.get(key(l)) }))
      .filter(({ e }) => e && e.電腦選號 && e.車種 !== '重機')
      .sort((p, q) => p.e.第幾輛 - q.e.第幾輛 || (p.l.順序號 ?? 0) - (q.l.順序號 ?? 0))

    const a = []
    const rescued = new Set()
    for (const { l, e } of targets) {
      const ok = eligibleFor(e)
      let picked = null
      for (const id of pickOrder(e.戶號, e)) {
        const s0 = pool.seatOf(id)
        if (s0 && pool.isAvail(id) && COMPAT.general.includes(s0.type) && ok(s0)) {
          picked = pool.take(id)
          break
        }
      }
      if (!picked) continue // 本棟＋鄰棟皆無剩 → 維持落選
      record(e, [{ id: picked.id, type: picked.type }], VIA.COMPUTER, l.輪次, l.順序號)
      assignedHouse.add(e.戶號)
      rescued.add(key(l))
      a.push({ 戶號: e.戶號, 車位編號: picked.id, 順序號: l.順序號, 配位方式: VIA.COMPUTER, 棟: householdTower(e.戶號) })
    }
    // 已被電腦選位救回者，從落選名單移除
    for (let i = lost.length - 1; i >= 0; i--) if (rescued.has(key(lost[i]))) lost.splice(i, 1)
    if (targets.length) {
      say(`電腦選位：勾選且落空 ${targets.length} 台，配到 ${a.length} 台（本棟優先靠電梯）`)
      rounds.push({ round: '電腦', name: '電腦選位（本棟靠電梯補位）', draws: [], assignments: a })
    }
  }

  // ── 最後一輪：工作人員（辦法伍二（十二））────────────────────────────
  // 住戶全部配完（含電腦選位）後才跑，只撿**剩餘的一般位**：
  //   ・不碰公益位（社宅專用）與無障礙位（留給行動不便者）
  //   ・免收費、須簽承諾書、住戶申請第一個車位時無條件讓出 → 結果標 VIA.STAFF 供後續辨識
  // 依序：先各自志願中仍剩者，再取全場最低號；同順序依登記序（不抽籤——非住戶權利，不佔順序號）。
  if (staff.length) {
    // ⚠️ 住戶優先：只要還有「完全沒配到車位的戶」（第 1 輛落選且該戶無任何配位，
    //    含電腦選位也沒補到），工作人員一律**暫緩**、不先占位——辦法伍二（十二）明定
    //    住戶申請第一個車位時工作人員須無條件讓出，先給了再收回徒增糾紛。
    //    （僅第 2、3 輛落選者不擋：辦法規定工作人員讓位順位在「一戶多位」住戶之前，
    //      即第二位以上之需求不優先於工作人員。）
    const unplaced = lost.filter((l) => l.第幾輛 === 1 && !assignedHouse.has(l.戶號))
    if (unplaced.length) {
      for (const e of staff) lose(e, '工作人員', REASON.STAFF_PENDING)
      say(`工作人員：${staff.length} 台全數暫緩——尚有 ${unplaced.length} 戶未配到車位（住戶優先）`)
      rounds.push({ round: '工作人員', name: '工作人員（暫緩：住戶尚未配完）', draws: [], assignments: [] })
    } else {
    const ok = (s) => !s.public && s.type !== '無障礙'
    const a = []
    for (const e of [...staff].sort((x, y) => x._order - y._order)) {
      if (e.車種 === '重機') {
        const taken = takeHeavy(e.車位志願, ok)
        if (!taken) {
          lose(e, '工作人員', REASON.HEAVY_SHORT)
          continue
        }
        record(e, taken, VIA.STAFF, '工作人員')
        a.push({ 戶號: e.戶號, 車位編號: taken.map((s) => s.id).join('、'), 配位方式: VIA.STAFF })
        continue
      }
      const s = pickWish(pool, e.車位志願, COMPAT.general, ok) || pool.takeLowest('大', ok) || pool.takeLowest('小', ok)
      if (!s) {
        lose(e, '工作人員', REASON.LOST)
        continue
      }
      record(e, [s], VIA.STAFF, '工作人員')
      a.push({ 戶號: e.戶號, 車位編號: s.id, 配位方式: VIA.STAFF })
    }
    say(`工作人員：${staff.length} 台，住戶配完後撿剩位 ${a.length} 台（免費、可收回）`)
    rounds.push({ round: '工作人員', name: '工作人員（住戶配完後之剩餘位）', draws: [], assignments: a })
    }
  }

  return {
    seed,
    seedHash: hashSeed(seed),
    runAt,
    rounds,
    assigned,
    落選: lost, // 第二階段（物業）處理：勾保底→就近補、未勾→候補
    log,
    summary: {
      registrations: entries.length,
      assigned: assigned.length,
      落選: lost.length,
      remaining: pool.remaining(),
    },
  }
}
