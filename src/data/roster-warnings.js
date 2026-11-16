// 名冊警示（名冊頁用）：找出「會讓收費或配位出錯、要秘書聯繫住戶確認」的登記。
// 2026-11-16 開放登記一天半後檢查出的實際狀況：同一戶用錯的舊戶號與正確戶號各登記一次、
// 同一台車因連字號有無掛在兩戶、車號欄被填成「日月光」「電動代步車」等。
// 純函式：輸入名冊頁的 households（[{ 戶號, 電話, vehicles: [{ 車號, 車種 }] }]），回 Map(戶號 → 警示字串陣列)。
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

export function rosterWarnings(households) {
  const out = new Map()
  const add = (hid, msg) => {
    if (!out.has(hid)) out.set(hid, [])
    if (!out.get(hid).includes(msg)) out.get(hid).push(msg)
  }
  const motors = [] // { hid, plate, key }
  const byPhone = new Map()

  for (const h of households) {
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
