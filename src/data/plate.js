// 台灣車牌正規化（登記／匯入用）。
// 原則：統一大寫、去空白、字母段與數字段之間補單一連字號。
// 註：O/0、I/1、B/8 之類的 OCR 誤判修正屬「車牌辨識(LPR, Phase II)」範疇，
//     對人工輸入的登記資料盲修會誤改正確車牌，故此處刻意不做。
export function normalizeTWPlate(raw) {
  if (raw == null) return ''
  // 全形→半形連字號、去所有空白、轉大寫
  const s = String(raw)
    .toUpperCase()
    .replace(/[\s　]/g, '')
    .replace(/[—–－‐]/g, '-')
  const compact = s.replace(/-/g, '')
  // 住戶自己打了連字號就照他的位置保留（11/17：舊式車牌 K12-345 前段字母數字混合，
  //   原本會被重拆成 K-12345、再被判格式不對）。沒打連字號才自動在字母段與數字段之間補一個。
  if (/^[A-Z0-9]+-[A-Z0-9]+$/.test(s)) return s
  // 台灣車牌多為「字母段 + 數字段」或「數字段 + 字母段」兩段，於邊界補一個連字號
  const m = compact.match(/^([A-Z]+)(\d+)$/) || compact.match(/^(\d+)([A-Z]+)$/)
  if (m) return `${m[1]}-${m[2]}`
  // 不規則或多段者保留（已大寫去空白），不強拆
  return s
}

// 比對用的鍵：只留英數字。同一台車不論有沒有打連字號都是同一個鍵。
// （X1Y-234 這種英數交錯的舊式車牌無法自動補連字號，曾因此在兩戶各登記一次，2026-11-16）
export function plateKey(raw) {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

// 車號像不像車牌：回 null＝沒問題；否則回一句說明。
//   台灣機車車牌是「2–5 碼 - 2–5 碼」的英數字，一定有數字。
//   擋的是把自行車特徵、「無」、廠牌名稱填進車號欄（那會被當成機車抽車位、收費）。
export function plateProblem(raw) {
  const s = normalizeTWPlate(raw)
  if (!s) return '請填車號'
  if (!/^[A-Z0-9-]+$/.test(s) || !/\d/.test(s))
    return '這不是車牌號碼。沒有車牌的車（自行車、電動代步車等）請改按「＋自行車」登記，或洽管理中心'
  if (!s.includes('-')) return `請照車牌上的寫法加上連字號（例：${s.slice(0, 3)}-${s.slice(3)}）`
  // 自動補的連字號位置不對（例：舊式車牌 K12345 被拆成 K-12345）→ 請住戶照車牌自己打連字號
  if (/^[A-Z0-9]-|-[A-Z0-9]$/.test(s)) return '請照車牌上的寫法，在正確的位置自己打連字號（例：K12-345）'
  // 兩邊各 2–5 碼：掛牌電動機車是 2 碼＋5 碼（例 AB-12345，11/17 秘書回報真實車牌被誤判）
  if (!/^[A-Z0-9]{2,5}-[A-Z0-9]{2,5}$/.test(s)) return '車號格式不對，請照車牌上的寫法填（例：ABC-1234）'
  return null
}
