import { describe, it, expect } from 'vitest'
import { distributeBikes, BIKE_VIA, BIKE_REASON } from './distribute-bikes.js'
import { KIND, toBikeId } from '../map/seat-id.js'
import { bikeSeats, PUBLIC_BIKE_IDS } from '../map/seats.js'

// 小型測試池：B001–B005，其中 B004/B005 假裝是公益位時另外指定。
const SEATS = (n) => Array.from({ length: n }, (_, i) => ({ id: toBikeId(i + 1), type: KIND.BIKE }))

const bike = (戶號, 第幾輛 = 1, extra = {}) => ({
  戶號,
  車號: `自行車-${戶號}-${第幾輛}`,
  車種: KIND.BIKE,
  第幾輛,
  ...extra,
})

const run = (registrations, opts = {}) =>
  distributeBikes({ registrations, seats: SEATS(5), seed: 'test', socialHousingPublicOnly: false, ...opts })

describe('依辦法抽車位號（非志願分發）', () => {
  it('登記數 ≤ 車位數時全數配到，且每人一格', () => {
    const r = run([bike('A1-1'), bike('B2-2'), bike('C3-3')])
    expect(r.assigned).toHaveLength(3)
    expect(r.落選).toHaveLength(0)
    expect(new Set(r.assigned.map((x) => x.車位編號)).size).toBe(3)
    expect(r.assigned.every((x) => x.配位方式 === BIKE_VIA.DRAW)).toBe(true)
  })

  it('配到的都是正規形車位編號、車位類型標自行車', () => {
    const r = run([bike('A1-1')])
    expect(r.assigned[0].車位編號).toMatch(/^B\d{3}$/)
    expect(r.assigned[0].車位類型).toBe(KIND.BIKE) // 匯出 CSV 靠這欄區分車種
    expect(r.assigned[0].占用位數).toBe(1)
  })

  it('不吃車位志願 —— 填了也不影響結果（辦法伍三：抽車位號碼）', () => {
    const withWish = run([bike('A1-1', 1, { 車位志願: ['B005'] })])
    const without = run([bike('A1-1')])
    expect(withWish.assigned[0].車位編號).toBe(without.assigned[0].車位編號)
  })

  it('同 seed 可重現、不同 seed 會不同（可稽核）', () => {
    const regs = [bike('A1-1'), bike('B2-2'), bike('C3-3')]
    const a = run(regs)
    const b = run(regs)
    const c = run(regs, { seed: 'other-seed' })
    expect(a.assigned).toEqual(b.assigned)
    expect(a.seedHash).toBe(b.seedHash)
    expect(c.seedHash).not.toBe(a.seedHash)
  })
})

describe('供給不足 → 候補（順序號即候補序）', () => {
  it('超額者列候補，且候補序連續不重複', () => {
    const regs = Array.from({ length: 8 }, (_, i) => bike(`A1-${i + 1}`))
    const r = run(regs)
    expect(r.assigned).toHaveLength(5) // 池只有 5 格
    expect(r.落選).toHaveLength(3)
    expect(r.落選.every((l) => l.原因 === BIKE_REASON.SHORT)).toBe(true)

    const seqs = [...r.assigned.map((x) => x.順序號), ...r.落選.map((l) => l.順序號)].sort((a, b) => a - b)
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8]) // 不重來、不共用
  })

  it('候補序在中籤者之後（順序號大的才落選）', () => {
    const regs = Array.from({ length: 8 }, (_, i) => bike(`A1-${i + 1}`))
    const r = run(regs)
    const maxWin = Math.max(...r.assigned.map((x) => x.順序號))
    const minLose = Math.min(...r.落選.map((l) => l.順序號))
    expect(minLose).toBeGreaterThan(maxWin)
  })
})

