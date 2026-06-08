// B1 車位空間資料 — ground-truth 來源：docs/A2-5 地下一層平面圖.pdf
//   流程：scripts/build-classifier.mjs 從 PDF 抽點 → 人工於分類工具標記車種 → 匯出 b1-classification.json。
//   座標系：以 b1.png 顯示空間為準（dispW×dispH，左上為原點，y 向下）。
//
// 注意：機車號碼為單一序列 1..655（無重複、無缺號），但尚未分「大/小/無障礙」型別。
//   spaces.js 是辦法的邏輯主檔（大320/小327/無障礙8）；待取得「號碼↔型別」對照後，
//   再於此處補上 type，與 spaces.js 對接。見 TODO「大/小/無障礙分型」。

import classification from './b1-classification.json'

export const FLOOR = 'B1'
export const DISP_W = classification.meta.dispW // 2384
export const DISP_H = classification.meta.dispH // 1684

// 各車種空間點：{ id(數字字串), x, y, floor, type(待補) }
function seatsOf(cat) {
  return classification.seats
    .filter((s) => s.cat === cat)
    .map((s) => ({ id: s.id, x: s.x, y: s.y, floor: FLOOR, type: null }))
    .sort((a, b) => +a.id - +b.id)
}

export function motorSeats() {
  return seatsOf('motor')
}
export function carSeats() {
  return seatsOf('car')
}
export function bikeSeats() {
  return seatsOf('bike')
}

// 統計摘要，供畫面/驗證使用。
export function seatSummary() {
  const c = { motor: 0, car: 0, bike: 0, excl: 0 }
  for (const s of classification.seats) c[s.cat] = (c[s.cat] || 0) + 1
  return { ...c, total: classification.seats.length }
}
