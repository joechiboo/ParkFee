import { describe, it, expect } from 'vitest'
import { normalizeHousehold, isValidHousehold, householdProblem, isStaffHousehold, staffHousehold, isTestHousehold } from './household.js'

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
  it('住宅：房型-樓層，須是社區真實存在的戶', () => {
    expect(isValidHousehold('H3-6')).toBe(true) // H3 房型 6 樓
    expect(isValidHousehold('A1-2')).toBe(true)
    expect(isValidHousehold('G6-15')).toBe(true)
    expect(isValidHousehold('A8-3')).toBe(true) // A8 只有 3 樓
    expect(isValidHousehold('h3-6')).toBe(true) // 正規化後合法
    expect(isValidHousehold('Ｈ３－６')).toBe(true)
  })
  it('店面 S1–S15 在 1 樓，只打 S6 會補成 S6-1', () => {
    expect(isValidHousehold('S6-1')).toBe(true)
    expect(isValidHousehold('S15-1')).toBe(true)
    expect(normalizeHousehold('s6')).toBe('S6-1')
    expect(isValidHousehold('S6')).toBe(true)
    expect(isValidHousehold('S6-2')).toBe(false) // 店面沒有 2 樓
    expect(isValidHousehold('S16-1')).toBe(false)
  })
  it('前導 0 去掉，同一戶只有一種寫法', () => {
    expect(normalizeHousehold('h03-06')).toBe('H3-6')
  })
  it('社區沒有的戶一律擋，並說明原因', () => {
    expect(householdProblem('H3-6')).toBeNull()
    expect(householdProblem('B3-385')).toMatch(/門牌號碼/) // 填了門牌、沒填樓層
    expect(householdProblem('H4-6')).toMatch(/沒有 H4 這個房型/) // 房型編號跳過 4
    expect(householdProblem('A5-12')).toBeNull() // 舊規則（棟+樓-戶）會把 12 當第 12 戶
    expect(householdProblem('A12-5')).toMatch(/沒有 A12 這個房型/) // 反著填
    expect(householdProblem('H3-16')).toMatch(/沒有 16 樓/)
    expect(householdProblem('H3-1')).toMatch(/店面/) // 1 樓是店面 S
    expect(householdProblem('F2-2')).toMatch(/3–15 樓/) // F2 從 3 樓起
    expect(householdProblem('A8-5')).toMatch(/只有 3 樓/)
    expect(householdProblem('')).toMatch(/請填寫/)
  })
  it('不合法：缺樓 / 棟別錯 / 缺格式', () => {
    expect(isValidHousehold('H-6')).toBe(false) // 住宅缺房型編號
    expect(isValidHousehold('Z3-6')).toBe(false) // 無此棟別
    expect(isValidHousehold('36')).toBe(false) // 缺棟別與分隔
    expect(isValidHousehold('H3_6')).toBe(false) // 分隔符錯
  })

  // 社區工作人員（2026-08-26）：無戶號 → 合成鍵「員工-<編號>」，沿用同一個識別欄位，
  // 登入仍是「戶號＋車號」比對，故整條登記/選位/結果線不必另做一套。
  describe('工作人員合成戶號', () => {
    it('員工-01 視為合法戶號', () => {
      expect(isValidHousehold('員工-01')).toBe(true)
      expect(isStaffHousehold('員工-01')).toBe(true)
    })

    it('住戶戶號不會被誤判為工作人員', () => {
      expect(isStaffHousehold('A1-2')).toBe(false)
      expect(isStaffHousehold('S6-1')).toBe(false)
    })

    it('員工-<姓名> 亦為合法（櫃檯代打不必維護編號對照表）', () => {
      expect(isValidHousehold('員工-陳進茂')).toBe(true)
      expect(isStaffHousehold('員工-陳進茂')).toBe(true)
    })

    it('staffHousehold：數字補零、姓名原樣', () => {
      expect(staffHousehold(1)).toBe('員工-01')
      expect(staffHousehold(12)).toBe('員工-12')
      expect(staffHousehold('陳大明')).toBe('員工-陳大明')
    })

    it('全形數字與空白照樣正規化', () => {
      expect(isStaffHousehold(' 員工－０３ ')).toBe(true)
    })
  })
})

// 測試棟 Z（2026-10-15）：給經理／委員試玩的帳號，社區無 Z 棟。11/15 前須清除（健檢會攔）。
describe('測試棟 Z', () => {
  it('Z＋1–3 碼數字合法', () => {
    expect(isValidHousehold('Z99')).toBe(true)
    expect(isValidHousehold('z1')).toBe(true) // 小寫會被正規化成大寫
    expect(isValidHousehold('Z123')).toBe(true)
  })
  it('不是 Z 棟格式的仍擋', () => {
    expect(isValidHousehold('Z')).toBe(false)
    expect(isValidHousehold('Z-99')).toBe(false)
    expect(isValidHousehold('Z9999')).toBe(false)
    expect(isValidHousehold('Y99')).toBe(false) // 只開 Z，別的字母照擋
  })
  it('isTestHousehold：Z 棟、/dev 假戶（樓層段 9X）、種子 S1-99X', () => {
    expect(isTestHousehold('Z99')).toBe(true)
    expect(isTestHousehold('S1-99')).toBe(true)
    expect(isTestHousehold('A1-90')).toBe(true)
    expect(isTestHousehold('S1-996')).toBe(true)
    expect(isValidHousehold('S1-996')).toBe(true) // 驗證腳本還要用
    expect(isTestHousehold('H3-6')).toBe(false)
    expect(isTestHousehold('員工-測試員')).toBe(false)
  })
})
