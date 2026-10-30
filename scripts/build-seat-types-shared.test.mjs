// 守門：Edge Function 端的「一般小位」清單必須與前端 b1-classification 一致，
// 否則住戶在地圖上點得到、後端卻說「不是小位」（或反過來放行公益位）。
// 改了分類忘了跑 node scripts/build-seat-types-shared.mjs → 這裡紅。
import { describe, it, expect } from 'vitest'
import { smallGeneralSeatIds } from './build-seat-types-shared.mjs'
import { SMALL_GENERAL_SEAT_IDS, isSmallGeneralSeat } from '../supabase/functions/_shared/seat-types.ts'
import { motorSeats } from '../src/map/seats.js'

describe('supabase/_shared/seat-types.ts 與 b1-classification 同步', () => {
  it('清單完全一致（漏跑產生腳本會紅）', () => {
    expect([...SMALL_GENERAL_SEAT_IDS].sort((a, b) => +a - +b)).toEqual(smallGeneralSeatIds())
  })
  it('與 motorSeats() 的 type=小 且非公益 一致', () => {
    const fromSeats = motorSeats().filter((s) => s.type === '小' && !s.public).map((s) => String(s.id))
    expect([...SMALL_GENERAL_SEAT_IDS].sort((a, b) => +a - +b)).toEqual(fromSeats)
  })
  it('公益小位（社宅專用，如 1、4、5）與大位不在清單', () => {
    expect(isSmallGeneralSeat('1')).toBe(false)
    expect(isSmallGeneralSeat('4')).toBe(false)
    const big = motorSeats().find((s) => s.type === '大')
    expect(isSmallGeneralSeat(big.id)).toBe(false)
    expect(isSmallGeneralSeat(' 8 ')).toBe(true)
  })
})
