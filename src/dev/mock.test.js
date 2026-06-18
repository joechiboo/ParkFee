import { describe, it, expect } from 'vitest'
import { makeMockHouseholds, toRows, MOCK_HU_RE } from './mock.js'
import { distribute } from '../lottery/distribute.js'

describe('mock 名冊產生器（dev）', () => {
  const hh = makeMockHouseholds({ count: 20 })

  it('產生 20 戶、跨棟 A–H/S、戶段為清除標記、deterministic', () => {
    expect(hh).toHaveLength(20)
    expect(hh.every((h) => MOCK_HU_RE.test(h.戶號))).toBe(true) // 戶段 9xx（清除用）
    expect(new Set(hh.map((h) => h.戶號[0])).size).toBeGreaterThanOrEqual(5) // 跨多棟
    expect(new Set(hh.map((h) => h.戶號)).size).toBe(20) // 戶號唯一
    // 同參數再產一次 → 完全一致（無亂數）
    expect(JSON.stringify(makeMockHouseholds({ count: 20 }))).toBe(JSON.stringify(hh))
  })

  it('涵蓋多種情境：單/多車、重機、身障、志願小位、志願少選/未填/多選', () => {
    expect(hh.some((h) => h.vehicles.length === 1)).toBe(true)
    expect(hh.some((h) => h.vehicles.length >= 2)).toBe(true)
    expect(hh.some((h) => h.vehicles.some((v) => v.車種 === '重機'))).toBe(true)
    expect(hh.some((h) => h.vehicles.some((v) => v.身障))).toBe(true)
    expect(hh.some((h) => h.vehicles.some((v) => v.志願小位))).toBe(true)
    expect(hh.some((h) => h.車位志願.length === 0)).toBe(true) // 未填
    expect(hh.some((h) => h.車位志願.length >= 15)).toBe(true) // 多選
  })

  it('車號全域唯一、認證車號＝第一台', () => {
    const plates = hh.flatMap((h) => h.vehicles.map((v) => v.車號))
    expect(new Set(plates).size).toBe(plates.length)
    expect(hh.every((h) => h.認證車號 === h.vehicles[0].車號)).toBe(true)
  })

  it('toRows 攤平：每車一列、帶戶層級志願', () => {
    const rows = toRows(hh)
    expect(rows.length).toBe(hh.reduce((n, h) => n + h.vehicles.length, 0))
    expect(rows.every((r) => Array.isArray(r.車位志願))).toBe(true)
  })

  it('能餵真 distribute() 跑出結果（不丟錯）', () => {
    const result = distribute({ registrations: toRows(hh), seed: 'mock-test' })
    expect(result.summary.registrations).toBe(toRows(hh).length)
    expect(result.assigned.length + result.落選.length).toBe(toRows(hh).length)
  })
})
