import { describe, it, expect } from 'vitest'
import { formatTWPhone, isValidTWPhone } from './phone.js'

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

describe('台灣電話驗證', () => {
  it('手機 09+8 碼 → 有效（含格式化後）', () => {
    expect(isValidTWPhone('0986642519')).toBe(true)
    expect(isValidTWPhone('0986-642-519')).toBe(true)
  })
  it('市話 0[1-8]+ → 有效', () => {
    expect(isValidTWPhone('0223456789')).toBe(true)
    expect(isValidTWPhone('03-1234567')).toBe(true)
  })
  it('空白（選填）→ 視為有效', () => {
    expect(isValidTWPhone('')).toBe(true)
    expect(isValidTWPhone(null)).toBe(true)
  })
  it('非法：非09手機段位數不對、亂字 → 無效', () => {
    expect(isValidTWPhone('0986')).toBe(false) // 不完整
    expect(isValidTWPhone('0912345')).toBe(false) // 位數不夠
    expect(isValidTWPhone('1234567890')).toBe(false) // 非0開頭
    expect(isValidTWPhone('09866425199')).toBe(false) // 手機多一碼
  })
})
