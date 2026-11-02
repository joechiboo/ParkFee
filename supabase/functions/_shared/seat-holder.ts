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
