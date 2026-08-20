// 車輛的顯示層輔助。
//
// 自行車無車牌，車號存的是綁戶號的合成鍵（自行車-<戶號>-<序>，見 supabase/functions/_shared/vehicles.ts）。
// 那是系統內部鍵，直接印給住戶看只會困惑（而且公開版還會連戶號一起洩出去）。
// 顯示改用「自行車 第N台 · 特徵」，與登記表單收的欄位一致。
import { KIND } from '../map/seat-id.js'

export function isBikeVehicle(v) {
  return v?.車種 === KIND.BIKE
}

// 車輛在畫面上的識別字串。機車＝車牌；自行車＝第幾台＋特徵。
export function displayVehicleLabel(v) {
  if (!v) return ''
  if (!isBikeVehicle(v)) return String(v.車號 ?? '')
  const nth = Number(v.第幾輛) || 1
  const 特徵 = String(v.特徵 ?? '').trim()
  return 特徵 ? `自行車 第${nth}台 · ${特徵}` : `自行車 第${nth}台`
}
