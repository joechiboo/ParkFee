import { describe, it, expect } from 'vitest'
import {
  normalizeRow,
  validateRow,
  buildRoster,
  mergeChannels,
  toYN,
  normalizeVehicleType,
  parseWishes,
  SOURCE,
} from './registry.js'
import { sampleRoster } from './sample.js'

describe('登記列正規化', () => {
  it('是/否 → Y/N', () => {
    expect(toYN('是')).toBe('Y')
    expect(toYN('否')).toBe('N')
    expect(toYN('Y')).toBe('Y')
    expect(toYN('')).toBe('N')
    expect(toYN(true)).toBe('Y')
  })

  it('車種文字 → 一般/重機', () => {
    expect(normalizeVehicleType('一般（≤250CC）')).toBe('一般')
    expect(normalizeVehicleType('重機（250CC↑，紅／黃牌）')).toBe('重機')
  })

  it('parseWishes：分隔字串 → 去空白/去重/保序的陣列', () => {
    expect(parseWishes('123、87，5')).toEqual(['123', '87', '5'])
    expect(parseWishes('  10  20 ')).toEqual(['10', '20'])
    expect(parseWishes('5、5、6')).toEqual(['5', '6']) // 去重
    expect(parseWishes(['1', ' 2 ', ''])).toEqual(['1', '2'])
    expect(parseWishes('')).toEqual([])
    expect(parseWishes(undefined)).toEqual([])
  })

  it('normalizeRow：解析車位志願與志願落選保底', () => {
    const e = normalizeRow({ 戶號: 'H3-6', 車號: 'ABC-123', 車種: '一般', 第幾輛: 1, 車位志願: '12、34', 志願落選保底: '是' })
    expect(e.車位志願).toEqual(['12', '34'])
    expect(e.志願落選保底).toBe('Y')
  })

  it('normalizeRow：車號正規化、第2輛強制身障=N', () => {
    const e = normalizeRow({ 戶號: 'h3-6', 車號: 'abc1234', 車種: '重機', 第幾輛: '2', 身障: '是', 志願小位: '否' })
    expect(e.戶號).toBe('H3-6')
    expect(e.車號).toBe('ABC-1234')
    expect(e.車種).toBe('重機')
    expect(e.第幾輛).toBe(2)
    expect(e.身障).toBe('N') // 第 2 輛無無障礙屬性
  })
})

describe('登記列驗證', () => {
  it('戶號格式錯誤被擋', () => {
    const e = normalizeRow({ 戶號: 'Z99-9', 車號: 'ABC-1234', 車種: '一般', 第幾輛: 1 })
    expect(validateRow(e).errors.length).toBeGreaterThan(0)
  })

  it('合法戶號 H3-6 / S1-2 通過', () => {
    for (const 戶號 of ['H3-6', 'S1-2', 'A12-3']) {
      const e = normalizeRow({ 戶號, 車號: 'ABC-1234', 車種: '一般', 第幾輛: 1 })
      expect(validateRow(e).errors).toHaveLength(0)
    }
  })

  it('重機+志願小位 → 警告（非錯誤）', () => {
    const e = normalizeRow({ 戶號: 'H3-6', 車號: 'BWS-1234', 車種: '重機', 第幾輛: 1, 志願小位: '是' })
    const { errors, warnings } = validateRow(e)
    expect(errors).toHaveLength(0)
    expect(warnings.length).toBeGreaterThan(0)
  })
})

describe('名冊去重與雙管道合併', () => {
  it('一戶多輛保留為多列（非誤刪）', () => {
    const rows = [
      { 戶號: 'H3-6', 車號: 'AAA-1111', 車種: '一般', 第幾輛: 1, 登記時間: 't1' },
      { 戶號: 'H3-6', 車號: 'BBB-2222', 車種: '一般', 第幾輛: 2, 登記時間: 't1' },
    ]
    const { entries, conflicts } = buildRoster(rows)
    expect(entries).toHaveLength(2)
    expect(conflicts).toHaveLength(0)
  })

  it('同戶重複送出（第幾輛重現）→ 取最新一次並列衝突', () => {
    const rows = [
      { 戶號: 'H3-6', 車號: 'OLD-0001', 車種: '一般', 第幾輛: 1, 登記時間: 't1' },
      { 戶號: 'H3-6', 車號: 'NEW-0002', 車種: '一般', 第幾輛: 1, 登記時間: 't2' }, // 第二次送出
    ]
    const { entries, conflicts } = buildRoster(rows)
    expect(entries).toHaveLength(1)
    expect(entries[0].車號).toBe('NEW-0002') // 採最新
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].戶號).toBe('H3-6')
  })

  it('mergeChannels 標來源，線上＋紙本同戶衝突被偵測', () => {
    const online = [{ 戶號: 'H3-6', 車號: 'ON-0001', 車種: '一般', 第幾輛: 1 }]
    const paper = [{ 戶號: 'H3-6', 車號: 'PP-0001', 車種: '一般', 第幾輛: 1 }]
    const { entries, conflicts } = mergeChannels(online, paper)
    expect(entries).toHaveLength(1)
    expect(conflicts).toHaveLength(1)
    expect(entries[0].來源).toBe(SOURCE.PAPER) // 紙本在後 → 視為較新
  })

  it('非法列進 invalid、不污染 entries', () => {
    const { entries, invalid } = buildRoster([
      { 戶號: 'BAD', 車號: 'X', 車種: '一般', 第幾輛: 1 },
      { 戶號: 'H3-6', 車號: 'AAA-1111', 車種: '一般', 第幾輛: 1 },
    ])
    expect(entries).toHaveLength(1)
    expect(invalid).toHaveLength(1)
  })

  it('車位志願/保底為戶層級：只填在第1輛列 → 傳播到全戶各列', () => {
    const { entries } = buildRoster([
      { 戶號: 'H3-6', 車號: 'AAA-1111', 車種: '一般', 第幾輛: 1, 車位志願: '12、34', 志願落選保底: '是' },
      { 戶號: 'H3-6', 車號: 'BBB-2222', 車種: '一般', 第幾輛: 2 }, // 第2輛沒填志願
    ])
    expect(entries).toHaveLength(2)
    for (const e of entries) {
      expect(e.車位志願).toEqual(['12', '34'])
      expect(e.志願落選保底).toBe('Y')
    }
  })
})

describe('範例名冊', () => {
  it('產生有效名冊，跑得過 buildRoster', () => {
    const { entries, invalid, conflicts } = buildRoster(sampleRoster(120))
    expect(invalid).toHaveLength(0)
    expect(conflicts).toHaveLength(0)
    expect(entries.length).toBeGreaterThan(120) // 含第 2、3 輛
    // 每戶都有第 1 輛
    const firsts = entries.filter((e) => e.第幾輛 === 1)
    expect(new Set(firsts.map((e) => e.戶號)).size).toBe(firsts.length)
  })

  it('範例含重機、身障、志願小位、雙管道', () => {
    const { entries } = buildRoster(sampleRoster(120))
    expect(entries.some((e) => e.車種 === '重機')).toBe(true)
    expect(entries.some((e) => e.身障 === 'Y')).toBe(true)
    expect(entries.some((e) => e.志願小位 === 'Y')).toBe(true)
    expect(entries.some((e) => e.來源 === SOURCE.PAPER)).toBe(true)
  })
})
