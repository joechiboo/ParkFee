import { describe, it, expect } from 'vitest'
import { resultRows, resultCSV, signDeadline, RESULT_COLUMNS } from './result.js'

// 手作 distribute() 結果樣本（只含 resultRows 用到的欄位），與引擎解耦。
const sample = {
  assigned: [
    { 戶號: 'A1-1', 車號: 'ABC-123', 車種: '一般', 車位編號: '100', 車位類型: '大', 配位方式: '志願分發' },
    { 戶號: 'B2-3', 車號: 'XYZ-789', 車種: '重機', 車位編號: '150、151', 車位類型: '大、大', 配位方式: '志願分發' },
    { 戶號: 'C3-5', 車號: 'AAA-111', 車種: '一般', 車位編號: '300', 車位類型: '小', 配位方式: '志願小位' },
  ],
  落選: [{ 戶號: 'D4-2', 車號: 'BBB-222', 原因: '志願全落選' }],
}

describe('配位結果匯出（result.js）', () => {
  it('signDeadline = 公告日 + 5 日；空/無效回空字串', () => {
    expect(signDeadline('2026-12-01')).toBe('2026-12-06')
    expect(signDeadline('2026-12-30')).toBe('2027-01-04') // 跨月/跨年
    expect(signDeadline('')).toBe('')
    expect(signDeadline('not-a-date')).toBe('')
  })

  it('resultRows：分配在前、未中在後，欄位正確', () => {
    const rows = resultRows(sample, { 公告日: '2026-12-01' })
    expect(rows).toHaveLength(4)

    expect(rows[0]).toMatchObject({
      戶號: 'A1-1', 車號: 'ABC-123', 車位編號: '100', 車位類型: '大',
      應繳金額: 1200, 簽約期限: '2026-12-06', 狀態: '分配', 備註: '志願分發',
    })
    // 重機 → 3600、雙位
    expect(rows[1]).toMatchObject({ 應繳金額: 3600, 車位編號: '150、151', 狀態: '分配' })
    expect(rows[2]).toMatchObject({ 應繳金額: 1200, 車位類型: '小' })
    // 落選 → 未中、車位/金額/期限留白、備註帶原因
    expect(rows[3]).toMatchObject({
      戶號: 'D4-2', 車位編號: '', 應繳金額: '', 簽約期限: '', 狀態: '未中', 備註: '志願全落選',
    })
  })

  it('未給公告日時簽約期限留白', () => {
    const rows = resultRows(sample)
    expect(rows[0].簽約期限).toBe('')
  })

  it('resultCSV：首列為欄名、含 4 筆資料、CRLF 分隔', () => {
    const csv = resultCSV(sample, { 公告日: '2026-12-01' })
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(RESULT_COLUMNS.join(','))
    expect(lines).toHaveLength(5) // 1 標題 + 4 資料
    expect(lines[1]).toContain('A1-1')
    expect(lines[1]).toContain('1200')
    expect(lines[2]).toContain('150、151') // 頓號非逗號 → toCSV 不加引號
  })

  it('空結果回只有標題列', () => {
    expect(resultCSV({ assigned: [], 落選: [] })).toBe(RESULT_COLUMNS.join(','))
  })
})
