import { describe, it, expect } from 'vitest'
import { distribute, REASON, VIA } from './distribute.js'
import { motorSeats } from '../map/seats.js'
import { buildRoster } from '../data/registry.js'
import { sampleRoster } from '../data/sample.js'

// fixture：可承租座位（已排除公益），數字編號 + 型別。
const SEATS = [
  { id: '1', type: '小' },
  { id: '2', type: '大' },
  { id: '3', type: '大' },
  { id: '4', type: '小' },
  { id: '10', type: '無障礙' },
]

// 合成車位的相鄰表：1-2-3-4 連成一排、10（無障礙）獨立。
// 引擎預設吃 seat-adjacency.json（真實座標），與這些假 id 幾何無關 → 測試一律注入自己的。
const ADJ = { 1: ['2'], 2: ['1', '3'], 3: ['2', '4'], 4: ['3'], 9: ['12'], 12: ['9'], 90: [], 10: [], 11: ['10'] }
const run = (registrations, opts = {}) =>
  distribute({ registrations, seats: SEATS, seed: 'test', adjacency: ADJ, ...opts })

describe('distribute — 填志願 + 統一分發（第一階段）', () => {
  it('單戶取志願序中最高可得（志願 3 在 2 之前 → 給 3）', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 車位志願: ['3', '2'] }])
    expect(r.assigned).toHaveLength(1)
    expect(r.assigned[0].車位編號).toBe('3')
    expect(r.assigned[0].配位方式).toBe(VIA.WISH)
  })

  it('志願衝突：依順序號，先順位拿走、後順位志願全落空 → 落選（原因 志願全落選）', () => {
    const r = run([
      { 戶號: 'A', 車號: 'X1', 第幾輛: 1, 車位志願: ['2'] },
      { 戶號: 'B', 車號: 'X2', 第幾輛: 1, 車位志願: ['2'] },
    ])
    expect(r.assigned).toHaveLength(1)
    expect(r.assigned[0].車位編號).toBe('2')
    expect(r.落選).toHaveLength(1)
    expect(r.落選[0].原因).toBe(REASON.LOST)
  })

  it('未填志願 → 落選（原因 未填志願），不亂配', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 車位志願: [] }])
    expect(r.assigned).toHaveLength(0)
    expect(r.落選[0].原因).toBe(REASON.NO_WISH)
  })

  it('志願指到不存在/不可用的車位 → 落選（志願全落選）', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 車位志願: ['99'] }])
    expect(r.assigned).toHaveLength(0)
    expect(r.落選[0].原因).toBe(REASON.LOST)
  })

  it('同戶多車跨輪共用一份志願：第1輛取 2、第2輛取 3', () => {
    const r = run([
      { 戶號: 'A', 車號: 'X1', 第幾輛: 1, 車位志願: ['2', '3'] },
      { 戶號: 'A', 車號: 'X2', 第幾輛: 2, 車位志願: ['2', '3'] },
    ])
    const first = r.assigned.find((x) => x.第幾輛 === 1)
    const second = r.assigned.find((x) => x.第幾輛 === 2)
    expect(first.車位編號).toBe('2')
    expect(second.車位編號).toBe('3')
  })

  it('只勾志願小位旗標、未實際選定格子 → 照常進 R1 抽籤（2026-10-29：選定才算，見 preset 測試）', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 志願小位: 'Y', 車位志願: ['1'] }])
    expect(r.assigned[0].車位編號).toBe('1')
    expect(r.assigned[0].配位方式).toBe(VIA.WISH)
    expect(r.rounds.find((x) => x.round === 1).draws).toHaveLength(1)
  })

  it('一戶一位：第2輛不在 R1 取得（R1 只配第1輛）', () => {
    const r = run([
      { 戶號: 'A', 車號: 'X1', 第幾輛: 1, 車位志願: ['2'] },
      { 戶號: 'A', 車號: 'X2', 第幾輛: 2, 車位志願: ['3'] },
    ])
    const r1 = r.rounds.find((x) => x.round === 1)
    expect(r1.assignments).toHaveLength(1)
    expect(r1.assignments[0].車位編號).toBe('2')
  })

  // ── 無障礙（2026-11-02）：只由櫃台核驗後指派，引擎不自動配；身障旗標只是申請 ──
  it('無障礙：勾身障但未經櫃台指派 → 不配無障礙位，照一般抽籤依志願分發', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 身障: 'Y', 車位志願: ['2'] }])
    expect(r.assigned[0].車位編號).toBe('2')
    expect(r.assigned[0].配位方式).toBe(VIA.WISH)
    expect(r.rounds.some((x) => x.round === 0)).toBe(false)
  })

  it('無障礙：勾身障、未指派又沒填志願 → 落選 NO_WISH（不會退回無障礙位）', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 身障: 'Y', 車位志願: [] }])
    expect(r.assigned).toHaveLength(0)
    expect(r.落選[0].原因).toBe(REASON.NO_WISH)
  })

  it('無障礙：志願指名無障礙位 → 不配（即使勾了身障）', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 身障: 'Y', 車位志願: ['10'] }])
    expect(r.assigned).toHaveLength(0)
    expect(r.落選[0].原因).toBe(REASON.LOST)
  })

  // ── 重機（2026-10-29 臨時管委會）：穿插一般車位，實體相鄰的兩個**大**位；不得使用無障礙位；一般機車抽完才抽 ──
  it('重機：未填志願 → 全場最低號「兩大位」相鄰對（跳過小位）', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 車種: '重機', 車位志願: [] }])
    expect(r.assigned[0].占用位數).toBe(2)
    expect(r.assigned[0].車位編號).toBe('2、3') // SEATS：1小 2大 3大 4小 → 只有 2、3 是兩大位
    expect(r.assigned[0].車位類型).toBe('大、大')
  })

  it('重機：志願指到大位 → 配該格＋相鄰大位（鄰格是小位則不湊）', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 車種: '重機', 車位志願: ['3'] }])
    expect(r.assigned[0].車位編號).toBe('2、3') // 3 的鄰格 4 是小位 → 回頭取 2
  })

  it('重機：志願指名無障礙位 → 不配（無障礙限身障者，2026-10-29）', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 車種: '重機', 車位志願: ['10'] }], {
      seats: [{ id: '9', type: '大' }, { id: '10', type: '無障礙' }],
    })
    expect(r.assigned).toHaveLength(0)
    expect(r.落選[0].原因).toBe(REASON.HEAVY_SHORT)
  })

  it('重機：無相鄰兩大位且有無障礙位 → 仍落選 HEAVY_SHORT（不退而取無障礙單格）', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 車種: '重機', 車位志願: [] }], {
      seats: [{ id: '1', type: '大' }, { id: '3', type: '大' }, { id: '10', type: '無障礙' }],
    })
    expect(r.assigned).toHaveLength(0)
    expect(r.落選[0].原因).toBe(REASON.HEAVY_SHORT)
  })

  it('重機：勾身障的重機同樣走重機輪，配相鄰兩大位', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 車種: '重機', 身障: 'Y', 車位志願: [] }])
    expect(r.assigned[0].車位類型).toBe('大、大')
  })

  it('重機排在一般機車全部抽完之後：一般第 2 輛先於重機第 1 輛；重機輪獨立列出', () => {
    const r = run([
      { 戶號: 'H', 車號: 'HV1', 第幾輛: 1, 車種: '重機', 車位志願: ['2'] },
      { 戶號: 'A', 車號: 'A1', 第幾輛: 1, 車位志願: ['1'] },
      { 戶號: 'A', 車號: 'A2', 第幾輛: 2, 車位志願: ['2'] },
      { 戶號: 'B', 車號: 'B1', 第幾輛: 1, 車位志願: ['3'] },
    ])
    // 2、3 被一般機車 A2（第 2 輛）與 B1 拿走 → 重機湊不到兩大位
    expect(r.assigned.map((x) => x.車號).sort()).toEqual(['A1', 'A2', 'B1'])
    expect(r.落選[0]).toMatchObject({ 車號: 'HV1', 原因: REASON.HEAVY_SHORT, 輪次: '重機' })
    const heavyRound = r.rounds.find((x) => x.round === '重機')
    expect(heavyRound.draws).toHaveLength(1)
    expect(r.rounds.find((x) => x.round === 1).draws.map((d) => d.車號)).not.toContain('HV1')
    // 順序號接在一般機車之後連續
    expect(heavyRound.draws[0].順序號).toBe(4)
  })

  it('重機：編號連號但實體不相鄰 → 不配對（落選 HEAVY_SHORT）', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 車種: '重機', 車位志願: [] }], {
      seats: [{ id: '1', type: '大' }, { id: '2', type: '大' }],
      adjacency: { 1: [], 2: [] }, // 編號連號、但幾何上不相鄰
    })
    expect(r.assigned).toHaveLength(0)
    expect(r.落選[0].原因).toBe(REASON.HEAVY_SHORT)
  })

  it('重機：編號不連號但實體相鄰 → 照配（如轉角處 40 與 55 實際貼在一起）', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 車種: '重機', 車位志願: [] }], {
      seats: [{ id: '40', type: '大' }, { id: '55', type: '大' }],
      adjacency: { 40: ['55'], 55: ['40'] },
    })
    expect(r.assigned[0].車位編號).toBe('40、55')
    expect(r.assigned[0].車位類型).toBe('大、大')
  })

  it('重機：兩小位相鄰不可配（2026-10-29 限兩大位）', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 車種: '重機', 車位志願: [] }], {
      seats: [{ id: '1', type: '小' }, { id: '2', type: '小' }],
      adjacency: { 1: ['2'], 2: ['1'] },
    })
    expect(r.assigned).toHaveLength(0)
    expect(r.落選[0].原因).toBe(REASON.HEAVY_SHORT)
  })

  it('重機：有相鄰對時優先配對，不搶無障礙位', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 車種: '重機', 車位志願: [] }], {
      seats: [{ id: '1', type: '大' }, { id: '2', type: '大' }, { id: '10', type: '無障礙' }],
    })
    expect(r.assigned[0].車位編號).toBe('1、2')
    expect(r.assigned[0].占用位數).toBe(2)
  })

  // ── 工作人員（辦法伍二（十二））：一起登記選位，但配位排最後、只撿剩位 ──
  describe('工作人員', () => {
    const staffRow = (n = 1) => ({ 戶號: `員工${n}`, 車號: `S${n}`, 第幾輛: 1, 工作人員: 'Y', 車位志願: [] })

    it('住戶全配完後才配，且只撿剩餘一般位', () => {
      const r = run(
        [{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 車位志願: ['1'] }, staffRow()],
        { seats: [{ id: '1', type: '大' }, { id: '2', type: '大' }] },
      )
      const staff = r.assigned.find((a) => a.戶號 === '員工1')
      expect(staff.車位編號).toBe('2') // 住戶先拿 1
      expect(staff.配位方式).toBe(VIA.STAFF)
    })

    it('有住戶完全沒配到車位 → 工作人員全數暫緩，不先占位', () => {
      const r = run(
        [
          { 戶號: 'A', 車號: 'X1', 第幾輛: 1, 車位志願: ['1'] },
          { 戶號: 'B', 車號: 'X2', 第幾輛: 1, 車位志願: ['1'] }, // 撞號 → B 落選
          staffRow(),
        ],
        { seats: [{ id: '1', type: '大' }, { id: '2', type: '大' }] },
      )
      expect(r.assigned.some((a) => a.戶號 === '員工1')).toBe(false)
      expect(r.落選.find((l) => l.戶號 === '員工1').原因).toBe(REASON.STAFF_PENDING)
      expect(r.assigned.some((a) => a.車位編號 === '2')).toBe(false) // 剩位留著給落選住戶
    })

    it('不碰公益位與無障礙位', () => {
      const r = run([staffRow()], {
        seats: [{ id: '9', type: '大', public: true }, { id: '10', type: '無障礙' }],
      })
      expect(r.assigned).toHaveLength(0)
      expect(r.落選[0].原因).toBe(REASON.LOST)
    })

    it('不佔順序號（非住戶權利，不進抽籤）', () => {
      const r = run([staffRow()], { seats: [{ id: '1', type: '大' }] })
      expect(r.assigned[0].順序號).toBeNull()
    })
  })

  // ── 社宅（2026-08-16 Q7）：公益位＝社宅戶專用，雙向分流 ──
  const MIX = [
    { id: '1', type: '小' },
    { id: '2', type: '大' },
    { id: '9', type: '大', public: true },
    { id: '12', type: '小', public: true },
  ]

  it('社宅戶：志願指到公益位 → 配到', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 社宅: 'Y', 車位志願: ['9'] }], { seats: MIX })
    expect(r.assigned[0].車位編號).toBe('9')
  })

  it('社宅戶：志願指到一般位 → 不配（資格不符）', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 社宅: 'Y', 車位志願: ['2'] }], { seats: MIX })
    expect(r.assigned).toHaveLength(0)
    expect(r.落選[0].原因).toBe(REASON.LOST)
  })

  it('一般戶：志願指到公益位 → 不配（公益位社宅專用）', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 車位志願: ['9'] }], { seats: MIX })
    expect(r.assigned).toHaveLength(0)
    expect(r.落選[0].原因).toBe(REASON.LOST)
  })

  it('社宅身障戶：未經櫃台指派 → 不配無障礙位，走公益位分流', () => {
    const seats = [...MIX, { id: '90', type: '無障礙' }]
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 社宅: 'Y', 身障: 'Y', 車位志願: ['9'] }], { seats })
    expect(r.assigned[0].車位編號).toBe('9')
  })

  it('可重現：同 seed → 結果完全一致', () => {
    const regs = [
      { 戶號: 'A', 車號: 'X1', 第幾輛: 1, 車位志願: ['2', '3', '1'] },
      { 戶號: 'B', 車號: 'X2', 第幾輛: 1, 車位志願: ['2', '3', '1'] },
      { 戶號: 'C', 車號: 'X3', 第幾輛: 1, 車位志願: ['2', '3', '1'] },
    ]
    const a = distribute({ registrations: regs, seats: SEATS, seed: 's1' })
    const b = distribute({ registrations: regs, seats: SEATS, seed: 's1' })
    expect(a.assigned).toEqual(b.assigned)
    expect(a.落選).toEqual(b.落選)
  })
})

