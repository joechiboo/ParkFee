import { describe, it, expect } from 'vitest'
import { heavyPartners } from './heavy-pair.js'

const SEATS = [
  { id: '1', type: '大' },
  { id: '2', type: '大' },
  { id: '3', type: '小' },
  { id: '4', type: '大', public: true },
  { id: '5', type: '無障礙' },
  { id: '6', type: '大' },
]
const ADJ = { 1: ['2', '6'], 2: ['1', '3', '4', '5'], 3: ['2'], 6: ['1'] }
const free = () => true
const seat = (id) => SEATS.find((s) => s.id === id)

describe('heavyPartners', () => {
  it('列出實體相鄰的大位，依編號排序', () => {
    expect(heavyPartners(seat('1'), SEATS, free, ADJ)).toEqual(['2', '6'])
  })
  it('排除相鄰的小位、公益位、無障礙位', () => {
    expect(heavyPartners(seat('2'), SEATS, free, ADJ)).toEqual(['1'])
  })
  it('排除不可用的格', () => {
    expect(heavyPartners(seat('1'), SEATS, (id) => id !== '2', ADJ)).toEqual(['6'])
  })
  it('主格不是一般大位 → 沒有候選', () => {
    expect(heavyPartners(seat('3'), SEATS, free, ADJ)).toEqual([])
    expect(heavyPartners(seat('4'), SEATS, free, ADJ)).toEqual([])
  })
  it('真實相鄰表：回傳的都是字串編號', () => {
    const real = heavyPartners({ id: '2', type: '大' }, [{ id: '2', type: '大' }, { id: '3', type: '大' }], free)
    expect(real.every((id) => typeof id === 'string')).toBe(true)
  })
})
