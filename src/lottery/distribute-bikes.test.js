import { describe, it, expect } from 'vitest'
import { distributeBikes, BIKE_VIA, BIKE_REASON } from './distribute-bikes.js'
import { KIND, toBikeId } from '../map/seat-id.js'
import { bikeSeats, PUBLIC_BIKE_IDS, motorSeats } from '../map/seats.js'
import { isBikeId } from '../map/seat-id.js'
import { distribute } from './distribute.js'
import { buildRoster } from '../data/registry.js'
import { sampleRoster } from '../data/sample.js'
import { mergedResultRows } from '../export/result.js'

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
    expect(r.assigned.filter((x) => /^B6[45]\d$/.test(x.車位編號))).toHaveLength(0) // 641–655 不配自行車
  })
})

// ── 端到端：混合名冊（機車＋自行車）走完整條線 ───────────────────────────────
// 從 11/15 起真實名冊就是混合的，這條線任一環把車種弄丟都會出事，故整條一起驗。
describe('混合名冊端到端（名冊 → 兩支引擎 → 合併匯出）', () => {
  const { entries, invalid, conflicts } = buildRoster(sampleRoster(277))
  const motor = distribute({ registrations: entries, seats: motorSeats(), seed: '模擬' })
  const bikes = distributeBikes({ registrations: entries, seed: '模擬｜自行車' })

  it('名冊同時含機車與自行車，且無驗證錯誤／誤判重複送出', () => {
    expect(invalid).toEqual([])
    expect(conflicts).toEqual([])
    expect(entries.some((e) => e.車種 === KIND.BIKE)).toBe(true)
    expect(entries.some((e) => e.車種 === '一般')).toBe(true)
    expect(entries.some((e) => e.車種 === '重機')).toBe(true)
  })

  it('兩支引擎各自吃到自己的車種，沒有漏也沒有重疊', () => {
    const motorCount = entries.filter((e) => e.車種 !== KIND.BIKE).length
    const bikeCount = entries.filter((e) => e.車種 === KIND.BIKE).length
    expect(motor.assigned.length + motor.落選.length + motor.待安排.length).toBe(motorCount)
    expect(bikes.summary.registrations).toBe(bikeCount)
    expect(bikes.assigned.length + bikes.落選.length).toBe(bikeCount)
  })

  it('機車位與自行車位完全不互串', () => {
    for (const a of motor.assigned) {
      for (const id of String(a.車位編號).split('、')) expect(isBikeId(id)).toBe(false)
    }
    for (const a of bikes.assigned) expect(isBikeId(a.車位編號)).toBe(true)
  })

  it('合併匯出：兩種車位都在同一份清單，自行車編號已剝前綴、金額為 0', () => {
    const rows = mergedResultRows([motor, bikes], { 公告日: '2026-12-01' })
    expect(rows.length).toBe(entries.length)
    const bikeRows = rows.filter((r) => r.車位類型 === KIND.BIKE)
    expect(bikeRows.length).toBe(bikes.assigned.length)
    for (const r of bikeRows) {
      expect(r.車位編號).toMatch(/^\d+$/) // 已剝 B 前綴與前導零 → 與地面漆一致
      expect(r.應繳金額).toBe(0) // 自行車免費（辦法柒二）
    }
  })
})

