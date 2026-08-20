// 車位年繳費率 — 決策表 A7（辦法柒二／財務捌三）。
//   一般機車 100/月 → 年繳 1,200；250CC↑重機（佔雙位）300/月 → 年繳 3,600；
//   自行車「不收取費用」（辦法柒二末款）→ 0。
export const ANNUAL_FEE = { 一般: 1200, 重機: 3600, 自行車: 0 }

// 依車種回傳年繳金額（未知車種一律以一般機車計，維持既有行為）。
export function feeFor(車種) {
  if (車種 === '重機') return ANNUAL_FEE.重機
  if (車種 === '自行車') return ANNUAL_FEE.自行車
  return ANNUAL_FEE.一般
}
