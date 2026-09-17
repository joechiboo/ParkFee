// 社區幫匯入檔產製的規則測試。
// 重點在三個會出錯就收錯錢的地方：門牌↔戶號對照、未中不出帳、多列戶只填主帳列。
import { describe, it, expect } from 'vitest'
import {
  householdIdOf,
  feeByHousehold,
  fillMotorFee,
  addressIndex,
  buildStandaloneRows,
  addDays,
  todayStr,
} from './build-shequbang-import.mjs'
import { encodeBig5, decodeBig5 } from './lib/big5.mjs'

describe('householdIdOf — 門牌＋樓層 → 戶號', () => {
  it('社區幫的中間數字是「單元」，戶號的是「樓層」，兩者對調', () => {
    // #A1-375 = A 棟第 1 單元；樓層欄 2 → 戶號 A2-1（A 棟 2 樓 1 戶）
    expect(householdIdOf('#A1-375', '2')).toBe('A2-1')
    expect(householdIdOf('#H6-293', '3')).toBe('H3-6')
    expect(householdIdOf('#E8-335', '15')).toBe('E15-8')
  })

  it('店面走同一條規則（S 棟恆在 1 樓）', () => {
    expect(householdIdOf('#S6-40', '1')).toBe('S1-6')
    expect(householdIdOf('#S15-303', '1')).toBe('S1-15')
  })

  it('同一單元不同樓層可能掛不同街號 — 街號不參與對照', () => {
    // A5 單元大多數樓層是 #A5-367，唯獨 3 樓是 #A5-369，但都屬 A 棟第 5 單元。
    expect(householdIdOf('#A5-367', '4')).toBe('A4-5')
    expect(householdIdOf('#A5-369', '3')).toBe('A3-5')
  })

  it('# 前綴可有可無；格式不符或樓層非數字回 null', () => {
    expect(householdIdOf('A1-375', '2')).toBe('A2-1')
    expect(householdIdOf('', '2')).toBe(null)
    expect(householdIdOf('#A1-375', '')).toBe(null)
    expect(householdIdOf('亂碼', '2')).toBe(null)
  })
})

describe('feeByHousehold — 配位結果 → 每戶應繳', () => {
  it('一戶多台逐台加總', () => {
    const acc = feeByHousehold([
      { 戶號: 'A2-1', 應繳金額: '1200', 狀態: '分配' },
      { 戶號: 'A2-1', 應繳金額: '3600', 狀態: '分配' },
    ])
    expect(acc.get('A2-1')).toEqual({ 金額: 4800, 台數: 2 })
  })

  it('未中不出帳', () => {
    const acc = feeByHousehold([
      { 戶號: 'B3-2', 應繳金額: '1200', 狀態: '分配' },
      { 戶號: 'B3-2', 應繳金額: '', 狀態: '未中' },
    ])
    expect(acc.get('B3-2').金額).toBe(1200)
    expect(acc.get('B3-2').台數).toBe(1)
  })

  it('已繳（物業抽籤前已指派）同樣計入 — 出帳表要完整反映應收', () => {
    const acc = feeByHousehold([{ 戶號: 'C2-3', 應繳金額: '1200', 狀態: '已繳' }])
    expect(acc.get('C2-3').金額).toBe(1200)
  })

  it('純自行車戶金額 0 但仍入列 — 對帳表要看得到它顯示 0，而非當成沒登記', () => {
    const acc = feeByHousehold([{ 戶號: 'D4-5', 應繳金額: '0', 狀態: '分配' }])
    expect(acc.get('D4-5')).toEqual({ 金額: 0, 台數: 1 })
  })
})

