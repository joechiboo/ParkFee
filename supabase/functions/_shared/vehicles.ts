// 送出的車輛清單 → DB 列。register 與 update-household 共用，避免兩邊規則漂移。
//
// 第幾輛：機車類（一般/重機）與自行車**各自從 1 起算**——辦法伍三(四) 的「第一輛/第二輛自行車」
//   是獨立於機車的序列。對應 0009 的唯一索引 (戶號, (車種='自行車'), 第幾輛)。
// 自行車：無車牌 → 車號用綁戶號的合成鍵；身障/志願小位 對自行車無意義，一律 false。
import { BIKE, bikeVehicleKey, normalizeTWPlate } from './normalize.ts'

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

// 該批是否「只有自行車」。純自行車戶沒有車牌可當登入/編輯憑證 → 電話改為必填（見 login）。
export function isBikeOnly(rows: VehicleRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.車種 === BIKE)
}
