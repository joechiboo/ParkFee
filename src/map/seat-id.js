// 車位編號正規化 — 機車位與自行車位「地面漆的號碼」各自從 1 起跳、會互撞
// （機車 1–655、自行車 1–164，其中 155 個號碼字面重複）。
//
// 解法：自行車位在**系統內部**一律加前綴並補零成 B001–B164，機車位維持裸數字 1–655。
//   - 儲存（locked_seat.車位編號 / vehicle.車位編號 / household.車位志願）一律存正規形。
//   - **顯示給住戶時剝掉前綴與前導零**（B012 → 12），與地面漆的數字一致；
//     車種由上下文或「車位類型」欄表達，不靠編號本身。
//
// 為何補零：CSV、SQL order by、匯出檔都是字串排序，B10 < B9 會排錯；
//   固定三位後純字串排序即為正確順序，省掉自訂比較器。
//
// 為何不改 b1-classification.json：那份是現場盤點的 ground truth（記錄地面實際漆的號碼，
//   工作流為 demo HTML → build-classification-from-demo.mjs）。前綴屬於應用層的鍵，
//   在 seats.js 產出時套用，盤點管線保持不動。

export const BIKE_PREFIX = 'B'
const BIKE_DIGITS = 3

export const KIND = {
  MOTOR: '機車',
  BIKE: '自行車',
}

// 自行車地面號碼 → 正規形。接受 12 / '12' / '012' / 'B012' / 'b12'，一律得 'B012'。
export function toBikeId(raw) {
  const n = bikeNumber(raw)
  if (n == null) return ''
  return BIKE_PREFIX + String(n).padStart(BIKE_DIGITS, '0')
}

// 取自行車編號的數值部分；非自行車編號或無法解析回 null。
function bikeNumber(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const m = /^[Bb]?0*(\d+)$/.exec(s)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

export function isBikeId(id) {
  return /^[Bb]\d+$/.test(String(id ?? '').trim())
}

// 公益自行車位 114–118（辦法參二(七)明列）。用途比照機車公益位＝社宅戶專用
// （docs/10 Q17，已併入辦法修訂主案第 10 條，待例會）。
// ⚠️ 與機車不同：盤點檔對自行車**沒有標 public**（機車 20 格有標、自行車 0 格），
//    因為公益自行車位在平面圖上沒有金框之類的視覺標示 → 只能以辦法條文為準硬列。
// 放在本檔（而非 seats.js）是因為 seats.js 直接 import JSON，純 Node 腳本載不進來；
//    列印圖等 scripts/ 也要用同一份清單，故置於無相依的本檔，由 seats.js 轉出。
export const PUBLIC_BIKE_IDS = ['114', '115', '116', '117', '118'].map(toBikeId)

// 編號屬哪種車位。裸數字一律視為機車（既有資料語意，不可更動）。
export function seatKind(id) {
  return isBikeId(id) ? KIND.BIKE : KIND.MOTOR
}

// 顯示用：剝前綴與前導零 → 與地面漆的數字一致。機車編號原樣回傳。
//   'B012' → '12'、'B001' → '1'、'123' → '123'
export function displaySeatId(id) {
  const s = String(id ?? '').trim()
  if (!isBikeId(s)) return s
  return String(bikeNumber(s) ?? '')
}

// 顯示用（多格版）：重機等佔多格者以「、」串接（例 '150、151'），逐格剝前綴後再串回。
export function displaySeatIds(value) {
  return String(value ?? '')
    .split('、')
    .map((x) => displaySeatId(x.trim()))
    .filter(Boolean)
    .join('、')
}

// 排序鍵：取數值部分。'B012' → 12、'123' → 123。
// 直接對 'B012' 做 +id 會得到 NaN，而 NaN 在比較器裡不報錯、只會安靜排錯 → 一律用本函式。
export function seatSortKey(id) {
  const s = String(id ?? '').trim()
  if (isBikeId(s)) return bikeNumber(s) ?? Number.NaN
  const n = Number(s)
  return Number.isFinite(n) ? n : Number.NaN
}

// 同車種內比大小（跨車種比較無意義，呼叫端請先分流）。
export function compareSeatId(a, b) {
  return seatSortKey(a) - seatSortKey(b)
}

// 人手輸入正規化（物業批次鎖定、CSV 匯入）：依車種把使用者打的號碼轉成正規形。
//   normalizeSeatInput('12', KIND.BIKE)  → 'B012'
//   normalizeSeatInput('12', KIND.MOTOR) → '12'
// 打字入口若不指定車種，'12' 會被當成機車 12 —— 這正是自行車必須顯式帶車種的原因。
export function normalizeSeatInput(raw, kind = KIND.MOTOR) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  if (kind === KIND.BIKE) return toBikeId(s)
  // 機車：容許誤打前綴時直接判為非法（回空），避免把 B012 當成機車 12。
  if (isBikeId(s)) return ''
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? String(n) : ''
}
