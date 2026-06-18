// 已被選定/已繳費的車位（選位頁標記為不可選）。
// 來源情境：志願小位免抽、可提前臨櫃繳費選位 → 這些位子在抽籤/志願分發前就已被佔走；
//          以及前一輪已配位確定者。
//
// 原型：localStorage 覆寫（key parkfee:occupied，JSON 字串陣列），預設給少量小位樣本以展示狀態。
// 正式版：由後端提供（已繳費 household/vehicle → 車位編號）。

const KEY = 'parkfee:occupied'
const SAMPLE = ['8', '9', '10', '11'] // demo：幾個已被志願小位選走的小位（非公益）

export function loadOccupied() {
  try {
    const v = localStorage.getItem(KEY)
    if (v) {
      const arr = JSON.parse(v)
      if (Array.isArray(arr)) return arr.map(String)
    }
  } catch {
    /* ignore */
  }
  return SAMPLE
}
