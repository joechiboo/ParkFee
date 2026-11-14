// 12/11 繳費回查的判斷規則：類別用「包含」、未繳費字串、同戶部分未繳不標、地址對不到要列出。
import { describe, it, expect } from 'vitest'
import { paidHouseholdsFrom } from './import-paid-from-shequbang.mjs'
import { parseBillAddress } from './build-shequbang-import.mjs'

const row = (addr, 類別, 狀態, extra = {}) => ({ 帳單編號: 'p1', 住戶地址: addr, 收費類別: 類別, 繳費狀態: 狀態, ...extra })

describe('parseBillAddress — 管理費列表匯出的住戶地址', () => {
  it('門牌＋樓層合併格式拆開並補 #', () => {
    expect(parseBillAddress('H3-297-6樓')).toEqual({ 門牌: '#H3-297', 樓層: '6' })
    expect(parseBillAddress('S2-50-1樓')).toEqual({ 門牌: '#S2-50', 樓層: '1' })
  })
  it('格式不符回 null', () => {
    expect(parseBillAddress('')).toBeNull()
    expect(parseBillAddress('H3-297')).toBeNull()
    expect(parseBillAddress('H3-297-6樓之1')).toBeNull()
  })
})

describe('paidHouseholdsFrom', () => {
  it('已繳＝狀態非空且不是「未繳費」（社區幫把繳費方式填在狀態欄）', () => {
    const r = paidHouseholdsFrom([
      row('H3-297-6樓', '116年度機車位清潔費第一輪', '虛擬帳號'),
      row('A1-375-2樓', '116年度機車位清潔費第一輪', '信用卡'),
      row('B2-379-14樓', '116年度機車位清潔費第一輪', '未繳費'),
      row('C3-371-3樓', '116年度機車位清潔費第一輪', ''),
    ])
    expect(r.已繳戶號).toEqual(['A1-2', 'H3-6'])
    expect(r.未繳戶號).toEqual(['B2-14', 'C3-3'])
  })

  it('收費類別用「包含」比對：跨月合繳串成多類別的列也算；純管理費列不看', () => {
    const r = paidHouseholdsFrom([
      row('H3-297-6樓', '2026年11月管理費,116年度機車位清潔費第一輪', '信用卡'),
      row('A1-375-2樓', '2026年11月管理費', '信用卡'),
    ])
    expect(r.已繳戶號).toEqual(['H3-6'])
    expect(r.略過).toEqual([])
  })

  it('同戶多張、其中一張未繳 → 不標已繳，列進部分繳', () => {
    const r = paidHouseholdsFrom([
      row('H3-297-6樓', '116年度機車位清潔費第一輪', '信用卡'),
      row('H3-297-6樓', '116年度機車位清潔費第一輪', '未繳費'),
    ])
    expect(r.已繳戶號).toEqual([])
    expect(r.部分繳).toEqual(['H3-6'])
  })

  it('地址對不到戶號 → 列進略過並帶列號與帳單編號', () => {
    const r = paidHouseholdsFrom([row('怪地址', '116年度機車位清潔費第一輪', '信用卡', { 帳單編號: 'p9' })])
    expect(r.已繳戶號).toEqual([])
    expect(r.略過).toEqual([{ 列: 2, 原因: '住戶地址對不到戶號：怪地址', 帳單編號: 'p9' }])
  })

  it('--category 可換', () => {
    const r = paidHouseholdsFrom([row('H3-297-6樓', '汽車位清潔費', '信用卡')], { category: '汽車位' })
    expect(r.已繳戶號).toEqual(['H3-6'])
  })
})

describe('兩輪帳單分開回查', () => {
  const rows = [
    row('H3-297-6樓', '116年度機車位清潔費第一輪', '信用卡'),
    row('H3-297-6樓', '116年度機車位清潔費第二輪', '未繳費'),
    row('A1-375-2樓', '116年度機車位清潔費第二輪', '信用卡'),
  ]
  it('第一輪繳了、第二輪沒繳：回查第一輪算已繳，不會被第二輪判成部分繳', () => {
    const r = paidHouseholdsFrom(rows, { category: '機車位清潔費第一輪' })
    expect(r.已繳戶號).toEqual(['H3-6'])
    expect(r.部分繳).toEqual([])
  })
  it('回查第二輪只看第二輪的帳單', () => {
    const r = paidHouseholdsFrom(rows, { category: '機車位清潔費第二輪' })
    expect(r.已繳戶號).toEqual(['A1-2'])
    expect(r.未繳戶號).toEqual(['H3-6'])
  })
})
