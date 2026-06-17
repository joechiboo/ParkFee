import { describe, it, expect, beforeEach } from 'vitest'

// node 環境無 localStorage → 簡易 mock
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
}

const { register, login, getHousehold, _reset, RegistrationError } = await import('./local-backend.js')

describe('登記儲存層 localStorage 後端（登記即註冊 / 戶號+車號登入）', () => {
  beforeEach(() => _reset())

  it('登記建立整戶，第幾輛依序、車號正規化', () => {
    const h = register({ 戶號: 'A-5-3', 電話: '0912345678', vehicles: [{ 車號: 'abc123' }, { 車號: 'xyz 789', 車種: '重機' }] })
    expect(h.戶號).toBe('A-5-3')
    expect(h.vehicles).toHaveLength(2)
    expect(h.vehicles[0]).toMatchObject({ 車號: 'ABC-123', 第幾輛: 1, 車種: '一般' })
    expect(h.vehicles[1]).toMatchObject({ 車號: 'XYZ-789', 第幾輛: 2, 車種: '重機' })
  })

  it('同一戶號不可重複註冊', () => {
    register({ 戶號: 'B1', vehicles: [{ 車號: 'AA1' }] })
    expect(() => register({ 戶號: 'B1', vehicles: [{ 車號: 'BB2' }] })).toThrow(RegistrationError)
  })

  it('車號全域唯一，不可被兩戶登記', () => {
    register({ 戶號: 'C1', vehicles: [{ 車號: 'SAME1' }] })
    expect(() => register({ 戶號: 'C2', vehicles: [{ 車號: 'same-1' }] })).toThrow(/已被其他戶/)
  })

  it('至少一台、車號必填', () => {
    expect(() => register({ 戶號: 'D1', vehicles: [] })).toThrow(RegistrationError)
    expect(() => register({ 戶號: 'D1', vehicles: [{ 車號: '' }] })).toThrow(RegistrationError)
  })

  it('登入：戶號 + 任一已登記車號皆可，看到整戶', () => {
    register({ 戶號: 'E-9', 電話: '02', vehicles: [{ 車號: 'M1' }, { 車號: 'M2' }] })
    expect(login('E-9', 'M1')?.vehicles).toHaveLength(2)
    expect(login('E-9', 'm2')?.vehicles).toHaveLength(2) // 第二台也能登入、車號大小寫不拘
  })

  it('登入失敗：車號不屬該戶 / 不存在', () => {
    register({ 戶號: 'F1', vehicles: [{ 車號: 'P1' }] })
    register({ 戶號: 'F2', vehicles: [{ 車號: 'P2' }] })
    expect(login('F1', 'P2')).toBeNull() // P2 屬 F2
    expect(login('F1', 'NOPE')).toBeNull()
  })

  it('查無此戶回 null', () => {
    expect(getHousehold('GHOST')).toBeNull()
  })
})
