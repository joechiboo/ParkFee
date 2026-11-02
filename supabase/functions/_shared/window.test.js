import { describe, it, expect } from 'vitest'
import { closedMessage, DEFAULT_WINDOW } from './window.ts'

// 台北時間 → epoch ms
const at = (s) => Date.parse(`${s}+08:00`)
const check = (s) => closedMessage(DEFAULT_WINDOW, at(s), '登記')

describe('登記時窗（台北時間，含兩端）', () => {
  it('11/14 23:59 尚未開放', () => expect(check('2026-11-14T23:59:59')).toMatch(/尚未開放.*2026\/11\/15/))
  it('11/15 00:00 開放', () => expect(check('2026-11-15T00:00:00')).toBeNull())
  it('11/30 23:59 仍開放', () => expect(check('2026-11-30T23:59:59')).toBeNull())
  it('12/1 00:00 已截止', () => expect(check('2026-12-01T00:00:00')).toMatch(/已於 2026\/11\/30 截止/))
  it('覆蓋時窗生效', () => {
    expect(closedMessage('2026-10-01..2026-12-31', at('2026-11-02T12:00:00'), '登記')).toBeNull()
  })
})
