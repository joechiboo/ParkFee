// 分輪配位引擎 — 純函式、固定 seed → 結果可重現、可稽核。
//
// 唯一事實來源：社區地下室停車場管理辦法。重點條文：
//   §伍 一戶僅得先登記一個機車位，未登記者以棄權論；
//        第一輪以一戶一個機車位抽籤，如有剩餘再進行第二機車位抽籤。
//   §肆 機車位（≤250CC）為機車專用，嚴禁停放其他車種；
//        在機車位「足額」條件下，250CC↑重型機車得停放於「雙機車位」（佔 2 位）。
//   §5.1（HANDOFF）無障礙身障優先；志願小位免抽依登記序選小位。
//
// 分輪：
//   Round 0 無障礙：身障優先。登記 ≤ 8 全配；> 8 抽 8，未中併入 Round 1。
//   Round 1 一戶一位：每戶第 1 個。志願小位免抽（依登記序選小位）；其餘抽資格。
//   Round 2 第二位：僅「如有剩餘」才辦；需求 ≤ 剩餘全配，超額抽資格 + 候補序。
//   Round 3+ ：同 Round 2，依序用前一輪剩餘。
//
// 重機（佔雙位、足額才可）：以「剩餘大位 ≥ 2」作為足額判定，配 2 個大位；
//   不足則列候補（Round 1）或候補（Round 2+）。
//
// 「未登記者以棄權論」：引擎只處理傳入的 registrations，不替任何戶自動補位。
//
// TODO（管委會待拍板，HANDOFF §11）：
//   - 「機車位足額」確切門檻 → 暫以「剩餘大位 ≥ 2」近似，待確認是否為全域前提。
//   - 重機第 1 輛在足額不成立時：暫列候補（不退而求其次給單位），待確認。
//   - 階段 1 是否保障偏好類型/位置 → 目前只保障「一位」，類型由引擎指派。

import { mulberry32, hashSeed, seededShuffle } from './rng.js'
import { buildSpaces, SPACE_TYPE } from '../data/spaces.js'

export const VIA = {
  ACCESSIBLE: '無障礙',
  VOLUNTEER_SMALL: '志願小位',
  LOTTERY: '抽中',
  FULL: '全配', // 需求未超過剩餘，免競爭直接配
}

// 一輛車佔用的車位數：重機佔雙位，其餘佔一位。
const unitsOf = (e) => (e.車種 === '重機' ? 2 : 1)

function toEntry(r, index) {
  return {
    戶號: String(r.戶號),
    車號: String(r.車號 ?? '').toUpperCase(),
    車種: r.車種 === '重機' ? '重機' : '一般',
    第幾輛: Number(r.第幾輛) || 1,
    身障: r.身障 === true || r.身障 === 'Y' || r.身障 === 'y',
    志願小位: r.志願小位 === true || r.志願小位 === 'Y' || r.志願小位 === 'y',
    登記時間: r.登記時間 ?? '',
    聯絡電話: r.聯絡電話 ?? '',
    _order: index, // 穩定的登記順序：志願小位選位序、並列時的決勝
  }
}

function makePools(spaces) {
  const rentable = spaces.filter((s) => !s.public)
  const bySeq = (a, b) => a.seq - b.seq
  return {
    accessible: rentable.filter((s) => s.type === SPACE_TYPE.ACCESSIBLE).sort(bySeq),
    large: rentable.filter((s) => s.type === SPACE_TYPE.LARGE).sort(bySeq),
    small: rentable.filter((s) => s.type === SPACE_TYPE.SMALL).sort(bySeq),
  }
}