describe('fillMotorFee — 填回物業月結檔', () => {
  const row = (門牌, 樓, 管理費, 汽車 = '0') => ({
    '住戶住址(門牌號)': 門牌,
    '住戶住址(樓層)': String(樓),
    '住戶住址(之)': '0',
    收費類別: '2026年12月管理費',
    備註: '',
    '細項(列舉參考欄位)': '#管理費#汽車清潔費#機車清潔費#附加費用',
    '立帳通知日期(YYYY/MM/DD)': '2026/11/25',
    '繳費期限(YYYY/MM/DD)': '2026/12/25',
    管理費: String(管理費),
    汽車清潔費: 汽車,
    機車清潔費: '0',
    附加費用: '0',
  })

  it('未配位戶一律輸出 0，列數不變', () => {
    const { rows, report } = fillMotorFee([row('#A1-375', 2, 1739)], new Map())
    expect(rows).toHaveLength(1)
    expect(rows[0].機車清潔費).toBe('0')
    expect(report.輸出總額).toBe(0)
  })

  it('配位戶填入加總金額，且不動其他欄位', () => {
    const src = row('#A1-375', 2, 1739, '500')
    const { rows } = fillMotorFee([src], new Map([['A2-1', { 金額: 4800, 台數: 2 }]]))
    expect(rows[0].機車清潔費).toBe('4800')
    expect(rows[0].管理費).toBe('1739')
    expect(rows[0].汽車清潔費).toBe('500')
    expect(src.機車清潔費).toBe('0') // 輸入未被就地改動
  })

  it('多列戶只填「管理費 > 0」的主帳列 — 兩列都填會重複收費', () => {
    // 範本檔的 #F1-321 2 樓：物業把管理費與汽車清潔費拆成兩筆立帳。
    const feeRows = [row('#F1-321', 2, 1654, '0'), row('#F1-321', 2, 0, '500')]
    const { rows, report } = fillMotorFee(feeRows, new Map([['F2-1', { 金額: 1200, 台數: 1 }]]))
    expect(rows[0].機車清潔費).toBe('1200') // 管理費 1654 的主帳列
    expect(rows[1].機車清潔費).toBe('0') // 汽車清潔費那筆不填
    expect(report.輸出總額).toBe(1200)
    expect(report.多列戶).toEqual([{ 戶號: 'F2-1', 列數: 2, 金額: 1200 }])
  })

  it('配位結果有、物業檔查無門牌 → 列入 查無門牌（例：工作人員 員工-*）', () => {
    const { report } = fillMotorFee(
      [row('#A1-375', 2, 1739)],
      new Map([['員工-01', { 金額: 1200, 台數: 1 }]])
    )
    expect(report.查無門牌).toEqual(['員工-01'])
    expect(report.輸出總額).toBe(0) // 沒對到就填不進去 → 總額對不上，CLI 會擋
  })
})

