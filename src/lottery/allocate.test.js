import { describe, it, expect } from 'vitest'
import { allocate, VIA } from './allocate.js'
import { SPACE_TYPE } from '../data/spaces.js'

// 測試用：自訂車位池（避免每次都用 655 全量）。
function spaceSet({ large = 0, small = 0, accessible = 0 }) {
  const mk = (type, n) =>
    Array.from({ length: n }, (_, i) => ({ id: `${type}${i + 1}`, type, seq: i + 1, public: false }))
  return [
    ...mk(SPACE_TYPE.LARGE, large),
    ...mk(SPACE_TYPE.SMALL, small),
    ...mk(SPACE_TYPE.ACCESSIBLE, accessible),
  ]
}

// 測試用：產生 n 戶第 1 輛一般機車登記。
function firstCars(n, opts = {}) {
  return Array.from({ length: n }, (_, i) => ({
    戶號: `H${i + 1}`,
    車號: `AAA-${1000 + i}`,
    車種: '一般',
    第幾輛: 1,
    身障: 'N',
    志願小位: 'N',
    登記時間: `2026-11-${15}T00:00:${String(i).padStart(2, '0')}`,
    ...opts,
  }))
}

describe('配位引擎', () => {
  it('同 seed → 結果完全一致（可重現）', () => {
    const regs = firstCars(50)
    const spaces = spaceSet({ large: 30, small: 30 })
    const a = allocate({ registrations: regs, spaces, seed: '樂菲2026' })
    const b = allocate({ registrations: regs, spaces, seed: '樂菲2026' })
    expect(b.assigned).toEqual(a.assigned)
    expect(b.waitlist).toEqual(a.waitlist)
    expect(b.unassigned).toEqual(a.unassigned)
  })

  it('不同 seed → 抽出順序通常不同', () => {
    const regs = firstCars(50)
    const spaces = spaceSet({ large: 60, small: 0 })
    const a = allocate({ registrations: regs, spaces, seed: 'seed-A' })
    const b = allocate({ registrations: regs, spaces, seed: 'seed-B' })
    const orderA = a.rounds[1].draws.map((d) => d.戶號).join(',')
    const orderB = b.rounds[1].draws.map((d) => d.戶號).join(',')
    expect(orderA).not.toBe(orderB)
  })

  it('Round 1：容量足時，每戶第 1 輛都配到一位', () => {
    const regs = firstCars(100)
    const spaces = spaceSet({ large: 80, small: 80 })
    const res = allocate({ registrations: regs, spaces, seed: 's' })
    const houses = new Set(res.assigned.map((a) => a.戶號))
    expect(houses.size).toBe(100)
    expect(res.unassigned).toHaveLength(0)
  })

  it('Round 0 無障礙：登記 ≤ 8 全配', () => {
    const regs = firstCars(5).map((r) => ({ ...r, 身障: 'Y' }))
    const spaces = spaceSet({ large: 10, accessible: 8 })
    const res = allocate({ registrations: regs, spaces, seed: 's' })
    const acc = res.assigned.filter((a) => a.配位方式 === VIA.ACCESSIBLE)
    expect(acc).toHaveLength(5)
  })

  it('Round 0 無障礙：登記 > 8 只配 8，未中併入 Round 1 拿一般位', () => {
    const regs = firstCars(12).map((r) => ({ ...r, 身障: 'Y' }))
    const spaces = spaceSet({ large: 20, accessible: 8 })
    const res = allocate({ registrations: regs, spaces, seed: 's' })
    const acc = res.assigned.filter((a) => a.配位方式 === VIA.ACCESSIBLE)
    expect(acc).toHaveLength(8)
    // 未中的 4 位在 Round 1 拿到一般位 → 全部 12 戶都有位
    expect(new Set(res.assigned.map((a) => a.戶號)).size).toBe(12)
  })

  it('志願小位：免抽、優先拿小位', () => {
    const regs = firstCars(3).map((r) => ({ ...r, 志願小位: 'Y' }))
    const spaces = spaceSet({ large: 10, small: 10 })
    const res = allocate({ registrations: regs, spaces, seed: 's' })
    const vol = res.assigned.filter((a) => a.配位方式 === VIA.VOLUNTEER_SMALL)
    expect(vol).toHaveLength(3)
    expect(vol.every((a) => a.車位類型 === SPACE_TYPE.SMALL)).toBe(true)
  })

  it('Round 2：超額 → 產生候補，候補序連號', () => {
    // 第 1 輪用掉一些，第 2 輪需求 > 剩餘
    const first = firstCars(5)
    const second = firstCars(10).map((r) => ({ ...r, 戶號: `${r.戶號}`, 第幾輛: 2, 車號: `BBB-${r.車號}` }))
    const spaces = spaceSet({ large: 8, small: 0 }) // 5 給第1輪，剩 3 給第2輪的 10 件
    const res = allocate({ registrations: [...first, ...second], spaces, seed: 's' })
    const round2 = res.rounds.find((r) => r.round === 2)
    expect(round2.assignments).toHaveLength(3)
    expect(res.waitlist).toHaveLength(7)
    // 候補序 1..7 連號
    expect(res.waitlist.map((w) => w.候補序)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('重機：佔 2 個大位', () => {
    const regs = [{ 戶號: 'H1', 車號: 'BWS-001', 車種: '重機', 第幾輛: 1, 身障: 'N', 志願小位: 'N' }]
    const spaces = spaceSet({ large: 4, small: 4 })
    const res = allocate({ registrations: regs, spaces, seed: 's' })
    expect(res.assigned).toHaveLength(1)
    expect(res.assigned[0].占用位數).toBe(2)
    expect(res.assigned[0].車位類型).toBe(`${SPACE_TYPE.LARGE}、${SPACE_TYPE.LARGE}`)
  })

  it('重機：機車位未足額（剩餘大位 < 2）→ 不配、列未配並註明原因', () => {
    const regs = [{ 戶號: 'H1', 車號: 'BWS-001', 車種: '重機', 第幾輛: 1, 身障: 'N', 志願小位: 'N' }]
    const spaces = spaceSet({ large: 1, small: 5 }) // 大位只剩 1，不足雙位
    const res = allocate({ registrations: regs, spaces, seed: 's' })
    expect(res.assigned).toHaveLength(0)
    expect(res.unassigned).toHaveLength(1)
    expect(res.unassigned[0].原因).toContain('重機')
  })
})
