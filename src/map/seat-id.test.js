import { describe, it, expect } from 'vitest'
import {
  KIND,
  toBikeId,
  isBikeId,
  seatKind,
  displaySeatId,
  seatSortKey,
  compareSeatId,
  normalizeSeatInput,
} from './seat-id.js'

describe('toBikeId 正規化', () => {
  it('各種輸入都收斂到 B + 三位補零', () => {
    for (const raw of [12, '12', '012', 'B012', 'b12', ' 12 ']) {
      expect(toBikeId(raw)).toBe('B012')
    }
  })

  it('邊界：1 與 164', () => {
    expect(toBikeId(1)).toBe('B001')
    expect(toBikeId(164)).toBe('B164')
  })

  it('非法輸入回空字串', () => {
    for (const raw of ['', null, undefined, 'abc', '0', '-3', '1.5']) {
      expect(toBikeId(raw)).toBe('')
    }
  })
})

describe('車種判別', () => {
  it('裸數字＝機車、B 開頭＝自行車', () => {
    expect(seatKind('123')).toBe(KIND.MOTOR)
    expect(seatKind('B012')).toBe(KIND.BIKE)
    expect(isBikeId('B012')).toBe(true)
    expect(isBikeId('12')).toBe(false)
  })

  it('撞號的號碼靠前綴分得開', () => {
    // 現場：機車 12 與自行車 12 是不同的兩格
    expect(seatKind('12')).not.toBe(seatKind(toBikeId('12')))
  })
})

describe('displaySeatId 剝前綴給住戶看', () => {
  it('自行車剝掉前綴與前導零，與地面漆的數字一致', () => {
    expect(displaySeatId('B012')).toBe('12')
    expect(displaySeatId('B001')).toBe('1')
    expect(displaySeatId('B164')).toBe('164')
  })

  it('機車原樣', () => {
    expect(displaySeatId('123')).toBe('123')
    expect(displaySeatId('1')).toBe('1')
  })

  it('顯示後兩種車的 12 號長得一樣（故車種須由上下文表達）', () => {
    expect(displaySeatId('B012')).toBe(displaySeatId('12'))
  })
})

describe('排序', () => {
  it('seatSortKey 取數值，不會像 +id 那樣得到 NaN', () => {
    expect(seatSortKey('B012')).toBe(12)
    expect(seatSortKey('123')).toBe(123)
    expect(Number.isNaN(+'B012')).toBe(true) // 對照：直接轉數字會炸
  })

  it('補零讓純字串排序也正確（CSV / SQL order by 用）', () => {
    const ids = ['B010', 'B009', 'B100', 'B002']
    expect([...ids].sort()).toEqual(['B002', 'B009', 'B010', 'B100'])
  })

  it('compareSeatId 依數值排', () => {
    const ids = ['B100', 'B009', 'B010', 'B002']
    expect(ids.sort(compareSeatId)).toEqual(['B002', 'B009', 'B010', 'B100'])
  })
})

describe('normalizeSeatInput 人手輸入', () => {
  it('同樣打 12，車種決定結果', () => {
    expect(normalizeSeatInput('12', KIND.BIKE)).toBe('B012')
    expect(normalizeSeatInput('12', KIND.MOTOR)).toBe('12')
  })

  it('預設為機車（既有批次鎖定行為不變）', () => {
    expect(normalizeSeatInput('423')).toBe('423')
  })

  it('機車情境誤打 B012 視為非法，不會被當成機車 12', () => {
    expect(normalizeSeatInput('B012', KIND.MOTOR)).toBe('')
  })

  it('機車去前導零，避免 012 與 12 變成兩格', () => {
    expect(normalizeSeatInput('012', KIND.MOTOR)).toBe('12')
  })
})
