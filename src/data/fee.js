// 機車車位年繳費率 — 決策表 A7（辦法柒二／財務捌三）。
//   一般機車 100/月 → 年繳 1,200；250CC↑重機（佔雙位）300/月 → 年繳 3,600。
export const ANNUAL_FEE = { 一般: 1200, 重機: 3600 }

// 依車種回傳年繳金額（非「重機」一律以一般計）。
export function feeFor(車種) {
  return 車種 === '重機' ? ANNUAL_FEE.重機 : ANNUAL_FEE.一般
}
