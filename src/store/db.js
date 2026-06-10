// 登記儲存層（介面）— 目前以 localStorage 實作，之後可換 Supabase 而不動呼叫端。
//
// 資料模型（見 docs/12 §4）：
//   household { 戶號(PK), 電話, createdAt }
//   vehicle   { 車號(PK,全域唯一), 戶號(FK), 車種(一般|重機), 第幾輛, 身障, 志願小位 }
//
// 規則：
//   - 登記即註冊：第一次登記就建戶；一戶號限註冊一次（辦法 伍二(八)）。
//   - 車號全域唯一，不可被兩戶登記。
//   - 登入：戶號 + 任一已登記車號 命中即通過該戶。
//
// 注意：localStorage 僅單機。正式跨裝置登入需後端（Supabase），屆時只換本檔實作。

import { normalizeTWPlate } from '../data/plate.js'

const KEY = 'parkfee_reg_v1'

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || { households: {}, vehicles: {} }
  } catch {
    return { households: {}, vehicles: {} }
  }
}
function save(db) {
  localStorage.setItem(KEY, JSON.stringify(db))
}

export class RegistrationError extends Error {}

const normHouse = (s) => String(s ?? '').trim()

// 取得某戶（含其車輛），找不到回 null。
export function getHousehold(戶號) {
  const db = load()
  const h = db.households[normHouse(戶號)]
  if (!h) return null
  const vehicles = Object.values(db.vehicles)
    .filter((v) => v.戶號 === h.戶號)
    .sort((a, b) => a.第幾輛 - b.第幾輛)
  return { ...h, vehicles }
}

// 登記即註冊。vehicles: [{車號, 車種, 身障, 志願小位}]，第幾輛依陣列序自動給。
// 回傳建立後的整戶資料；違規拋 RegistrationError。
export function register({ 戶號, 電話, vehicles }) {
  const hid = normHouse(戶號)
  if (!hid) throw new RegistrationError('請填寫戶號')
  if (!Array.isArray(vehicles) || vehicles.length === 0)
    throw new RegistrationError('至少要登記一台機車')

  const db = load()
  if (db.households[hid]) throw new RegistrationError(`戶號 ${hid} 已登記過，請改用登入查看或修改`)

  // 正規化 + 驗證車輛
  const cleaned = vehicles.map((v, i) => {
    const 車號 = normalizeTWPlate(v.車號)
    if (!車號) throw new RegistrationError(`第 ${i + 1} 台未填車號`)
    return {
      車號,
      戶號: hid,
      車種: v.車種 === '重機' ? '重機' : '一般',
      第幾輛: i + 1,
      身障: !!v.身障,
      志願小位: !!v.志願小位,
    }
  })

  // 車號重複（同次提交內 + 全域）
  const seen = new Set()
  for (const v of cleaned) {
    if (seen.has(v.車號)) throw new RegistrationError(`車號 ${v.車號} 重複填寫`)
    seen.add(v.車號)
    if (db.vehicles[v.車號]) throw new RegistrationError(`車號 ${v.車號} 已被其他戶登記`)
  }

  db.households[hid] = { 戶號: hid, 電話: String(電話 ?? '').trim(), createdAt: new Date().toISOString() }
  for (const v of cleaned) db.vehicles[v.車號] = v
  save(db)
  return getHousehold(hid)
}

// 登入：戶號 + 任一已登記車號。命中回整戶資料，否則 null。
export function login(戶號, 車號) {
  const hid = normHouse(戶號)
  const plate = normalizeTWPlate(車號)
  const db = load()
  const v = db.vehicles[plate]
  if (!v || v.戶號 !== hid) return null
  return getHousehold(hid)
}

// 開發用：清空。
export function _reset() {
  localStorage.removeItem(KEY)
}
