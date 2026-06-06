import { describe, it, expect } from 'vitest'
import { normalizeTWPlate } from './plate.js'

describe('車牌正規化', () => {
  it('轉大寫、去空白、補連字號', () => {
    expect(normalizeTWPlate('abc1234')).toBe('ABC-1234')
    expect(normalizeTWPlate('ABC 1234')).toBe('ABC-1234')
    expect(normalizeTWPlate('abc-1234')).toBe('ABC-1234')
  })

  it('數字在前的車牌也補連字號', () => {
    expect(normalizeTWPlate('1234ab')).toBe('1234-AB')
  })

  it('全形連字號／空白正規化', () => {
    expect(normalizeTWPlate('ＡＢＣ－1234'.replace(/[ＡＢＣ]/g, (m) => ({ Ａ: 'A', Ｂ: 'B', Ｃ: 'C' })[m]))).toBe('ABC-1234')
    expect(normalizeTWPlate('ABC—1234')).toBe('ABC-1234')
  })

  it('空值安全', () => {
    expect(normalizeTWPlate('')).toBe('')
    expect(normalizeTWPlate(null)).toBe('')
    expect(normalizeTWPlate(undefined)).toBe('')
  })

  it('不盲改 O/0 等易混字（人工輸入不做 OCR 修正）', () => {
    expect(normalizeTWPlate('O0O-1010')).toBe('O0O-1010')
  })
})
