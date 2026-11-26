import { describe, it, expect } from 'vitest'
import { rosterWarnings, rosterWarningItems, WARN_TYPE, RED_TYPES, nearPlate, smallSeatProblem } from './roster-warnings.js'
import { plateProblem, plateKey, normalizeTWPlate } from './plate.js'

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
  it('舊式車牌前段字母數字混合：住戶打的連字號位置要保留', () => {
    expect(normalizeTWPlate('K12-345')).toBe('K12-345')
    expect(plateProblem('K12-345')).toBeNull()
    expect(plateProblem('k12－345')).toBeNull()
    expect(plateProblem('K12345')).toMatch(/正確的位置自己打連字號/) // 沒打連字號、自動補錯位置 → 請住戶自己打
    expect(normalizeTWPlate('ABC1234')).toBe('ABC-1234') // 新式車牌沒打連字號照舊自動補
  })
  it('掛牌電動機車 2 碼＋5 碼是真車牌', () => {
    expect(plateProblem('AB-12345')).toBeNull()
  })
  it('碼數不對', () => {
    expect(plateProblem('AB-123456')).toMatch(/格式不對/)
    expect(plateProblem('A-123')).toMatch(/格式不對|正確的位置/)
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

describe('容易落選（不同意電腦選號、有效志願少）', () => {
  const seats = [{ id: 10, public: false }, { id: 11, public: false }, { id: 12, public: false }, { id: 1, public: true }, ...Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, public: false }))]
  const plates = ['QWE-1111', 'RTY-2222', 'UIO-3333', 'PAS-4444', 'DFG-5555', 'HJK-6666', 'ZXC-7777']
  let n = 0
  const one = (hid, wishes, pick, extra = {}) => ({ 戶號: hid, 電話: '', 車位志願: wishes, 志願落選保底: pick, vehicles: [{ 車號: plates[n++], 車種: '一般', 第幾輛: 1, ...extra }] })
  const hh = [
    one('A1-2', ['10'], false),
    one('A1-3', ['10', '11'], false),
    one('A1-4', ['12'], false),
    one('A1-5', ['10'], true),
    one('A1-6', ['100', '101', '102', '103', '104'], false),
    one('A1-7', ['1'], false),
    one('A1-8', ['11'], false, { 車位編號: '250' }),
  ]
  const w = rosterWarnings(hh, { seats, locked: new Set(['12']) })
  it('只排少數幾格又不同意 → 提醒，並寫出每格有幾戶也排', () => {
    expect(w.get('A1-2').join()).toMatch(/只排 1 格又不同意電腦選號.*10 有 2 戶也排/)
    expect(w.get('A1-3').join()).toMatch(/只排 2 格/)
  })
  it('排的都被鎖定、或只排公益位 → 一定落選', () => {
    expect(w.get('A1-4').join()).toMatch(/一定落選/)
    expect(w.get('A1-7').join()).toMatch(/一定落選/)
  })
  it('有勾電腦選號、排夠 5 格、已選定車位的都不提醒', () => {
    expect(w.has('A1-5')).toBe(false)
    expect(w.has('A1-6')).toBe(false)
    expect(w.has('A1-8')).toBe(false)
  })
  it('沒給車位資料就不檢查這項', () => expect(rosterWarnings(hh).has('A1-2')).toBe(false))
})

describe('警示帶種類（名冊頁已處理用）', () => {
  const items = rosterWarningItems([
    { 戶號: 'A6-10', 電話: '0900-000-004', vehicles: [] },
    { 戶號: 'B6-9', 電話: '0900000004', vehicles: [] },
    { 戶號: 'A5-9', 電話: '', vehicles: [{ 車號: '綠色淑女車', 車種: '一般' }] },
  ])
  it('同電話、車號不是車牌各有自己的種類', () => {
    expect(items.get('A6-10').map((w) => w.type)).toEqual([WARN_TYPE.SAME_PHONE])
    expect(items.get('A5-9').map((w) => w.type)).toEqual([WARN_TYPE.PLATE])
  })
})

describe('志願小位與車位對不上（紅色警示，2026-11-26）', () => {
  const car = (o) => ({ 車號: 'ABC-1234', 車種: '一般', 第幾輛: 1, 志願小位: true, 配位狀態: '志願小位', 車位編號: '58', ...o })
  it('正常：第 1 輛、有勾、有格號 → 沒問題', () => {
    expect(smallSeatProblem(car())).toBe('')
  })
  it('沒選格子、或不是志願小位狀態 → 不管', () => {
    expect(smallSeatProblem(car({ 車位編號: '' }))).toBe('')
    expect(smallSeatProblem(car({ 配位狀態: '保留', 志願小位: false }))).toBe('')
    expect(smallSeatProblem(car({ 車種: '自行車', 志願小位: false }))).toBe('')
  })
  it('勾被取消但格子還在（C5-12 型）→ 問要不要，給兩條路', () => {
    const t = smallSeatProblem(car({ 志願小位: false }))
    expect(t).toContain('小位 58')
    expect(t).toContain('修改登記')
    expect(t).toContain('解除 58')
  })
  it('小位掛在第 2 輛（D7-11 型）→ 講明第 1 輛會從結果消失', () => {
    const t = smallSeatProblem(car({ 第幾輛: 2, 志願小位: false, 車位編號: '239' }))
    expect(t).toContain('第 2 輛')
    expect(t).toContain('消失')
    expect(t).toContain('勾回志願小位')
    expect(t).toContain('解除 239')
  })
  it('名冊警示帶紅色種類', () => {
    const items = rosterWarningItems([
      { 戶號: 'C5-12', 電話: '0900-000-111', vehicles: [car({ 志願小位: false })] },
      { 戶號: 'A1-4', 電話: '0900-000-222', vehicles: [car({ 車號: 'XYZ-5678', 車位編號: '59' })] },
    ])
    expect(items.get('C5-12').map((w) => w.type)).toEqual([WARN_TYPE.SMALL_SEAT])
    expect(RED_TYPES.has(WARN_TYPE.SMALL_SEAT)).toBe(true)
    expect(items.has('A1-4')).toBe(false)
  })
})
