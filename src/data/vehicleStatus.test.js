import { describe, it, expect } from 'vitest'
import { vehicleResultStatus } from './vehicleStatus.js'

describe('vehicleResultStatus（結果頁每台車狀態）', () => {
  it('已繳費 + 有車位 → paid', () => {
    expect(vehicleResultStatus({ 已繳費: true, 車位編號: '523', 配位狀態: '分配' })).toBe('paid')
  })

  it('有車位、未繳費 → pending（中籤/指派待繳）', () => {
    expect(vehicleResultStatus({ 已繳費: false, 車位編號: '523', 配位狀態: '分配' })).toBe('pending')
  })

  it('有配位狀態、無車位 → waitlist（落選/候補）', () => {
    expect(vehicleResultStatus({ 配位狀態: '候補' })).toBe('waitlist')
    expect(vehicleResultStatus({ 配位狀態: '未中' })).toBe('waitlist')
  })

  it('已登記、無任何結果 → registered（待配位）', () => {
    expect(vehicleResultStatus({ 車號: 'ABC-123', 車種: '一般' })).toBe('registered')
  })

  it('防呆：已繳費為真但無車位編號（異常）→ 不算 paid，落 registered', () => {
    expect(vehicleResultStatus({ 已繳費: true })).toBe('registered')
  })

  it('防呆：空物件 / undefined 不丟錯 → registered', () => {
    expect(vehicleResultStatus({})).toBe('registered')
    expect(vehicleResultStatus(undefined)).toBe('registered')
  })
})
