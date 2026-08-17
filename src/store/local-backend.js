// 登記儲存層 — localStorage 後端（單機、開發/離線用）。
//
// 與 supabase-backend.js 介面一致，供 db.js facade 在「未設定 Supabase」時使用。
// 正式跨裝置登入請設定 VITE_SUPABASE_URL → db.js 會改走 supabase-backend.js。
//
// 資料模型（見 docs/12 §4）：
//   household { 戶號(PK), 電話, createdAt }
//   vehicle   { 車號(PK,全域唯一), 戶號(FK), 車種(一般|重機), 第幾輛, 身障, 志願小位 }

import { normalizeTWPlate } from '../data/plate.js'
import { normalizeHousehold } from '../data/household.js'

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

const normHouse = normalizeHousehold // 單一事實來源：household.js（大寫/全形/去空白）

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
export function register({ 戶號, 電話, 社宅, vehicles }) {
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

  db.households[hid] = { 戶號: hid, 電話: String(電話 ?? '').trim(), 社宅: !!社宅, createdAt: new Date().toISOString() }
  for (const v of cleaned) db.vehicles[v.車號] = v
  save(db)
  return getHousehold(hid)
}

// 更新既有戶的登記（編輯）。戶號不可變、且必須已登記。
// vehicles 整批取代（重新驗證車號全域唯一、重編「第幾輛」）；電話可更新。
// 回傳更新後的整戶資料；違規拋 RegistrationError。
export function updateHousehold({ 戶號, 電話, 社宅, vehicles }) {
  const hid = normHouse(戶號)
  if (!hid) throw new RegistrationError('請填寫戶號')
  const db = load()
  if (!db.households[hid]) throw new RegistrationError(`戶號 ${hid} 尚未登記，無法編輯`)
  if (!Array.isArray(vehicles) || vehicles.length === 0)
    throw new RegistrationError('至少要保留一台機車')

  // 該戶以外的車輛（檢查全域唯一時要排除本戶舊車，因為本戶整批取代）
  const others = Object.fromEntries(Object.entries(db.vehicles).filter(([, v]) => v.戶號 !== hid))

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

  const seen = new Set()
  for (const v of cleaned) {
    if (seen.has(v.車號)) throw new RegistrationError(`車號 ${v.車號} 重複填寫`)
    seen.add(v.車號)
    if (others[v.車號]) throw new RegistrationError(`車號 ${v.車號} 已被其他戶登記`)
  }

  db.vehicles = others
  for (const v of cleaned) db.vehicles[v.車號] = v
  db.households[hid] = {
    ...db.households[hid],
    電話: String(電話 ?? '').trim(),
    ...(社宅 !== undefined ? { 社宅: !!社宅 } : {}),
  }
  save(db)
  return getHousehold(hid)
}

// 寫該戶車位志願序（戶層級）+ 志願落選保底。單機版不驗認證車號（同裝置）。
export function saveWishes({ 戶號, 車位志願, 志願落選保底 }) {
  const hid = normHouse(戶號)
  const db = load()
  if (!db.households[hid]) throw new RegistrationError(`戶號 ${hid} 尚未登記`)
  const seen = new Set()
  const wishes = []
  for (const x of Array.isArray(車位志願) ? 車位志願 : []) {
    const id = String(x).trim()
    if (id && !seen.has(id)) {
      seen.add(id)
      wishes.push(id)
    }
  }
  db.households[hid] = { ...db.households[hid], 車位志願: wishes, 志願落選保底: !!志願落選保底 }
  save(db)
  return getHousehold(hid)
}

// 物業發佈配位結果 → 回填 vehicle（單機版不驗密碼）。
export function publishResult({ rows }) {
  const db = load()
  for (const v of Object.values(db.vehicles)) {
    v.車位編號 = null
    v.車位類型 = null
    v.配位狀態 = null
    v.簽約期限 = null
  }
  let updated = 0
  const notFound = []
  for (const r of Array.isArray(rows) ? rows : []) {
    const plate = normalizeTWPlate(r?.車號)
    if (!plate) continue
    const v = db.vehicles[plate]
    if (!v) {
      notFound.push(plate)
      continue
    }
    v.車位編號 = r.車位編號 || null
    v.車位類型 = r.車位類型 || null
    v.配位狀態 = r.狀態 || null
    v.簽約期限 = r.簽約期限 || null
    updated += 1
  }
  save(db)
  return { updated, notFound }
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
