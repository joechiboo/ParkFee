import { describe, it, expect } from 'vitest'
import { normalizeHousehold, isValidHousehold } from './household.js'

describe('戶號正規化', () => {
  it('轉大寫、去頭尾與中間空白', () => {
    expect(normalizeHousehold(' h3-6 ')).toBe('H3-6')
    expect(normalizeHousehold('h3 - 6')).toBe('H3-6')
  })
  it('全形數字/英文/破折號 → 半形', () => {
    expect(normalizeHousehold('Ｈ３－６')).toBe('H3-6')
    expect(normalizeHousehold('h3—6')).toBe('H3-6') // em dash
  })
  it('null/空 → 空字串', () => {
    expect(normalizeHousehold(null)).toBe('')
    expect(normalizeHousehold('')).toBe('')
  })
})

describe('戶號驗證', () => {
  it('住宅 A–H 合法（樓 1–15）', () => {
    expect(isValidHousehold('H3-6')).toBe(true)
    expect(isValidHousehold('A1-1')).toBe(true)
    expect(isValidHousehold('G15-12')).toBe(true)
    expect(isValidHousehold('h3-6')).toBe(true) // 正規化後合法
    expect(isValidHousehold('Ｈ３－６')).toBe(true)
  })
  it('店面 S（1F）合法，樓層可省', () => {
    expect(isValidHousehold('S1-6')).toBe(true)
    expect(isValidHousehold('S-6')).toBe(true)
  })
  it('不合法：樓>15 / 缺樓 / 棟別錯 / 缺格式', () => {
    expect(isValidHousehold('H16-1')).toBe(false) // 樓層超過 15
    expect(isValidHousehold('H0-1')).toBe(false) // 樓層 0
    expect(isValidHousehold('H-6')).toBe(false) // 住宅缺樓層
    expect(isValidHousehold('Z3-6')).toBe(false) // 無此棟別
    expect(isValidHousehold('36')).toBe(false) // 缺棟別與分隔
    expect(isValidHousehold('H3_6')).toBe(false) // 分隔符錯
  })
})