// 查某格目前掛在哪台車。車位編號可能是重機雙位「150、151」，要逐位精確比對（15 不算 150）。
export type SeatRow = { 車號: string; 戶號: string; 車位編號: string | null }

export function holderOf(rows: SeatRow[] | null | undefined, seat: string): SeatRow | null {
  const id = String(seat).trim()
  for (const v of rows || []) {
    const ids = String(v.車位編號 ?? '').split('、').map((s) => s.trim())
    if (ids.includes(id)) return v
  }
  return null
}

export function seatIdsOf(value: string | null | undefined): string[] {
  return String(value ?? '').split('、').map((s) => s.trim()).filter(Boolean)
}

type PlanVehicle = { 車種?: string | null; 車位編號?: string | null } | null | undefined

// 這次指派後該車要佔哪些格。重機固定兩格：要帶相鄰格，或是只改狀態、繳費時沿用原本兩格。
// 兩格是否相鄰、是否大位由維護頁把關；事後再由 check-roster 第 3.7 項補驗。
export function planAssign(seat: string, pair: string, vehicle: PlanVehicle): { ids: string[] } | { error: string } {
  if (pair) {
    if (pair === seat) return { error: '相鄰車位不能和主車位相同' }
    if (vehicle?.車種 !== '重機') return { error: '只有重機可以指派兩個車位' }
    return { ids: [seat, pair].sort((a, b) => +a - +b) }
  }
  if (vehicle?.車種 === '重機') {
    const current = seatIdsOf(vehicle.車位編號)
    if (current.length === 2 && current.includes(seat)) return { ids: current }
    return { error: '重機須指派相鄰兩個大位，請選擇相鄰車位' }
  }
  return { ids: [seat] }
}
