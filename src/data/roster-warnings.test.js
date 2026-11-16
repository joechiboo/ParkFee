import { describe, it, expect } from 'vitest'
import { rosterWarnings, nearPlate } from './roster-warnings.js'
import { plateProblem, plateKey } from './plate.js'

describe('車號像不像車牌', () => {
  it('正常車牌通過', () => {
    for (const p of ['ABC-1234', 'abc1234', '123-ABC', 'X1Y-234', 'AB-123', 'QWE-5678', 'KM-321']) expect(plateProblem(p)).toBeNull()
  })
  it('自行車特徵、廠牌、「無」被擋，並提示改登記自行車', () => {
    for (const p of ['綠色車身一台和小小車一台', '日月光', '電動代步車', '無']) expect(plateProblem(p)).toMatch(/不是車牌號碼.*自行車/)
  })
  it('英數交錯又沒打連字號 → 要求補連字號', () => {
    expect(plateProblem('X1Y234')).toMatch(/加上連字號/)
  })
  it('碼數不對', () => {
    expect(plateProblem('AB-63858')).toMatch(/格式不對/)
    expect(plateProblem('')).toMatch(/請填車號/)
  })
  it('plateKey 忽略連字號與大小寫', () => {
    expect(plateKey('x1y-234')).toBe(plateKey('X1Y234'))
  })
})

describe('nearPlate', () => {
  it('差一個字、相鄰對調算相近', () => {
    expect(nearPlate('QWE1234', 'QAE1234')).toBe(true)
    expect(nearPlate('RTY5678', 'TRY5678')).toBe(true)
    expect(nearPlate('KLM100', 'KLM101')).toBe(true)
  })
  it('相同、差兩個字、長度不同都不算', () => {
    expect(nearPlate('ABC1234', 'ABC1234')).toBe(false)
    expect(nearPlate('ABC1234', 'ABD1235')).toBe(false)
    expect(nearPlate('ABC123', 'ABC1234')).toBe(false)
  })
})

describe('名冊警示', () => {
  const hh = [
    { 戶號: 'B14-123', 電話: '0900-000-001', vehicles: [{ 車號: 'QWE-1234', 車種: '一般' }] },
    { 戶號: 'B2-9', 電話: '0900-000-002', vehicles: [{ 車號: 'QAE-1234', 車種: '一般' }] },
    { 戶號: 'C2-5', 電話: '', vehicles: [{ 車號: 'X1Y-234', 車種: '一般' }] },
    { 戶號: 'C2-6', 電話: '', vehicles: [{ 車號: 'X1Y234', 車種: '一般' }] },
    { 戶號: 'A5-9', 電話: '0900-000-003', vehicles: [{ 車號: '綠色淑女車', 車種: '一般' }] },
    { 戶號: 'A6-10', 電話: '0900-000-004', vehicles: [{ 車號: '自行車-A6-10-1', 車種: '自行車' }] },
    { 戶號: 'B6-9', 電話: '0900000004', vehicles: [{ 車號: '自行車-B6-9-1', 車種: '自行車' }] },
    { 戶號: 'H3-6', 電話: '0900-000-005', vehicles: [{ 車號: 'XYZ-9876', 車種: '一般' }, { 車號: '自行車-H3-6-1', 車種: '自行車' }] },
  ]
  const w = rosterWarnings(hh)
  it('戶號有誤', () => expect(w.get('B14-123').join()).toMatch(/戶號有誤/))
  it('車號只差一個字 → 兩戶都標', () => {
    expect(w.get('B14-123').join()).toMatch(/與 B2-9 的 QAE-1234 只差一個字/)
    expect(w.get('B2-9').join()).toMatch(/與 B14-123 的 QWE-1234 只差一個字/)
  })
  it('同一台車掛兩戶（連字號有無）', () => {
    expect(w.get('C2-6').join()).toMatch(/與 C2-5 的 X1Y-234 是同一台車/)
    expect(w.get('C2-5').join()).toMatch(/是同一台車/)
  })
  it('車號不是車牌', () => expect(w.get('A5-9').join()).toMatch(/不是車牌.*1,200/))
  it('同電話多戶（忽略連字號）', () => expect(w.get('A6-10').join()).toMatch(/與 B6-9 登記同一支電話/))
  it('正常的戶沒有警示；自行車不檢查車號', () => {
    expect(w.has('H3-6')).toBe(false)
    expect(w.get('A6-10').join()).not.toMatch(/不是車牌/)
  })
})
