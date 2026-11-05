// 單台車在「結果確認」頁(ResultView)的狀態鍵 — 純函式，供顯示 + 測試。
//   paid       已繳費且有車位編號 → 已繳費確認
//   pending    有車位編號但未繳費 → 待繳費（中籤/指派、限期繳費）
//   arranging  重機待安排（不參與抽籤）／待第二輪（12/1 第一輪未抽到的第 2 輛起，12/15 再分配）
//   waitlist   有配位狀態但無車位 → 落選/候補/未繳視同放棄
//   registered 其餘（已登記、尚未配位）
// 防呆：已繳費旗標為真但沒有車位編號（異常資料）不算 paid，落到 registered。
export const HEAVY_WAIT_STATUS = '待安排'
export const NEXT_STAGE_STATUS = '待第二輪' // 兩輪抽籤 stage 1 發佈後，第 2 輛起與工作人員的狀態
export const FORFEIT_STATUS = '視同放棄' // 中籤逾期未繳，維護頁批次解除後留下；第二輪不再分配

export function vehicleResultStatus(v) {
  if (v?.已繳費 && v?.車位編號) return 'paid'
  if (v?.車位編號) return 'pending'
  if (v?.配位狀態 === HEAVY_WAIT_STATUS || v?.配位狀態 === NEXT_STAGE_STATUS) return 'arranging'
  if (v?.配位狀態) return 'waitlist'
  return 'registered'
}