describe('大規模模擬（277 戶 ≈ 401 台、真實 655 座位）— 每月演練用不變量', () => {
  // 名冊自 Q18 起含自行車列；機車引擎只吃機車，自行車另走 distribute-bikes。
  const { entries: all } = buildRoster(sampleRoster(277))
  const entries = all.filter((e) => e.車種 !== '自行車')
  const seats = motorSeats()
  const publicIds = new Set(seats.filter((s) => s.public).map((s) => String(s.id)))
  const r = distribute({ registrations: entries, seats, seed: '模擬' })

  it('機車總數 ≈ 400、每台都有下落（配到或落選）', () => {
    expect(entries.length).toBeGreaterThanOrEqual(390)
    expect(entries.length).toBeLessThanOrEqual(410)
    expect(r.assigned.length + r.落選.length).toBe(entries.length)
  })

  it('名冊含自行車，且機車引擎完全不碰它們（不會配到機車位）', () => {
    expect(all.some((e) => e.車種 === '自行車')).toBe(true)
    // 直接餵混合名冊：結果應與只餵機車列完全相同
    const mixed = distribute({ registrations: all, seats, seed: '模擬' })
    expect(mixed.assigned).toEqual(r.assigned)
    expect(mixed.落選).toEqual(r.落選)
  })

  it('無重複配位：所有配出的車位 id 全域唯一', () => {
    const ids = r.assigned.flatMap((a) => a.車位編號.split('、'))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('社宅戶只落公益位、一般戶不落公益位（雙向；櫃台指派的無障礙位為明文例外）', () => {
    const socialHouses = new Set(entries.filter((e) => e.社宅 === 'Y').map((e) => e.戶號))
    for (const a of r.assigned) {
      const inPublic = a.車位編號.split('、').map((id) => publicIds.has(id))
      // 無障礙位不分社宅／一般身分（2026-08-24 決策）：公益區無無障礙格，
      // 櫃台指派給社宅身障戶的是一般無障礙位 → 不受「只落公益位」拘束。
      if (a.配位方式 === VIA.ACCESSIBLE) continue
      if (socialHouses.has(a.戶號)) expect(inPublic.every(Boolean)).toBe(true)
      else expect(inPublic.some(Boolean)).toBe(false)
    }
  })

  it('重機都占相鄰兩個大位（編號連號）；絕不配到無障礙或小位', () => {
    const heavies = r.assigned.filter((a) => a.車種 === '重機' && a.配位方式 !== VIA.PRESET)
    expect(heavies.length).toBeGreaterThan(0)
    for (const h of heavies) {
      expect(h.車位類型).toBe('大、大')
      const [x, y] = h.車位編號.split('、').map(Number)
      expect(h.占用位數).toBe(2)
      expect(y - x).toBe(1)
    }
  })

  it('同 seed 全結果可重現', () => {
    const r2 = distribute({ registrations: entries, seats, seed: '模擬' })
    expect(r2.assigned).toEqual(r.assigned)
    expect(r2.落選).toEqual(r.落選)
  })
})

describe('順序號連續 + 一人多車位', () => {
  // 5 大位、3 戶（A 有 2 台）→ 共 4 台抽籤車（皆能中）。
  const SEATS5 = [
    { id: '1', type: '大' },
    { id: '2', type: '大' },
    { id: '3', type: '大' },
    { id: '4', type: '大' },
    { id: '5', type: '大' },
  ]
  const REGS = [
    { 戶號: 'A', 車號: 'A1', 第幾輛: 1, 車位志願: ['1', '2', '3', '4', '5'] },
    { 戶號: 'A', 車號: 'A2', 第幾輛: 2, 車位志願: ['1', '2', '3', '4', '5'] },
    { 戶號: 'B', 車號: 'B1', 第幾輛: 1, 車位志願: ['1', '2', '3', '4', '5'] },
    { 戶號: 'C', 車號: 'C1', 第幾輛: 1, 車位志願: ['1', '2', '3', '4', '5'] },
  ]

  it('順序號跨輪連續 1..N、每車唯一、不重複（含落選）', () => {
    const r = distribute({ registrations: REGS, seats: SEATS5, seed: 'seq' })
    const seqs = [...r.assigned, ...r.落選].map((x) => x.順序號).filter((n) => n != null)
    expect(seqs.length).toBe(4) // 4 台抽籤車各一號
    expect(new Set(seqs).size).toBe(4) // 不重複
    expect([...seqs].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]) // 連續 1..4
  })

  it('一人多車位：同戶各車不同順序號、不同位、分屬 R1/R2', () => {
    const r = distribute({ registrations: REGS, seats: SEATS5, seed: 'seq' })
    const aCars = r.assigned.filter((x) => x.戶號 === 'A')
    expect(aCars).toHaveLength(2)
    expect(new Set(aCars.map((x) => x.順序號)).size).toBe(2) // 兩台不同順序號（不共用）
    expect(aCars[0].車位編號).not.toBe(aCars[1].車位編號) // 不同車位
    expect(aCars.map((x) => x.輪次).sort()).toEqual([1, 2]) // 第1輛 R1、第2輛 R2
  })

  it('保障每戶第1輛一位：R1 每戶最多一台、戶數=R1 配位數', () => {
    const r = distribute({ registrations: REGS, seats: SEATS5, seed: 'seq' })
    const r1 = r.assigned.filter((x) => x.輪次 === 1)
    const houses = r1.map((x) => x.戶號)
    expect(new Set(houses).size).toBe(houses.length) // R1 無同戶重複
    expect(new Set(houses)).toEqual(new Set(['A', 'B', 'C'])) // 三戶第1輛都有位
  })
})

describe('物業抽籤前指派（preset）— 跳過抽籤、直接記入結果', () => {
  it('已指派小位：記入結果(VIA.VOLUNTEER_SMALL)、不進 R1 抽籤、不落選', () => {
    const r = run([{ 戶號: 'A', 車號: 'A1', 第幾輛: 1, 車位志願: ['2'], 車位編號: '1', 已繳費: 'Y' }])
    expect(r.assigned).toHaveLength(1)
    expect(r.assigned[0].車位編號).toBe('1')
    expect(r.assigned[0].車位類型).toBe('小')
    expect(r.assigned[0].配位方式).toBe(VIA.VOLUNTEER_SMALL)
    expect(r.assigned[0].已繳費).toBe(true)
    expect(r.rounds.find((x) => x.round === 1).draws).toHaveLength(0) // 免抽
    expect(r.落選).toHaveLength(0)
  })

  it('不重複分配：已指派位從池中移除（他人志願指到該位 → 落選），該戶不再得第二位', () => {
    const r = run([
      { 戶號: 'A', 車號: 'A1', 第幾輛: 1, 車位志願: ['2'], 車位編號: '1', 已繳費: 'Y' },
      { 戶號: 'B', 車號: 'B1', 第幾輛: 1, 車位志願: ['1'] }, // 想要 1，但已被 A 指派佔走
    ])
    expect(r.assigned.filter((x) => x.戶號 === 'A')).toHaveLength(1) // A 只有一位（無重複）
    expect(r.落選.find((x) => x.戶號 === 'B').原因).toBe(REASON.LOST) // 1 被佔 → B 志願落選
  })

  it('已指派無障礙：櫃台核驗後指派 → 記為無障礙配位、不佔順序號', () => {
    const r = run([{ 戶號: 'A', 車號: 'A1', 第幾輛: 1, 身障: 'Y', 車位編號: '10', 已繳費: 'Y' }])
    expect(r.assigned).toHaveLength(1)
    expect(r.assigned[0].車位編號).toBe('10')
    expect(r.assigned[0].配位方式).toBe(VIA.ACCESSIBLE)
    expect(r.assigned[0].順序號 ?? null).toBeNull()
  })

  it('已指派重機：兩車位掛同車號 → 占用2位、VIA.PRESET、型別大、大', () => {
    const r = run([{ 戶號: 'A', 車號: 'A1', 第幾輛: 1, 車種: '重機', 車位編號: '2、3', 已繳費: 'Y' }])
    expect(r.assigned).toHaveLength(1)
    expect(r.assigned[0].車位編號).toBe('2、3')
    expect(r.assigned[0].占用位數).toBe(2)
    expect(r.assigned[0].車位類型).toBe('大、大')
    expect(r.assigned[0].配位方式).toBe(VIA.PRESET)
  })

  it('混合：已指派戶+待抽戶同跑，待抽照常抽、已指派免抽', () => {
    const r = run([
      { 戶號: 'A', 車號: 'A1', 第幾輛: 1, 車位編號: '1', 已繳費: 'Y' }, // 指派
      { 戶號: 'B', 車號: 'B1', 第幾輛: 1, 車位志願: ['2'] }, // 待抽
    ])
    const a = r.assigned.find((x) => x.戶號 === 'A')
    const b = r.assigned.find((x) => x.戶號 === 'B')
    expect(a.順序號).toBeNull() // 免抽無順序號
    expect(b.車位編號).toBe('2')
    expect(b.配位方式).toBe(VIA.WISH)
    expect(b.順序號).toBe(1) // 待抽者順序號從 1 起（preset 不佔號）
  })
})

describe('電腦選位 — 志願落空 + 勾電腦選號 → 自動配本棟靠電梯剩位', () => {
  // 注入 computerPickOrder → 與真實 tower-priority.json 解耦、可控。
  it('勾電腦選號 + 志願落空 → 配到剩位(VIA.COMPUTER)、移出落選', () => {
    const r = run([{ 戶號: 'B', 車號: 'B1', 第幾輛: 1, 車位志願: ['99'], 電腦選號: 'Y' }], {
      computerPickOrder: () => ['3'],
    })
    const c = r.assigned.find((x) => x.配位方式 === VIA.COMPUTER)
    expect(c).toBeTruthy()
    expect(c.車位編號).toBe('3')
    expect(r.落選).toHaveLength(0) // 已被電腦選位救回
  })

  it('沒勾電腦選號 → 維持落選、不自動配', () => {
    const r = run([{ 戶號: 'B', 車號: 'B1', 第幾輛: 1, 車位志願: ['99'] }], {
      computerPickOrder: () => ['3'],
    })
    expect(r.assigned).toHaveLength(0)
    expect(r.落選[0].原因).toBe(REASON.LOST)
  })

  it('相容舊欄位「志願落選保底」＝電腦選號', () => {
    const r = run([{ 戶號: 'B', 車號: 'B1', 第幾輛: 1, 車位志願: ['99'], 志願落選保底: 'Y' }], {
      computerPickOrder: () => ['3'],
    })
    expect(r.assigned.find((x) => x.配位方式 === VIA.COMPUTER).車位編號).toBe('3')
  })

  it('本棟＋鄰棟皆無剩（候選皆不可用/型別不符）→ 維持落選', () => {
    const r = run([{ 戶號: 'B', 車號: 'B1', 第幾輛: 1, 車位志願: ['99'], 電腦選號: 'Y' }], {
      computerPickOrder: () => ['99', '10'], // 99 不存在、10 為無障礙（不符一般車）
    })
    expect(r.assigned).toHaveLength(0)
    expect(r.落選).toHaveLength(1)
  })

  it('保底一位優先：唯一剩位給第1輛，第2輛仍落選', () => {
    const r = run(
      [
        { 戶號: 'A', 車號: 'A1', 第幾輛: 1, 車位志願: ['99'], 電腦選號: 'Y' },
        { 戶號: 'A', 車號: 'A2', 第幾輛: 2, 車位志願: ['99'], 電腦選號: 'Y' },
      ],
      { computerPickOrder: () => ['3'] }, // 只有 3 一格可補
    )
    const c = r.assigned.find((x) => x.配位方式 === VIA.COMPUTER)
    expect(c.第幾輛).toBe(1) // 第1輛先拿
    expect(c.車位編號).toBe('3')
    expect(r.落選.find((x) => x.第幾輛 === 2)).toBeTruthy() // 第2輛沒補到
  })

  it('凍結位不被電腦選位挑到：候選位若未在 seats 池中 → 略過', () => {
    // seats 只給 3；候選序把凍結位 2 排前面 → 2 不在池、跳過、配到 3。
    const r = distribute({
      registrations: [{ 戶號: 'B', 車號: 'B1', 第幾輛: 1, 車位志願: ['99'], 電腦選號: 'Y' }],
      seats: [{ id: '3', type: '大' }],
      seed: 'test',
      computerPickOrder: () => ['2', '3'],
    })
    expect(r.assigned.find((x) => x.配位方式 === VIA.COMPUTER).車位編號).toBe('3')
  })

  it('社宅戶：志願落空 + 勾電腦選號 → 配公益位（編號小→大），不吃一般位', () => {
    const r = distribute({
      registrations: [{ 戶號: 'A1-1', 車號: 'S1', 第幾輛: 1, 社宅: 'Y', 車位志願: ['99'], 電腦選號: 'Y' }],
      seats: [
        { id: '274', type: '大' }, // 一般位（AB 棟靠電梯首位）→ 社宅戶不得取
        { id: '12', type: '小', public: true },
        { id: '5', type: '大', public: true },
      ],
      seed: 'test',
    })
    const c = r.assigned.find((x) => x.配位方式 === VIA.COMPUTER)
    expect(c).toBeTruthy()
    expect(c.車位編號).toBe('5') // 公益位最小號
    expect(r.落選).toHaveLength(0)
  })

  it('社宅戶：公益位已滿 → 維持落選，不溢出到一般位', () => {
    const r = distribute({
      registrations: [
        { 戶號: 'A1-1', 車號: 'S1', 第幾輛: 1, 社宅: 'Y', 車位志願: ['99'], 電腦選號: 'Y' },
        { 戶號: 'B2-2', 車號: 'S2', 第幾輛: 1, 社宅: 'Y', 車位志願: ['99'], 電腦選號: 'Y' },
      ],
      seats: [{ id: '5', type: '大', public: true }, { id: '274', type: '大' }],
      seed: 'test',
    })
    expect(r.assigned.filter((x) => x.配位方式 === VIA.COMPUTER)).toHaveLength(1)
    expect(r.落選).toHaveLength(1) // 第二戶配不到、不會拿到一般位 274
  })

  it('一般戶電腦選號不會撿到公益位', () => {
    const r = distribute({
      registrations: [{ 戶號: 'A1-1', 車號: 'X1', 第幾輛: 1, 車位志願: ['99'], 電腦選號: 'Y' }],
      seats: [{ id: '5', type: '大', public: true }],
      seed: 'test',
    })
    expect(r.assigned).toHaveLength(0)
    expect(r.落選).toHaveLength(1)
  })

  it('預設本棟序（戶號首字母→棟）：A 戶落空 → 配 AB 棟靠電梯位 274', () => {
    const r = distribute({
      registrations: [{ 戶號: 'A1-1', 車號: 'A1', 第幾輛: 1, 車位志願: ['99'], 電腦選號: 'Y' }],
      seats: [{ id: '274', type: '大' }, { id: '1', type: '小' }],
      seed: 'test',
    })
    const c = r.assigned.find((x) => x.配位方式 === VIA.COMPUTER)
    expect(c).toBeTruthy()
    expect(c.車位編號).toBe('274') // AB 棟靠電梯第 1 位
  })
})
