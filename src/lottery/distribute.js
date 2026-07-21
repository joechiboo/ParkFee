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
// v1 限制（待後續/管委會）：
//   - 重機（佔雙大位）暫不走志願，沿用 seq 取 2 大位（足額＝剩餘大位≥2 才配）；志願僅作用於單格車。
//   - 未填志願者直接列落選（原因「未填志願」），交物業第二階段保底/候補。

import { mulberry32, hashSeed, seededShuffle } from './rng.js'
import { rentableMotorSeats, motorSeats } from '../map/seats.js'
import towerPriority from '../map/tower-priority.json'

export const VIA = {
  ACCESSIBLE: '無障礙',
  VOLUNTEER_SMALL: '志願小位',
  WISH: '志願分發',
  PRESET: '物業指派', // 抽籤前由物業指派（保留/大位保底/重機雙位等），免抽、直接記入結果
  COMPUTER: '電腦選號', // 志願落空且勾電腦選號 → 系統自動配本棟靠電梯剩位
}

// 戶號首字母 → 棟（電梯核心）。A/B→AB、C/D→CD、E/F→EF、G/H→GH。其他（如 S）→ null（無本棟，直接走鄰棟全域序）。
const LETTER_TOWER = { A: 'AB', B: 'AB', C: 'CD', D: 'CD', E: 'EF', F: 'EF', G: 'GH', H: 'GH' }
function householdTower(hid) {
  const m = String(hid || '').toUpperCase().match(/[A-Z]/)
  return m ? (LETTER_TOWER[m[0]] ?? null) : null
}

// 電腦選位候選序：本棟優先序（靠電梯）→ 其餘棟（依核心距離「鄰棟先」）串接。tower-priority.json 由 build-tower-priority.mjs 產。
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
  HEAVY_SHORT: '重機需雙大位、機車位未足額',
}

// 車種 → 可停型別（志願篩選用）。重機另以 seq 取雙大位、不走此表。
const COMPAT = { general: ['大', '小'], small: ['小'] }

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
    // 電腦選號：志願落空時是否要系統自動配本棟剩位。相容舊欄位「志願落選保底」。
    電腦選號:
      r.電腦選號 === true || r.電腦選號 === 'Y' || r.電腦選號 === 'y' ||
      r.志願落選保底 === true || r.志願落選保底 === 'Y' || r.志願落選保底 === 'y',
    _order: index, // 穩定登記序：志願小位選位序、並列決勝
  }
}

// 可變座位池：以 id 追蹤已取，提供「取指定 id」「取某型別最低號」「型別餘量」。
function makePool(seats) {
  const byId = new Map(seats.map((s) => [String(s.id), s]))
  const taken = new Set()
  const remainingOf = (type) =>
    seats.filter((s) => s.type === type && !taken.has(String(s.id))).sort((a, b) => +a.id - +b.id)
  return {
    typeOf: (id) => (byId.get(String(id)) || {}).type ?? null,
    isAvail: (id) => byId.has(String(id)) && !taken.has(String(id)),
    take(id) {
      const k = String(id)
      if (!byId.has(k) || taken.has(k)) return null
      taken.add(k)
      return byId.get(k)
    },
    takeLowest(type) {
      const s = remainingOf(type)[0]
      return s ? this.take(s.id) : null
    },
    countOf: (type) => remainingOf(type).length,
    remaining: () => byId.size - taken.size,
  }
}

// 從戶志願取「仍剩、且車種可停」的最高志願；取得即占用。無則 null。
function pickWish(pool, wishes, compatTypes) {
  for (const id of wishes) {
    if (pool.isAvail(id) && compatTypes.includes(pool.typeOf(id))) return pool.take(id)
  }
  return null
}

