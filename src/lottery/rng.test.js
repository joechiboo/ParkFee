import { describe, it, expect } from 'vitest'
import { mulberry32, hashSeed, seededShuffle } from './rng.js'

describe('可重現亂數', () => {
  it('同 seed → 同序列', () => {
    const a = mulberry32(12345)
    const b = mulberry32(12345)
    const seqA = Array.from({ length: 5 }, () => a())
    const seqB = Array.from({ length: 5 }, () => b())
    expect(seqA).toEqual(seqB)
  })

  it('不同 seed → 不同序列', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    expect(a()).not.toBe(b())
  })

  it('輸出落在 [0, 1)', () => {
    const r = mulberry32(99)
    for (let i = 0; i < 1000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('hashSeed：字串穩定、數字直通', () => {
    expect(hashSeed('樂菲莊園')).toBe(hashSeed('樂菲莊園'))
    expect(hashSeed('a')).not.toBe(hashSeed('b'))
    expect(hashSeed(42)).toBe(42)
  })

  it('seededShuffle：同 seed 同結果、不改原陣列、為一個排列', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8]
    const s1 = seededShuffle(arr, mulberry32(7))
    const s2 = seededShuffle(arr, mulberry32(7))
    expect(s1).toEqual(s2)
    expect(arr).toEqual([1, 2, 3, 4, 5, 6, 7, 8]) // 原陣列不變
    expect([...s1].sort((a, b) => a - b)).toEqual(arr) // 仍是同一組元素
  })
})
