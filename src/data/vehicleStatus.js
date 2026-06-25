// 單台車在「結果確認」頁(ResultView)的狀態鍵 — 純函式，供顯示 + 測試。
//   paid       已繳費且有車位編號 → 已繳費確認
//   pending    有車位編號但未繳費 → 待繳費（中籤/指派、限期繳費）
//   waitlist   有配位狀態但無車位 → 落選/候補
//   registered 其餘（已登記、尚未配位）
// 防呆：已繳費旗標為真但沒有車位編號（異常資料）不算 paid，落到 registered。
export function vehicleResultStatus(v) {
  if (v?.已繳費 && v?.車位編號) return 'paid'
  if (v?.車位編號) return 'pending'
  if (v?.配位狀態) return 'waitlist'
  return 'registered'
}