export function allocate({ registrations, spaces = buildSpaces(), seed = 'parkfee', runAt = null }) {
  const rng = mulberry32(hashSeed(seed))
  const pools = makePools(spaces)
  const generalUnits = () => pools.large.length + pools.small.length

  const assigned = []
  const waitlist = []
  const unassigned = []
  const rounds = []
  const log = []
  const say = (msg) => log.push(msg)

  const entries = registrations.map(toEntry)
  const assignedHouse = new Set() // 已取得第 1 位的戶（戶號）

  const record = (e, takenSpaces, via, round) => {
    assigned.push({
      戶號: e.戶號,
      車號: e.車號,
      車種: e.車種,
      第幾輛: e.第幾輛,
      車位編號: takenSpaces.map((s) => s.id).join('、'),
      車位類型: takenSpaces.map((s) => s.type).join('、'),
      占用位數: takenSpaces.length,
      配位方式: via,
      輪次: round,
    })
  }

  // 依車種取得所需車位。重機取 2 個大位（足額才可）；志願小位優先小位；其餘優先大位。
  // 成功回傳已取出的車位陣列；不足回傳 null（呼叫端負責列候補/未配，且未動用到的車位已還原）。
  const takeFor = (e) => {
    if (e.車種 === '重機') {
      if (pools.large.length >= 2) return [pools.large.shift(), pools.large.shift()]
      return null // 機車位未足額：剩餘大位 < 2，重機不配
    }
    if (e.志願小位) {
      const s = pools.small.shift() || pools.large.shift()
      return s ? [s] : null
    }
    const s = pools.large.shift() || pools.small.shift()
    return s ? [s] : null
  }

  // ── Round 0：無障礙 ────────────────────────────────────────────────
  {
    const cands = entries.filter((e) => e.身障 && e.第幾輛 === 1)
    const cap = pools.accessible.length
    const draws = []
    let winners
    if (cands.length <= cap) {
      winners = cands
      say(`Round 0 無障礙：登記 ${cands.length} ≤ 可用 ${cap}，全數配位`)
    } else {
      const order = seededShuffle(cands, rng)
      winners = order.slice(0, cap)
      say(`Round 0 無障礙：登記 ${cands.length} > 可用 ${cap}，抽 ${cap} 位，未中 ${cands.length - cap} 併入 Round 1`)
      order.forEach((e, i) => draws.push({ 戶號: e.戶號, 車號: e.車號, 抽出序: i + 1, 中籤: i < cap }))
    }
    const roundAssign = []
    for (const e of winners) {
      const space = pools.accessible.shift()
      if (!space) break
      record(e, [space], VIA.ACCESSIBLE, 0)
      assignedHouse.add(e.戶號)
      roundAssign.push({ 戶號: e.戶號, 車號: e.車號, 車位編號: space.id })
    }
    rounds.push({ round: 0, name: '無障礙', draws, assignments: roundAssign, waitlist: [] })
  }

  // ── Round 1：一戶一位（每戶第 1 個，未在 Round 0 取得者）────────────
  {
    const firstCars = entries.filter((e) => e.第幾輛 === 1 && !assignedHouse.has(e.戶號))
    const volunteers = firstCars.filter((e) => e.志願小位).sort((a, b) => a._order - b._order)
    const others = firstCars.filter((e) => !e.志願小位)
    const roundAssign = []
    const draws = []

    // 志願小位：免抽，依登記順序選小位
    for (const e of volunteers) {
      const taken = takeFor(e)
      if (!taken) {
        unassigned.push({ 戶號: e.戶號, 車號: e.車號, 第幾輛: 1, 原因: '小位不足' })
        continue
      }
      record(e, taken, VIA.VOLUNTEER_SMALL, 1)
      assignedHouse.add(e.戶號)
      roundAssign.push({ 戶號: e.戶號, 車號: e.車號, 車位編號: taken.map((s) => s.id).join('、'), 配位方式: VIA.VOLUNTEER_SMALL })
    }

    // 其餘第 1 輛：抽資格，依抽出序配位
    const order = seededShuffle(others, rng)
    order.forEach((e, i) => {
      const taken = takeFor(e)
      const got = !!taken
      draws.push({ 戶號: e.戶號, 車號: e.車號, 車種: e.車種, 抽出序: i + 1, 中籤: got })
      if (!got) {
        const reason = e.車種 === '重機' ? '重機需雙位、機車位未足額' : '一般車位不足'
        unassigned.push({ 戶號: e.戶號, 車號: e.車號, 第幾輛: 1, 原因: reason })
        return
      }
      record(e, taken, VIA.LOTTERY, 1)
      assignedHouse.add(e.戶號)
      roundAssign.push({ 戶號: e.戶號, 車號: e.車號, 車位編號: taken.map((s) => s.id).join('、'), 配位方式: VIA.LOTTERY })
    })

    say(`Round 1 一戶一位：志願小位 ${volunteers.length}、抽籤 ${others.length}，剩餘位數 ${generalUnits()}`)
    rounds.push({ round: 1, name: '一戶一位', draws, assignments: roundAssign, waitlist: [] })
  }

  // ── Round 2+：第二位起，僅「如有剩餘」才辦 ──────────────────────────
  const extraNths = [...new Set(entries.filter((e) => e.第幾輛 >= 2).map((e) => e.第幾輛))].sort(
    (a, b) => a - b,
  )
  for (const nth of extraNths) {
    const cands = entries.filter((e) => e.第幾輛 === nth)
    const remainingUnits = generalUnits()
    const demandUnits = cands.reduce((sum, e) => sum + unitsOf(e), 0)
    const roundAssign = []
    const roundWaitlist = []
    const draws = []

    if (remainingUnits === 0) {
      say(`Round ${nth} 第 ${nth} 位：無剩餘車位，${cands.length} 件全列候補`)
      cands.forEach((e, i) => {
        const w = { 戶號: e.戶號, 車號: e.車號, 第幾輛: nth, 候補序: i + 1 }
        waitlist.push(w)
        roundWaitlist.push(w)
      })
      rounds.push({ round: nth, name: `第 ${nth} 位`, draws, assignments: roundAssign, waitlist: roundWaitlist })
      continue
    }

    const overSubscribed = demandUnits > remainingUnits
    const order = overSubscribed ? seededShuffle(cands, rng) : cands
    let waitSeq = 0
    order.forEach((e, i) => {
      const taken = takeFor(e)
      if (taken) {
        record(e, taken, overSubscribed ? VIA.LOTTERY : VIA.FULL, nth)
        roundAssign.push({ 戶號: e.戶號, 車號: e.車號, 車位編號: taken.map((s) => s.id).join('、'), 配位方式: overSubscribed ? VIA.LOTTERY : VIA.FULL })
        if (overSubscribed) draws.push({ 戶號: e.戶號, 車號: e.車號, 抽出序: i + 1, 中籤: true })
      } else {
        waitSeq += 1
        const w = { 戶號: e.戶號, 車號: e.車號, 第幾輛: nth, 候補序: waitSeq }
        waitlist.push(w)
        roundWaitlist.push(w)
        if (overSubscribed) draws.push({ 戶號: e.戶號, 車號: e.車號, 抽出序: i + 1, 中籤: false })
      }
    })
    say(
      overSubscribed
        ? `Round ${nth} 第 ${nth} 位：需求 ${demandUnits} 位 > 剩餘 ${remainingUnits} 位，抽籤配位，候補 ${roundWaitlist.length}`
        : `Round ${nth} 第 ${nth} 位：需求 ${demandUnits} 位 ≤ 剩餘 ${remainingUnits} 位，全配`,
    )
    rounds.push({ round: nth, name: `第 ${nth} 位`, draws, assignments: roundAssign, waitlist: roundWaitlist })
  }

  return {
    seed,
    seedHash: hashSeed(seed),
    runAt,
    rounds,
    assigned,
    waitlist,
    unassigned,
    log,
    summary: {
      registrations: entries.length,
      assigned: assigned.length,
      waitlist: waitlist.length,
      unassigned: unassigned.length,
      remaining: generalUnits() + pools.accessible.length,
    },
  }
}
