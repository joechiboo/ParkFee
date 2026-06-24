// B1 車位空間資料 — ground-truth 來源：public/demo/seat-select-demo.html（現場盤點）。
//   流程：在 demo 上盤點/分類/校正號碼 → `node scripts/build-classification-from-demo.mjs`
//          → 重生 b1-classification.json（本檔讀取）。
//   座標系：b1.png 顯示空間（dispW×dispH，左上原點，y 向下）。
//
// 機車位實體分類：大(motor) / 小(small) / 無障礙(access)；另有 car / bike / noise(雜訊) / excl(排除，盤點工具保留；目前 0 筆)。
// 號碼為單一序列 1..655，實體 655 格全在（無缺號）。498（漏水）已恢復為大位，改用 locked_seat「維修」鎖定排除
//   （與保留/動線位同一機制，物業維護頁可解鎖）。大/小/無障礙分佈仍在盤點中。

import classification from './b1-classification.json'

export const FLOOR = 'B1'
export const DISP_W = classification.meta.dispW // 2384
export const DISP_H = classification.meta.dispH // 1684

// 機車位實體分類 cat → 辦法型別
const MOTOR_CATS = { motor: '大', small: '小', access: '無障礙' }

function seatsOfCat(cat) {
  return classification.seats
    .filter((s) => s.cat === cat)
    .map((s) => ({ id: s.id, x: s.x, y: s.y, floor: FLOOR }))
    .sort((a, b) => +a.id - +b.id)
}

// 所有機車位（大+小+無障礙），含 type 與 public（公益位）；號碼 1..655 全在（498 漏水改 locked_seat 鎖定，不再缺號）。
export function motorSeats() {
  return classification.seats
    .filter((s) => s.cat in MOTOR_CATS)
    .map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      floor: FLOOR,
      type: MOTOR_CATS[s.cat],
      ...(s.public ? { public: true } : {}),
    }))
    .sort((a, b) => +a.id - +b.id)
}

// 可承租機車位（排除公益位）— 配位/分發引擎用。
export function rentableMotorSeats() {
  return motorSeats().filter((s) => !s.public)
}

export function carSeats() {
  return seatsOfCat('car')
}
export function bikeSeats() {
  return seatsOfCat('bike')
}

// 統計摘要（依實體分類），供畫面/驗證使用。
export function seatSummary() {
  const c = {}
  for (const s of classification.seats) c[s.cat] = (c[s.cat] || 0) + 1
  return { ...c, total: classification.seats.length }
}
