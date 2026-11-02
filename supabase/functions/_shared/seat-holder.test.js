import { describe, it, expect } from 'vitest'
import { holderOf, planAssign, seatIdsOf } from './seat-holder.ts'

const rows = [
  { 車號: 'A', 戶號: 'A1-1', 車位編號: '150、151' },
  { 車號: 'B', 戶號: 'B1-1', 車位編號: '9' },
  { 車號: 'C', 戶號: 'C1-1', 車位編號: null },
]

describe('holderOf', () => {
  it('單格精確比對', () => expect(holderOf(rows, '9')?.車號).toBe('B'))
  it('重機雙位任一格都算', () => expect(holderOf(rows, '151')?.車號).toBe('A'))
  it('編號前綴不算（15 不是 150）', () => expect(holderOf(rows, '15')).toBeNull())
  it('沒有人持有回 null', () => expect(holderOf(rows, '8')).toBeNull())
  it('空清單回 null', () => expect(holderOf(null, '8')).toBeNull())
})

describe('planAssign', () => {
  const heavy = { 車種: '重機', 車位編號: null }
  it('一般車照舊一格', () => expect(planAssign('9', '', { 車種: '一般' })).toEqual({ ids: ['9'] }))
  it('沒車號的純鎖定照舊一格', () => expect(planAssign('9', '', null)).toEqual({ ids: ['9'] }))
  it('重機帶相鄰格 → 兩格、依編號排序', () => expect(planAssign('151', '150', heavy)).toEqual({ ids: ['150', '151'] }))
  it('重機沒帶相鄰格 → 擋下', () => expect(planAssign('150', '', heavy)).toHaveProperty('error'))
  it('重機只改繳費 → 沿用原本兩格，不會縮成一格', () =>
    expect(planAssign('151', '', { 車種: '重機', 車位編號: '150、151' })).toEqual({ ids: ['150', '151'] }))
  it('重機選了不屬於自己的格又沒帶相鄰格 → 擋下', () =>
    expect(planAssign('300', '', { 車種: '重機', 車位編號: '150、151' })).toHaveProperty('error'))
  it('一般車帶兩格 → 擋下', () => expect(planAssign('150', '151', { 車種: '一般' })).toHaveProperty('error'))
  it('查無此車帶兩格 → 擋下', () => expect(planAssign('150', '151', null)).toHaveProperty('error'))
  it('相鄰格與主格相同 → 擋下', () => expect(planAssign('150', '150', heavy)).toHaveProperty('error'))
})

describe('seatIdsOf', () => {
  it('拆雙位', () => expect(seatIdsOf('150、151')).toEqual(['150', '151']))
  it('空值回空陣列', () => expect(seatIdsOf(null)).toEqual([]))
})
