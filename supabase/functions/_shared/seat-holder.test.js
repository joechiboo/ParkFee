import { describe, it, expect } from 'vitest'
import { holderOf } from './seat-holder.ts'

const rows = [
  { 車號: 'A', 戶號: 'A1-1', 車位編號: '150、151' },
  { 車號: 'B', 戶號: 'B1-1', 車位編號: '9' },
  { 車號: 'C', 戶號: 'C1-1', 車位編號: null },
]

describe('holderOf', () => {
  it('單格精確比對', () => expect(holderOf(rows, '9')?.車號).toBe('B'))
  it('重機雙位任一格都算', () => expect(holderOf(rows, '151')?.車號).toBe('A'))
  it('編號前綴不算（15 不是 150）', () => expect(holderOf(rows, '15')).toBeNull())
  it('沒有人持有回 null', () => expect(holderOf(rows, '8')).toBeNull())
  it('空清單回 null', () => expect(holderOf(null, '8')).toBeNull())
})
