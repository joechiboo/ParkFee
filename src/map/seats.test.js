import { describe, it, expect } from 'vitest'
import {
  motorSeats,
  carSeats,
  bikeSeats,
  rentableBikeSeats,
  PUBLIC_BIKE_IDS,
  seatSummary,
  DISP_W,
  DISP_H,
} from './seats.js'
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

  it('每個機車位都有型別（大/小/無障礙），合計 655；無「重機區」型別（2026-08-16 決議不設專區）', () => {
    // 大/小/無障礙的確切分佈仍在核對中（Q11，會變動），故只鎖「都有型別且合計正確」。
    const types = motorSeats().map((s) => s.type)
    expect(types.every((t) => ['大', '小', '無障礙'].includes(t))).toBe(true)
    expect(types).toHaveLength(655)
    expect(motorSeats().some((s) => s.heavy)).toBe(false) // 重機專區已拆
    expect(motorSeats().filter((s) => s.type === '無障礙')).toHaveLength(8)
  })

  it('汽車 55、腳踏車 164，各自號碼無重複', () => {
    expect(carSeats()).toHaveLength(55)
    expect(bikeSeats()).toHaveLength(164)
    expect(new Set(carSeats().map((s) => s.id)).size).toBe(55)
    expect(new Set(bikeSeats().map((s) => s.id)).size).toBe(164)
  })

  it('自行車位編號已前綴正規化，與機車編號完全不相交', () => {
    const bikeIds = bikeSeats().map((s) => s.id)
    expect(bikeIds.every((id) => /^B\d{3}$/.test(id))).toBe(true)
    expect(bikeIds[0]).toBe('B001')
    expect(bikeIds.at(-1)).toBe('B164')

    // 撞號防呆：盤點檔裡 164 格自行車有 155 格號碼與機車字面重複，前綴後必須 0 交集。
    const motorIds = new Set(motorSeats().map((s) => s.id))
    expect(bikeIds.filter((id) => motorIds.has(id))).toEqual([])
  })

  it('公益自行車位 114–118 在池內，且可承租池已排除', () => {
    const all = new Set(bikeSeats().map((s) => s.id))
    for (const id of PUBLIC_BIKE_IDS) expect(all.has(id)).toBe(true)
    expect(PUBLIC_BIKE_IDS).toEqual(['B114', 'B115', 'B116', 'B117', 'B118'])
    expect(rentableBikeSeats()).toHaveLength(164 - 5)
    expect(rentableBikeSeats().some((s) => PUBLIC_BIKE_IDS.includes(s.id))).toBe(false)
  })

  it('公益自行車位帶 public 旗標（盤點檔沒標，改依辦法清單貼）', () => {
    const flagged = bikeSeats().filter((s) => s.public)
    expect(flagged.map((s) => s.id)).toEqual(PUBLIC_BIKE_IDS)
    expect(flagged).toHaveLength(5) // 地圖/列印圖要靠這個旗標畫公益標示
    // 機車的公益旗標來自盤點檔（平面圖有金框），兩者來源不同但欄位一致
    expect(motorSeats().filter((s) => s.public)).toHaveLength(20)
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
