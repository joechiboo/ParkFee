// 送出的車輛清單 → DB 列。register 與 update-household 共用，避免兩邊規則漂移。
//
// 第幾輛：機車類（一般/重機）與自行車**各自從 1 起算**——辦法伍三(四) 的「第一輛/第二輛自行車」
//   是獨立於機車的序列。對應 0009 的唯一索引 (戶號, (車種='自行車'), 第幾輛)。
// 自行車：無車牌 → 車號用綁戶號的合成鍵；身障/志願小位 對自行車無意義，一律 false。
import { BIKE, bikeVehicleKey, normalizeTWPlate, plateKey, plateProblem } from './normalize.ts'
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export type VehicleRow = Record<string, unknown>

export function buildVehicleRows(
  hid: string,
  vehicles: Array<Record<string, unknown>>,
): { rows: VehicleRow[]; error?: string } {
  const rows: VehicleRow[] = []
  const seenPlate = new Set<string>()
  let motorSeq = 0
  let bikeSeq = 0

  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i] ?? {}

    if (v.車種 === BIKE) {
      bikeSeq++
      rows.push({
        車號: bikeVehicleKey(hid, bikeSeq),
        戶號: hid,
        車種: BIKE,
        第幾輛: bikeSeq,
        身障: false,
        志願小位: false,
        特徵: String(v.特徵 ?? '').trim().slice(0, 50),
      })
      continue
    }

    const plate = normalizeTWPlate(v.車號)
    if (!plate) return { rows: [], error: `第 ${i + 1} 台未填車號` }
    const problem = plateProblem(plate)
    if (problem) return { rows: [], error: `第 ${i + 1} 台車號「${plate}」：${problem}` }
    if (seenPlate.has(plate)) return { rows: [], error: `車號 ${plate} 重複填寫` }
    seenPlate.add(plate)
    motorSeq++
    rows.push({
      車號: plate,
      戶號: hid,
      車種: v.車種 === '重機' ? '重機' : '一般',
      第幾輛: motorSeq,
      身障: !!v.身障,
      志願小位: !!v.志願小位,
      特徵: '',
    })
  }

  return { rows }
}

// 同一台車不能登記在兩戶。車號是主鍵，但「X1Y-234」與「X1Y234」字面不同、主鍵擋不住 →
// 用去掉符號的鍵比對其他戶已登記的機車（2026-11-16：實際發生一台車掛在兩戶、各佔一格小位）。
// 回 null＝沒有衝突；否則回錯誤訊息。
export async function plateTakenElsewhere(db: SupabaseClient, hid: string, rows: VehicleRow[]): Promise<string | null> {
  const mine = rows.filter((r) => r.車種 !== BIKE).map((r) => ({ plate: String(r.車號), key: plateKey(r.車號) }))
  if (!mine.length) return null
  const { data } = await db.from('vehicle').select('車號, 戶號').neq('戶號', hid).neq('車種', BIKE)
  for (const o of data ?? []) {
    const hit = mine.find((m) => m.key === plateKey(o.車號))
    if (hit) return `車號 ${hit.plate} 已經登記在其他戶（${o.戶號}）。同一台車只能登記在一戶，如有疑問請洽管理中心`
  }
  return null
}

// 該批是否「只有自行車」。純自行車戶沒有車牌可當登入/編輯憑證 → 電話改為必填（見 login）。
export function isBikeOnly(rows: VehicleRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.車種 === BIKE)
}
