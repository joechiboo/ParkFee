import { describe, it, expect } from 'vitest'
import { displayVehicleLabel, isBikeVehicle } from './vehicle.js'

describe('車輛顯示標籤', () => {
  it('機車顯示車牌', () => {
    expect(displayVehicleLabel({ 車種: '一般', 車號: 'ABC-123' })).toBe('ABC-123')
    expect(displayVehicleLabel({ 車種: '重機', 車號: 'XYZ-999' })).toBe('XYZ-999')
  })

  it('自行車不露出合成車號（含戶號，公開版會外洩）', () => {
    const v = { 車種: '自行車', 車號: '自行車-H3-6-1', 第幾輛: 1, 特徵: '黑色捷安特' }
    const label = displayVehicleLabel(v)
    expect(label).toBe('自行車 第1台 · 黑色捷安特')
    expect(label).not.toContain('H3-6')
  })

  it('自行車沒填特徵時仍可辨識第幾台', () => {
    expect(displayVehicleLabel({ 車種: '自行車', 車號: '自行車-A2-1-2', 第幾輛: 2 })).toBe('自行車 第2台')
  })

  it('isBikeVehicle 分得出車種', () => {
    expect(isBikeVehicle({ 車種: '自行車' })).toBe(true)
    expect(isBikeVehicle({ 車種: '一般' })).toBe(false)
    expect(isBikeVehicle(null)).toBe(false)
  })
})