export function distribute({
  registrations,
  seats = rentableMotorSeats(),
  seed = 'parkfee',
  runAt = null,
  // 電腦選位候選序：戶號 → 依優先度排好的車位 id 陣列。預設＝本棟靠電梯（tower-priority.json）。可注入供測試。
  computerPickOrder = null,
}) {
  const rng = mulberry32(hashSeed(seed))
  const pool = makePool(seats)
  const entries = registrations.map(toEntry)
  // 物業抽籤前已指派者（vehicle 已有車位編號）：直接列入結果、佔住該戶名額，不進任何抽籤輪。
  const preset = entries.filter((e) => e.車位編號)
  const pending = entries.filter((e) => !e.車位編號)

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

  // 重機：足額（剩餘大位 ≥ 2）才配雙大位；v1 走 seq、不走志願。成功回傳 [s1,s2]，否則 null。
  const takeHeavy = () => {
    if (pool.countOf('大') < 2) return null
    return [pool.takeLowest('大'), pool.takeLowest('大')]
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
  {
    const cands = pending.filter((e) => e.身障 && e.第幾輛 === 1)
    const cap = pool.countOf('無障礙')
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
      const s = pool.takeLowest('無障礙')
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

    // 志願小位：免抽、依登記序。先取志願中的小位，否則最低號小位。
    for (const e of volunteers) {
      const s = pickWish(pool, e.車位志願, COMPAT.small) || pool.takeLowest('小')
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
        const taken = takeHeavy()
        draws.push({ 戶號: e.戶號, 車號: e.車號, 車種: '重機', 順序號: seq, 中籤: !!taken })
        if (!taken) return lose(e, 1, REASON.HEAVY_SHORT, seq)
        record(e, taken, VIA.WISH, 1, seq)
        assignedHouse.add(e.戶號)
        return a.push({ 戶號: e.戶號, 車位編號: taken.map((s) => s.id).join('、'), 順序號: seq, 配位方式: VIA.WISH })
      }
      const s = pickWish(pool, e.車位志願, COMPAT.general)
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
        const taken = takeHeavy()
        draws.push({ 戶號: e.戶號, 車號: e.車號, 車種: '重機', 順序號: seq, 中籤: !!taken })
        if (!taken) return lose(e, nth, REASON.HEAVY_SHORT, seq)
        record(e, taken, VIA.WISH, nth, seq)
        return a.push({ 戶號: e.戶號, 車位編號: taken.map((s) => s.id).join('、'), 順序號: seq, 配位方式: VIA.WISH })
      }
      const s = pickWish(pool, e.車位志願, COMPAT.general)
      draws.push({ 戶號: e.戶號, 車號: e.車號, 順序號: seq, 中籤: !!s })
      if (!s) return lose(e, nth, e.車位志願.length ? REASON.LOST : REASON.NO_WISH, seq)
      record(e, [s], VIA.WISH, nth, seq)
      a.push({ 戶號: e.戶號, 車位編號: s.id, 順序號: seq, 配位方式: VIA.WISH })
    })
    say(`R${nth} 第 ${nth} 位：登記 ${cands.length}，剩餘 ${pool.remaining()}`)
    rounds.push({ round: nth, name: `第 ${nth} 位`, draws, assignments: a })
  }

  // ── 電腦選位：志願落空 + 勾「電腦選號」的一般車，自動配「本棟·靠電梯·剩餘」大位（本棟無剩往鄰棟）──
  //    保底一位優先：先第 1 輛、再第 2 輛+，同組依順序號。凍結/公益位不在池中 → 自動略過。
  //    重機、志願小位不足（NO_SMALL）不走電腦選位（v1）；配不到者維持落選、交物業。
  {
    const key = (x) => `${x.戶號}|${x.車號}|${x.第幾輛}`
    const pickOrder = computerPickOrder || ((hid) => towerCandidateIds(householdTower(hid)))
    const entryOf = new Map(pending.map((e) => [key(e), e]))
    const targets = lost
      .filter((l) => l.原因 === REASON.LOST || l.原因 === REASON.NO_WISH)
      .map((l) => ({ l, e: entryOf.get(key(l)) }))
      .filter(({ e }) => e && e.電腦選號 && e.車種 !== '重機')
      .sort((p, q) => p.e.第幾輛 - q.e.第幾輛 || (p.l.順序號 ?? 0) - (q.l.順序號 ?? 0))

    const a = []
    const rescued = new Set()
    for (const { l, e } of targets) {
      let picked = null
      for (const id of pickOrder(e.戶號)) {
        if (pool.isAvail(id) && COMPAT.general.includes(pool.typeOf(id))) {
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