describe('兩輪抽籤（2026-11-24：自行車第 2 輛起留到第二輪）', () => {
  // 5 格；3 戶各有第 1 輛，其中 2 戶還有第 2 輛、1 戶有第 3 輛。
  const regs = [
    bike('A1-1'), bike('A1-1', 2), bike('A1-1', 3),
    bike('B2-2'), bike('B2-2', 2),
    bike('C3-3'),
  ]

  it('第一輪只抽每戶第 1 輛，第 2 輛起列待第二輪、不算候補，車位留著', () => {
    const r = run(regs, { stage: 1 })
    expect(r.assigned).toHaveLength(3)
    expect(r.assigned.every((a) => a.第幾輛 === 1)).toBe(true)
    expect(r.落選).toHaveLength(0)
    expect(r.待安排).toHaveLength(3)
    expect(r.待安排.every((w) => w.第幾輛 >= 2 && w.原因 === BIKE_REASON.NEXT_STAGE)).toBe(true)
    expect(r.summary.remaining).toBe(2)
    expect(r.summary.待第二輪).toBe(3)
    expect(r.summary.順序號迄).toBe(3)
  })

  it('第一輪匯出：第 2 輛起的狀態是「待第二輪」', () => {
    const rows = mergedResultRows([run(regs, { stage: 1 })])
    expect(rows).toHaveLength(regs.length)
    expect(rows.filter((x) => x.狀態 === '待第二輪')).toHaveLength(3)
    expect(rows.filter((x) => x.狀態 === '分配')).toHaveLength(3)
  })

  // 模擬 12/1 發佈 → 12/15 重新匯出名冊：車位編號寫回的是剝掉前綴的地面號碼。
  const afterStage1 = () => {
    const s1 = run(regs, { stage: 1 })
    const published = new Map(mergedResultRows([s1]).map((x) => [x.車號, x]))
    const roster = regs.map((g) => ({ ...g, 車位編號: published.get(g.車號).車位編號, 配位狀態: published.get(g.車號).狀態 }))
    return { s1, roster }
  }

  it('第二輪：第一輪抽中的帶地面號碼回來仍算已指派，那一格不會再配給別人', () => {
    const { s1, roster } = afterStage1()
    expect(roster.find((x) => x.第幾輛 === 1).車位編號).toMatch(/^\d+$/) // 前提：名冊裡是裸數字
    const s2 = run(roster, { stage: 2, seqStart: s1.summary.順序號迄 })
    const ids = s2.assigned.map((a) => a.車位編號)
    expect(new Set(ids).size).toBe(ids.length) // 沒有一格配兩次
    expect(ids.every((id) => /^B\d{3}$/.test(id))).toBe(true)
    const kept = s2.assigned.filter((a) => a.配位方式 === BIKE_VIA.PRESET)
    expect(kept.map((a) => a.車位編號).sort()).toEqual(s1.assigned.map((a) => a.車位編號).sort())
  })

  it('第二輪：剩 2 格先給第 2 輛，第 3 輛列候補；順序號接續第一輪', () => {
    const { s1, roster } = afterStage1()
    const s2 = run(roster, { stage: 2, seqStart: s1.summary.順序號迄 })
    const drawn = s2.assigned.filter((a) => a.配位方式 === BIKE_VIA.DRAW)
    expect(drawn).toHaveLength(2)
    expect(drawn.every((a) => a.第幾輛 === 2)).toBe(true)
    expect(drawn.map((a) => a.順序號).sort()).toEqual([4, 5])
    expect(s2.落選).toEqual([expect.objectContaining({ 戶號: 'A1-1', 第幾輛: 3, 順序號: 6 })])
    expect(s2.待安排).toHaveLength(0)
  })

  it('一次跑完（每月演練）行為不變：全部輛次同一次抽完', () => {
    const r = run(regs)
    expect(r.assigned).toHaveLength(5)
    expect(r.落選).toHaveLength(1)
    expect(r.待安排).toHaveLength(0)
  })
})
describe('工作人員自行車排全體住戶之後（2026-11-27）', () => {
  const staff = (name, nth = 1) => bike(`員工-${name}`, nth, { 工作人員: 'Y' })

  it('第一輪：工作人員第 1 輛也不抽，列待第二輪並帶工作人員標記', () => {
    const r = run([bike('A1-1'), staff('甲')], { stage: 1 })
    expect(r.assigned.map((a) => a.戶號)).toEqual(['A1-1'])
    expect(r.待安排).toHaveLength(1)
    expect(r.待安排[0]).toMatchObject({ 戶號: '員工-甲', 原因: BIKE_REASON.NEXT_STAGE, 工作人員: true })
  })

  it('住戶都配到 → 工作人員撿剩位，配位方式＝工作人員', () => {
    const r = run([bike('A1-1'), bike('B2-2', 1), bike('B2-2', 2), staff('甲'), staff('乙')])
    const s = r.assigned.filter((a) => a.戶號.startsWith('員工-'))
    expect(s).toHaveLength(2)
    expect(s.every((a) => a.配位方式 === BIKE_VIA.STAFF)).toBe(true)
    // 工作人員的順序號都排在住戶之後
    const maxResident = Math.max(...r.assigned.filter((a) => !a.戶號.startsWith('員工-')).map((a) => a.順序號))
    expect(Math.min(...s.map((a) => a.順序號))).toBeGreaterThan(maxResident)
  })

  it('還有住戶候補 → 工作人員全數暫緩，不搶住戶的位', () => {
    // 5 格、6 台住戶第 1 輛 → 1 台住戶候補；工作人員一台都不能配
    const residents = ['A1-1', 'A2-1', 'A3-1', 'A5-1', 'A6-1', 'A7-1'].map((h) => bike(h))
    const r = run([...residents, staff('甲')])
    expect(r.assigned.some((a) => a.戶號.startsWith('員工-'))).toBe(false)
    const s = r.落選.find((l) => l.戶號 === '員工-甲')
    expect(s).toMatchObject({ 原因: BIKE_REASON.STAFF_PENDING, 工作人員: true })
  })

  it('公告版不列工作人員（配到、暫緩、待第二輪都不列）', () => {
    const r1 = run([bike('A1-1'), staff('甲')], { stage: 1 })
    const r2 = run([...['A1-1', 'A2-1', 'A3-1', 'A5-1', 'A6-1', 'A7-1'].map((h) => bike(h)), staff('乙')])
    const r3 = run([bike('A1-1'), staff('丙')])
    for (const r of [r1, r2, r3]) {
      const rows = mergedResultRows([r], { 公開版: true, 含戶號: true })
      expect(rows.some((x) => String(x.戶號).startsWith('員工-'))).toBe(false)
    }
  })
})
