import { describe, it, expect } from 'vitest'
import { motorSeats, carSeats, bikeSeats, seatSummary, DISP_W, DISP_H } from './seats.js'
import { TOTAL } from '../data/spaces.js'

describe('B1 車位空間資料（ground-truth）', () => {
  it('座標系為 b1.png 顯示空間 2384×1684', () => {
    expect(DISP_W).toBe(2384)
    expect(DISP_H).toBe(1684)
  })

  it('機車位數量等於辦法主檔 655', () => {
    expect(motorSeats()).toHaveLength(TOTAL) // 655
  })

  it('機車號碼為 1..655 連續、無重複、無缺號', () => {
    const ids = motorSeats().map((s) => +s.id)
    expect(new Set(ids).size).toBe(655) // 無重複
    expect(Math.min(...ids)).toBe(1)
    expect(Math.max(...ids)).toBe(655)
    const missing = []
    const set = new Set(ids)
    for (let i = 1; i <= 655; i++) if (!set.has(i)) missing.push(i)
    expect(missing).toEqual([]) // 無缺號
  })

  it('汽車 55、腳踏車 164，各自號碼無重複', () => {
    expect(carSeats()).toHaveLength(55)
    expect(bikeSeats()).toHaveLength(164)
    expect(new Set(carSeats().map((s) => s.id)).size).toBe(55)
    expect(new Set(bikeSeats().map((s) => s.id)).size).toBe(164)
  })

  it('分類總數與來源一致（928 = 機655 + 汽55 + 自164 + 排除54）', () => {
    const s = seatSummary()
    expect(s).toEqual({ motor: 655, car: 55, bike: 164, excl: 54, total: 928 })
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
