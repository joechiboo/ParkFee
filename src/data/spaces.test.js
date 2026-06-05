import { describe, it, expect } from 'vitest'
import {
  buildSpaces,
  rentableSpaces,
  SPACE_TYPE,
  GENERAL_LARGE_TOTAL,
  GENERAL_SMALL_TOTAL,
  ACCESSIBLE_TOTAL,
  TOTAL,
} from './spaces.js'

describe('車位主檔（辦法 §肆）', () => {
  const spaces = buildSpaces()

  it('車位總數 655（647 一般 + 8 無障礙）', () => {
    expect(spaces.length).toBe(655)
    expect(TOTAL).toBe(655)
  })

  it('各類型數量正確：大 320 / 小 327 / 無障礙 8', () => {
    const count = (t) => spaces.filter((s) => s.type === t).length
    expect(count(SPACE_TYPE.LARGE)).toBe(GENERAL_LARGE_TOTAL)
    expect(count(SPACE_TYPE.SMALL)).toBe(GENERAL_SMALL_TOTAL)
    expect(count(SPACE_TYPE.ACCESSIBLE)).toBe(ACCESSIBLE_TOTAL)
  })

  it('公益車位數量：大 8 / 小 12，無障礙 0', () => {
    const publicCount = (t) => spaces.filter((s) => s.type === t && s.public).length
    expect(publicCount(SPACE_TYPE.LARGE)).toBe(8)
    expect(publicCount(SPACE_TYPE.SMALL)).toBe(12)
    expect(publicCount(SPACE_TYPE.ACCESSIBLE)).toBe(0)
  })

  it('公益編號正確對應到指定的座號', () => {
    const isPublic = (id) => spaces.find((s) => s.id === id)?.public
    expect(isPublic('大2')).toBe(true)
    expect(isPublic('大104')).toBe(true)
    expect(isPublic('大1')).toBe(false)
    expect(isPublic('小1')).toBe(true)
    expect(isPublic('小102')).toBe(true)
    expect(isPublic('小2')).toBe(false)
  })

  it('id 唯一', () => {
    const ids = new Set(spaces.map((s) => s.id))
    expect(ids.size).toBe(spaces.length)
  })

  it('可承租車位 = 655 - 20 公益 = 635', () => {
    expect(rentableSpaces(spaces).length).toBe(655 - 20)
  })
})
