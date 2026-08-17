import { describe, it, expect } from 'vitest'
import { distribute, REASON, VIA } from './distribute.js'

// fixture：可承租座位（已排除公益），數字編號 + 型別。
const SEATS = [
  { id: '1', type: '小' },
  { id: '2', type: '大' },
  { id: '3', type: '大' },
  { id: '4', type: '小' },
  { id: '10', type: '無障礙' },
]

const run = (registrations, opts = {}) =>
  distribute({ registrations, seats: SEATS, seed: 'test', ...opts })

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

  it('志願小位免抽、依登記序選小位（即使沒填志願）', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 志願小位: 'Y', 車位志願: [] }])
    expect(r.assigned[0].車位類型).toBe('小')
    expect(r.assigned[0].配位方式).toBe(VIA.VOLUNTEER_SMALL)
    // 免抽 → R1 draws 不含此人
    expect(r.rounds.find((x) => x.round === 1).draws).toHaveLength(0)
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

  it('無障礙：身障第1輛優先配無障礙位', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 身障: 'Y', 車位志願: [] }])
    expect(r.assigned[0].車位類型).toBe('無障礙')
    expect(r.assigned[0].配位方式).toBe(VIA.ACCESSIBLE)
  })

  // ── 重機（2026-08-16 決議）：穿插一般車位，相鄰兩格（編號連號），不限大小、可含無障礙 ──
  it('重機：未填志願 → 全場最低號相鄰對（大小混搭可）', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 車種: '重機', 車位志願: [] }])
    expect(r.assigned[0].占用位數).toBe(2)
    expect(r.assigned[0].車位編號).toBe('1、2') // SEATS：1小 2大 → 混搭相鄰對
    expect(r.assigned[0].車位類型).toBe('小、大')
  })

  it('重機：志願優先 — 志願指到格則配該格＋鄰格', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 車種: '重機', 車位志願: ['3'] }])
    expect(r.assigned[0].車位編號).toBe('3、4')
  })

  it('重機：可含無障礙位（無障礙與大位連號成對）', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 車種: '重機', 車位志願: [] }], {
      seats: [{ id: '9', type: '大' }, { id: '10', type: '無障礙' }],
    })
    expect(r.assigned[0].車位編號).toBe('9、10')
    expect(r.assigned[0].車位類型).toBe('大、無障礙')
  })

  it('重機：全場無相鄰對 → 落選 HEAVY_SHORT，不配單格', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 車種: '重機', 車位志願: [] }], {
      seats: [{ id: '1', type: '大' }, { id: '3', type: '大' }, { id: '10', type: '無障礙' }],
    })
    expect(r.assigned).toHaveLength(0)
    expect(r.落選[0].原因).toBe(REASON.HEAVY_SHORT)
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

  it('社宅戶志願小位：takeLowest 只撿公益小位（不吃一般小位）', () => {
    const r = run([{ 戶號: 'A', 車號: 'X1', 第幾輛: 1, 社宅: 'Y', 志願小位: 'Y', 車位志願: [] }], {
      seats: MIX,
    })
    expect(r.assigned[0].車位編號).toBe('12')
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

  it('已指派無障礙：身障第1輛不在 R0 重配', () => {
    const r = run([{ 戶號: 'A', 車號: 'A1', 第幾輛: 1, 身障: 'Y', 車位編號: '10', 已繳費: 'Y' }])
    expect(r.assigned).toHaveLength(1)
    expect(r.assigned[0].車位編號).toBe('10')
    expect(r.assigned[0].配位方式).toBe(VIA.ACCESSIBLE)
    expect(r.rounds.find((x) => x.round === 0).assignments).toHaveLength(0) // R0 不重配
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
