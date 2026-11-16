// 名冊警示（名冊頁用）：找出「會讓收費或配位出錯、要秘書聯繫住戶確認」的登記。
// 2026-11-16 開放登記一天半後檢查出的實際狀況：同一戶用錯的舊戶號與正確戶號各登記一次、
// 同一台車因連字號有無掛在兩戶、車號欄被填成「日月光」「電動代步車」等。
// 純函式：輸入名冊頁的 households（[{ 戶號, 電話, 車位志願, 志願落選保底, 工作人員, vehicles: [{ 車號, 車種, 第幾輛, 車位編號 }] }]），回 Map(戶號 → 警示字串陣列)。
// opts.seats（機車位主檔 [{ id, public }]）＋ opts.locked（已鎖定車位 Set）有給才檢查「容易落選」。
// 只提示、不改資料；每一句都寫明要確認什麼。
import { householdProblem } from './household.js'
import { plateKey, plateProblem } from './plate.js'

const BIKE = '自行車'
const phoneKey = (p) => String(p || '').replace(/[^0-9]/g, '')

// 兩個車號（已去符號）是否「只差一個字」或「相鄰兩字對調」——人工輸入最常見的兩種打錯。
export function nearPlate(a, b) {
  if (a === b || a.length !== b.length) return false
  const diff = []
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i)
  if (diff.length === 1) return true
  return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]
}

// 容易落選的門檻：不同意電腦選號、而第一台的有效志願（扣掉已鎖定、公益位）少於這個數 → 提醒。
// 志願全被前面的人選走就直接落選，等 12/15 第二輪。11/16 模擬：只填 1 格熱門位的落選機率約 80%。
export const FEW_WISHES = 5

export function rosterWarnings(households, { seats = null, locked = null } = {}) {
  const out = new Map()
  const add = (hid, msg) => {
    if (!out.has(hid)) out.set(hid, [])
    if (!out.get(hid).includes(msg)) out.get(hid).push(msg)
  }
  const motors = [] // { hid, plate, key }
  const byPhone = new Map()

  // 每格車位被幾戶排進志願（看競爭有多激烈）
  const wishedBy = new Map()
  for (const h of households) for (const id of h.車位志願 || []) wishedBy.set(String(id), (wishedBy.get(String(id)) || 0) + 1)
  const seatOf = seats ? new Map(seats.map((s) => [String(s.id), s])) : null
  const usableWishes = (h) =>
    (h.車位志願 || []).map(String).filter((id) => seatOf.has(id) && !seatOf.get(id).public && !locked.has(id))

  for (const h of households) {
    if (seatOf && locked && !h.志願落選保底 && !h.工作人員) {
      const first = (h.vehicles || []).find((v) => v.車種 === '一般' && Number(v.第幾輛) === 1)
      if (first && !first.車位編號) {
        const ok = usableWishes(h)
        if (!ok.length)
          add(h.戶號, `沒有可抽的志願${(h.車位志願 || []).length ? '（排的車位都已被選走或鎖定）' : ''}，又不同意電腦選號，第一輪一定落選。請建議住戶到選位頁多排幾格，或勾回「電腦選號」（11/30 前可自己改）`)
        else if (ok.length < FEW_WISHES)
          add(h.戶號, `只排 ${ok.length} 格又不同意電腦選號，這幾格都被前面的人選走就直接落選、等 12/15 第二輪（${ok.map((id) => `${id} 有 ${wishedBy.get(id) - 1} 戶也排`).join('、')}）。請建議住戶多排幾格，或勾回「電腦選號」（11/30 前可自己改）`)
      }
    }
    const hp = householdProblem(h.戶號)
    if (hp) add(h.戶號, `戶號有誤：${hp}。問到正確的門牌與樓層後按「更正戶號」；若住戶已用正確戶號另外登記一筆，確認後把這一筆刪除`)
    const pk = phoneKey(h.電話)
    if (pk) byPhone.set(pk, [...(byPhone.get(pk) || []), h.戶號])
    for (const v of h.vehicles || []) {
      if (v.車種 === BIKE) continue
      const pp = plateProblem(v.車號)
      if (pp) add(h.戶號, `車號「${v.車號}」不是車牌，目前被當成機車（會抽機車位、收 1,200 元）。請問住戶這是什麼車：沒有車牌的自行車請改登記為自行車；確實是機車請補上正確車牌`)
      motors.push({ hid: h.戶號, plate: v.車號, key: plateKey(v.車號) })
    }
  }

  for (let i = 0; i < motors.length; i++)
    for (let j = i + 1; j < motors.length; j++) {
      const a = motors[i]
      const b = motors[j]
      if (a.hid === b.hid || !a.key || !b.key) continue
      if (a.key === b.key) {
        add(a.hid, `車號 ${a.plate} 與 ${b.hid} 的 ${b.plate} 是同一台車，同一台車不能登記在兩戶。請確認哪一筆正確，另一筆刪除或移除這台車`)
        add(b.hid, `車號 ${b.plate} 與 ${a.hid} 的 ${a.plate} 是同一台車，同一台車不能登記在兩戶。請確認哪一筆正確，另一筆刪除或移除這台車`)
      } else if (a.key.length >= 5 && nearPlate(a.key, b.key)) {
        add(a.hid, `車號 ${a.plate} 與 ${b.hid} 的 ${b.plate} 只差一個字，可能是同一戶重複登記、其中一筆打錯。請向住戶確認`)
        add(b.hid, `車號 ${b.plate} 與 ${a.hid} 的 ${a.plate} 只差一個字，可能是同一戶重複登記、其中一筆打錯。請向住戶確認`)
      }
    }

  for (const hids of byPhone.values())
    if (hids.length > 1)
      for (const hid of hids)
        add(hid, `與 ${hids.filter((x) => x !== hid).join('、')} 登記同一支電話。請確認是不同戶（同一人有多戶、代家人登記）還是重複登記`)

  return out
}
