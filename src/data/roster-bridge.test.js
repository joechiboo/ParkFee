import { describe, it, expect } from 'vitest'
import { parseCSVObjects } from './csv.js'
import { buildRoster } from './registry.js'
import { distribute } from '../lottery/distribute.js'

// 鎖住「匯出名冊 CSV → 匯入 → 抽籤」這條橋：
//   export-roster.mjs / 後台 SQL 產出的 CSV 欄位，必須能被 parseCSVObjects → buildRoster
//   解析、再餵進 distribute。欄名/格式一漂移，這個測試就會紅。
//
// 下面 CSV 即 export-roster.mjs 的輸出格式（含 Y/N、車位志願以「、」分隔、戶層級只填第1輛列）。
const EXPORTED_CSV = [
  '戶號,車號,車種,第幾輛,身障,志願小位,登記時間,聯絡電話,車位志願,志願落選保底,來源',
  'H3-6,ABC-123,一般,1,N,N,2026-11-15T08:00:00Z,0912-345-678,8、9、10,Y,線上',
  'H3-6,ABC-124,一般,2,N,N,2026-11-15T08:00:00Z,0912-345-678,,,線上', // 第2輛：戶層級志願留空，靠傳播
  'A1-2,XYZ-001,重機,1,N,N,2026-11-16T09:00:00Z,,,,線上',
  'B2-3,DEF-200,一般,1,Y,N,2026-11-16T09:30:00Z,,11,,線上', // 身障 → 無障礙
].join('\r\n')

// 固定座位 fixture（不依賴實際盤點資料，測試才穩）
const SEATS = [
  { id: '8', type: '大' },
  { id: '9', type: '大' },
  { id: '10', type: '小' },
  { id: '11', type: '小' },
  { id: '12', type: '無障礙' },
]

describe('名冊匯出 CSV → 抽籤 橋接', () => {
  it('匯出格式的 CSV 能解析、戶層級志願傳播到全戶', () => {
    const { entries, invalid } = buildRoster(parseCSVObjects(EXPORTED_CSV))
    expect(invalid).toHaveLength(0)
    const h36 = entries.filter((e) => e.戶號 === 'H3-6')
    expect(h36).toHaveLength(2)
    // 車位志願戶層級：第 1 輛填了「8、9、10」，第 2 輛空 → 傳播後兩列都有
    for (const e of h36) expect(e.車位志願).toEqual(['8', '9', '10'])
    expect(h36[0].志願落選保底).toBe('Y')
  })

  it('解析後直接餵 distribute 能跑出配位/落選（欄位對得上）', () => {
    const { entries } = buildRoster(parseCSVObjects(EXPORTED_CSV))
    const r = distribute({ registrations: entries, seats: SEATS, seed: '2027樂菲機車抽籤' })
    // H3-6 第1輛應拿到志願中的某格；B2-3 身障應配無障礙
    expect(r.assigned.length).toBeGreaterThan(0)
    const b23 = r.assigned.find((a) => a.戶號 === 'B2-3')
    expect(b23?.車位類型).toBe('無障礙')
    // 同 seed 可重現
    const r2 = distribute({ registrations: entries, seats: SEATS, seed: '2027樂菲機車抽籤' })
    expect(r2.assigned).toEqual(r.assigned)
  })
})
