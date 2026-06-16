import { describe, it, expect } from 'vitest'
import { formatTWPhone } from './phone.js'

describe('台灣電話格式化', () => {
  it('手機 10 碼 → 4-3-3', () => {
    expect(formatTWPhone('0986642519')).toBe('0986-642-519')
  })
  it('已含空白/連字號也能重排', () => {
    expect(formatTWPhone('0986 642 519')).toBe('0986-642-519')
    expect(formatTWPhone('0986-642-519')).toBe('0986-642-519')
    expect(formatTWPhone('（0986）642519')).toBe('0986-642-519')
  })
  it('市話／不完整：只去非數字、不強斷', () => {
    expect(formatTWPhone('0223456789')).toBe('0223456789')
    expect(formatTWPhone('0986')).toBe('0986')
  })
  it('null/空 → 空字串', () => {
    expect(formatTWPhone(null)).toBe('')
    expect(formatTWPhone('')).toBe('')
  })
})
