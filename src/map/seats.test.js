import { describe, it, expect } from 'vitest'
import { motorSeats, carSeats, bikeSeats, seatSummary, DISP_W, DISP_H } from './seats.js'
import { TOTAL } from '../data/spaces.js'

describe('B1 車位空間資料（ground-truth，來源：seat-select-demo.html）', () => {
  it('座標系為 b1.png 顯示空間 2384×1684', () => {
    expect(DISP_W).toBe(2384)
    expect(DISP_H).toBe(1684)
  })

  it('機車位 655（辦法名目全在；498 漏水改 locked_seat 鎖定排除，不再缺號）', () => {
    // 主檔 spaces.js TOTAL=655 名目車位；498 現場漏水不可停，但實體位仍在，改用 locked_seat 鎖定排除（runtime）。
    expect(motorSeats()).toHaveLength(TOTAL)
  })

  it('機車號碼 1..655 連續、無重複、無缺號', () => {
    const ids = motorSeats().map((s) => +s.id)
    expect(new Set(ids).size).toBe(ids.length) // 無重複
    expect(Math.min(...ids)).toBe(1)
    expect(Math.max(...ids)).toBe(655)
    const set = new Set(ids)
    const missing = []
    for (let i = 1; i <= 655; i++) if (!set.has(i)) missing.push(i)
    expect(missing).toEqual([]) // 498 已恢復，無缺號
  })

  it('每個機車位都有型別（大/小/無障礙/重機區），合計 655；重機區＝321-349 共 29 格', () => {
    // 大/小/無障礙的確切分佈仍在現場盤點中（會變動），故只鎖「都有型別且合計正確」。
    const types = motorSeats().map((s) => s.type)
    expect(types.every((t) => ['大', '小', '無障礙', '重機區'].includes(t))).toBe(true)
    expect(types).toHaveLength(655)
    const heavy = motorSeats().filter((s) => s.heavy)
    expect(heavy).toHaveLength(29) // 321-349
    expect(heavy.every((s) => +s.id >= 321 && +s.id <= 349 && s.type === '重機區')).toBe(true)
  })

  it('汽車 55、腳踏車 164，各自號碼無重複', () => {
    expect(carSeats()).toHaveLength(55)
    expect(bikeSeats()).toHaveLength(164)
    expect(new Set(carSeats().map((s) => s.id)).size).toBe(55)
    expect(new Set(bikeSeats().map((s) => s.id)).size).toBe(164)
  })

  it('分類摘要與來源一致（機車三型別合計 655、總點數 929）', () => {
    const s = seatSummary()
    expect(s.car).toBe(55)
    expect(s.bike).toBe(164)
    expect((s.motor || 0) + (s.small || 0) + (s.access || 0)).toBe(655)
    expect(s.total).toBe(929)
  })

  it('每個點都有有效座標', () => {
    for (const s of [...motorSeats(), ...carSeats(), ...bikeSeats()]) {
      expect(s.x).toBeGreaterThanOrEqual(0)
      expect(s.x).toBeLessThanOrEqual(DISP_W)
      expect(s.y).toBeGreaterThanOrEqual(0)
      expect(s.y).toBeLessThanOrEqual(DISP_H)
    }
  })
})
