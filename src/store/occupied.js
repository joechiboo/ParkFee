// 已承租車位（選位頁標記為不可選）。**住戶端唯讀**：住戶不能自己標，只能「讀」。
//
// 標註職責：由**物業後台在確認繳費後**寫入（繳費 → 該車位轉「已承租」）。
// 來源情境：志願小位免抽、可提前臨櫃繳費選位 → 這些位子在抽籤/志願分發前就已被佔走；
//          以及前一輪已配位且繳費確定者。對應物業後台「繳費狀態維護」（ResultView Phase II）。
//
// 原型：localStorage（key parkfee:occupied，JSON 字串陣列）僅供本機測試，預設空。
// 正式版：由後端提供（已繳費 household/vehicle → 車位編號），住戶端只讀此清單。

const KEY = 'parkfee:occupied'

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
  return [] // 正式版由後端提供已繳費/已配位車位；原型可寫 localStorage[parkfee:occupied] 測試
}

// 物業維護頁寫入鎖定/已佔車位（原型：localStorage）。Supabase 化後改走後端。
export function saveOccupied(ids) {
  localStorage.setItem(KEY, JSON.stringify([...new Set((ids || []).map(String))]))
}