describe('獨立帳單模式', () => {
  const row = (門牌, 樓, 管理費) => ({
    '住戶住址(門牌號)': 門牌,
    '住戶住址(樓層)': String(樓),
    '住戶住址(之)': '0',
    收費類別: '2026年05月管理費',
    備註: '',
    '細項(列舉參考欄位)': '#管理費#汽車清潔費#機車清潔費#附加費用',
    '立帳通知日期(YYYY/MM/DD)': '2026/4/25',
    '繳費期限(YYYY/MM/DD)': '2026/5/25',
    管理費: String(管理費),
    汽車清潔費: '0',
    機車清潔費: '0',
    附加費用: '0',
  })
  const feeRows = [row('#A1-375', 2, 1739), row('#A1-375', 3, 1739), row('#H6-293', 5, 1891)]
  const opts = {
    收費類別: '2027年度機車位清潔費',
    立帳通知日期: '2026/12/1',
    繳費期限: '2026/12/11',
  }

  it('addressIndex 由物業檔建戶號→門牌索引（街號推不出來，只能查）', () => {
    const idx = addressIndex(feeRows)
    expect(idx.get('A2-1')['住戶住址(門牌號)']).toBe('#A1-375')
    expect(idx.get('A3-1')['住戶住址(門牌號)']).toBe('#A1-375')
    expect(idx.get('H5-6')['住戶住址(門牌號)']).toBe('#H6-293')
  })

  it('只出「機車清潔費」，其餘費用欄一律 0', () => {
    const { rows } = buildStandaloneRows(
      new Map([['A2-1', { 金額: 4800, 台數: 2 }]]),
      addressIndex(feeRows),
      opts
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].機車清潔費).toBe('4800')
    expect(rows[0].管理費).toBe('0')
    expect(rows[0].汽車清潔費).toBe('0')
    expect(rows[0].附加費用).toBe('0')
    expect(rows[0].收費類別).toBe('2027年度機車位清潔費')
    expect(rows[0]['繳費期限(YYYY/MM/DD)']).toBe('2026/12/11')
  })

  it('只列有金額的戶 — 0 元不出帳，否則會產生一堆 0 元帳單', () => {
    const { rows, report } = buildStandaloneRows(
      new Map([
        ['A2-1', { 金額: 1200, 台數: 1 }],
        ['A3-1', { 金額: 0, 台數: 1 }], // 純自行車戶
      ]),
      addressIndex(feeRows),
      opts
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]['住戶住址(樓層)']).toBe('2')
    expect(report.出帳戶數).toBe(1)
  })

  it('查無門牌者不出帳並列入報告（例：工作人員 員工-*）', () => {
    const { rows, report } = buildStandaloneRows(
      new Map([['員工-01', { 金額: 1200, 台數: 1 }]]),
      addressIndex(feeRows),
      opts
    )
    expect(rows).toHaveLength(0)
    expect(report.查無門牌).toEqual(['員工-01'])
    expect(report.輸出總額).not.toBe(report.應收總額) // → CLI 判定未通過
  })

  it('依門牌、樓層排序，方便物業核對', () => {
    const { rows } = buildStandaloneRows(
      new Map([
        ['H5-6', { 金額: 1200, 台數: 1 }],
        ['A3-1', { 金額: 1200, 台數: 1 }],
        ['A2-1', { 金額: 1200, 台數: 1 }],
      ]),
      addressIndex(feeRows),
      opts
    )
    expect(rows.map((r) => `${r['住戶住址(門牌號)']}-${r['住戶住址(樓層)']}`)).toEqual([
      '#A1-375-2',
      '#A1-375-3',
      '#H6-293-5',
    ])
  })

  it('todayStr 產生社區幫日期格式（不補零）', () => {
    // 立帳通知日期＝匯出當日（2026-09-17 實測修正）：社區幫的「立帳」是帳單建立那天，
    // 與抽籤公告日無關 —— 公告後可能隔幾天才產檔上傳。
    expect(todayStr(new Date('2026-09-17T10:30:00'))).toBe('2026/9/17')
    expect(todayStr(new Date('2026-12-05T00:00:00'))).toBe('2026/12/5')
  })

  it('addDays 產生社區幫日期格式（不補零）', () => {
    // 辦法伍二（六）：逾公告後 10 日未辦妥視同放棄 → 繳費期限對齊該日
    expect(addDays('2026-12-01', 10)).toBe('2026/12/11')
    expect(addDays('2026-12-01', 0)).toBe('2026/12/1')
    expect(addDays('2026-12-25', 10)).toBe('2027/1/4') // 跨年
    expect(addDays('', 10)).toBe('')
  })
})

describe('Big5 編碼', () => {
  it('中文欄位往返一致', () => {
    const s = '#管理費#汽車清潔費#機車清潔費#附加費用,2026年12月管理費'
    expect(decodeBig5(encodeBig5(s))).toBe(s)
  })

  it('不寫 BOM，ASCII 原樣輸出', () => {
    const buf = encodeBig5('A1-375,2,0')
    expect(buf.slice(0, 3).toString('hex')).not.toBe('efbbbf')
    expect(buf.toString('ascii')).toBe('A1-375,2,0')
  })

  it('無法編碼的字元回報而非默默吞掉 — 帳務檔不容許靜默失真', () => {
    const bad = []
    const out = encodeBig5('金額😀', { onUnmappable: (c) => bad.push(c) })
    expect(bad).toEqual(['😀'])
    expect(decodeBig5(out)).toBe('金額?')
  })
})
