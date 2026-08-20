// B1 車位空間資料 — ground-truth 來源：public/demo/seat-select-demo.html（現場盤點）。
//   流程：在 demo 上盤點/分類/校正號碼 → `node scripts/build-classification-from-demo.mjs`
//          → 重生 b1-classification.json（本檔讀取）。
//   座標系：b1.png 顯示空間（dispW×dispH，左上原點，y 向下）。
//
// 機車位實體分類：大(motor) / 小(small) / 無障礙(access)；另有 car / bike / noise(雜訊) / excl(排除，盤點工具保留；目前 0 筆)。
// 號碼為單一序列 1..655，實體 655 格全在（無缺號）。498（漏水）已恢復為大位，改用 locked_seat「維修」鎖定排除
//   （與保留/動線位同一機制，物業維護頁可解鎖）。大/小/無障礙分佈仍在盤點中。

import classification from './b1-classification.json'
import { toBikeId, compareSeatId, KIND, PUBLIC_BIKE_IDS } from './seat-id.js'

export const FLOOR = 'B1'
export const DISP_W = classification.meta.dispW // 2384
export const DISP_H = classification.meta.dispH // 1684

// 機車位實體分類 cat → 辦法型別
// 重機（2026-08-16 小組決議，docs/17）：不設專區、穿插一般車位取「相鄰兩格」（不限大小、可含無障礙），
// 由配位引擎/選位頁處理，主檔不再有「重機區」型別。
const MOTOR_CATS = { motor: '大', small: '小', access: '無障礙' }

function seatsOfCat(cat) {
  return classification.seats
    .filter((s) => s.cat === cat)
    .map((s) => ({ id: s.id, x: s.x, y: s.y, floor: FLOOR }))
    .sort((a, b) => +a.id - +b.id)
}

// 所有機車位（大+小+無障礙），含 type 與 public（公益位＝社會住宅住戶專用，2026-08-16 決議）；
// 號碼 1..655 全在（498 漏水改 locked_seat 鎖定，不再缺號）。
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

// 公益自行車位清單定義於 seat-id.js（無相依，scripts/ 也要用）；此處轉出供既有匯入點沿用。
export { PUBLIC_BIKE_IDS } from './seat-id.js'

// 自行車位 164 格。**id 在此處套上前綴正規化**（B001–B164）——盤點檔存的是地面漆的號碼
// （1–164，與機車 1–655 有 155 個字面重複），前綴是應用層的鍵，見 seat-id.js。
// 顯示給住戶時用 displaySeatId() 剝回地面數字。
export function bikeSeats() {
  const pub = new Set(PUBLIC_BIKE_IDS)
  return classification.seats
    .filter((s) => s.cat === 'bike')
    .map((s) => {
      const id = toBikeId(s.id)
      return {
        id,
        x: s.x,
        y: s.y,
        floor: FLOOR,
        type: KIND.BIKE,
        // 依辦法清單標記（非依盤點檔的 s.public，自行車那欄全空）→ 地圖/列印圖才畫得出公益標示。
        ...(pub.has(id) ? { public: true } : {}),
      }
    })
    .sort((a, b) => compareSeatId(a.id, b.id))
}

// 可承租自行車位（排除公益位）。
export function rentableBikeSeats() {
  const pub = new Set(PUBLIC_BIKE_IDS)
  return bikeSeats().filter((s) => !pub.has(s.id))
}

// 統計摘要（依實體分類），供畫面/驗證使用。
export function seatSummary() {
  const c = {}
  for (const s of classification.seats) c[s.cat] = (c[s.cat] || 0) + 1
  return { ...c, total: classification.seats.length }
}