describe('輪次：第一輛跑完有剩才辦第二輛（辦法伍三(四)）', () => {
  it('第二輛只有在第一輛配完仍有剩餘時才配到', () => {
    const r = run([bike('A1-1', 1), bike('A1-1', 2), bike('B2-2', 1)])
    expect(r.assigned.filter((x) => x.第幾輛 === 1)).toHaveLength(2)
    expect(r.assigned.filter((x) => x.第幾輛 === 2)).toHaveLength(1) // 5 格夠
    // 第 1 輛的順序號全部小於第 2 輛（輪次先後）
    const first = Math.max(...r.assigned.filter((x) => x.第幾輛 === 1).map((x) => x.順序號))
    const second = Math.min(...r.assigned.filter((x) => x.第幾輛 === 2).map((x) => x.順序號))
    expect(second).toBeGreaterThan(first)
  })

  it('第一輛就發完時，第二輛全列候補', () => {
    const regs = [
      ...Array.from({ length: 5 }, (_, i) => bike(`A1-${i + 1}`, 1)),
      bike('A1-1', 2),
      bike('A1-2', 2),
    ]
    const r = run(regs)
    expect(r.assigned).toHaveLength(5)
    expect(r.落選.filter((l) => l.第幾輛 === 2)).toHaveLength(2)
  })
})

describe('物業已指派', () => {
  it('免抽直接記入，且該位不會再被抽到', () => {
    const r = run([bike('A1-1', 1, { 車位編號: 'B003' }), ...Array.from({ length: 5 }, (_, i) => bike(`B2-${i + 1}`))])
    const preset = r.assigned.find((x) => x.戶號 === 'A1-1')
    expect(preset.車位編號).toBe('B003')
    expect(preset.配位方式).toBe(BIKE_VIA.PRESET)
    expect(r.assigned.filter((x) => x.車位編號 === 'B003')).toHaveLength(1) // 沒被重複發
  })
})

describe('社宅 ↔ 公益自行車位分流（Q17）', () => {
  const seats = [...SEATS(3), { id: PUBLIC_BIKE_IDS[0], type: KIND.BIKE }]

  it('開啟時：社宅戶只配公益位、一般戶配不到公益位', () => {
    const r = distributeBikes({
      registrations: [bike('A1-1', 1, { 社宅: true }), bike('B2-2')],
      seats,
      seed: 'test',
      socialHousingPublicOnly: true,
    })
    const sh = r.assigned.find((x) => x.戶號 === 'A1-1')
    const normal = r.assigned.find((x) => x.戶號 === 'B2-2')
    expect(PUBLIC_BIKE_IDS).toContain(sh.車位編號)
    expect(PUBLIC_BIKE_IDS).not.toContain(normal.車位編號)
  })

  it('關閉時（管委會若否決 Q17 類推）：不分流，社宅戶可配一般位', () => {
    const r = distributeBikes({
      registrations: Array.from({ length: 4 }, (_, i) => bike(`A1-${i + 1}`, 1, { 社宅: true })),
      seats,
      seed: 'test',
      socialHousingPublicOnly: false,
    })
    expect(r.assigned).toHaveLength(4) // 4 格全用得到，含非公益位
  })
})

describe('與機車名冊混用', () => {
  it('只處理自行車列，機車列原樣忽略', () => {
    const r = run([bike('A1-1'), { 戶號: 'B2-2', 車號: 'ABC-123', 車種: '一般', 第幾輛: 1 }])
    expect(r.summary.registrations).toBe(1)
    expect(r.assigned).toHaveLength(1)
    expect(r.assigned[0].戶號).toBe('A1-1')
  })
})

describe('全量真實池', () => {
  it('164 格全滿時，655 戶登記 → 164 中籤、491 候補', () => {
    const regs = Array.from({ length: 655 }, (_, i) => bike(`A1-${i + 1}`))
    const r = distributeBikes({
      registrations: regs,
      seats: bikeSeats(),
      seed: '2026',
      socialHousingPublicOnly: false,
    })
    expect(r.assigned).toHaveLength(164)
    expect(r.落選).toHaveLength(655 - 164)
    expect(new Set(r.assigned.map((x) => x.車位編號)).size).toBe(164) // 無重複配位
  })
})
