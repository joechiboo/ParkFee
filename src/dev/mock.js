// 開發用 mock 名冊產生器（dev-only；正式 build 由 import.meta.env.DEV 排除，不會打包上線）。
// deterministic（依 index 變化、不用亂數）→ 每次產出一致、好比對。
// 戶號用測試標記：戶段一律「9X」（90–99，第一碼 9、兩碼）→ 格式合法、寫實，又不會撞真實戶
//   （真實戶為小號），清除只要刪「戶段 9X」這批。
//
// 注意：識別字一律 ASCII（Vite/esbuild 不吃中文綁定名）；中文只當物件 key / 字串值。

import { normalizeTWPlate } from '../data/plate.js'
import { rentableMotorSeats } from '../map/seats.js'

// mock 戶號標記：跨棟 A–H/S，「戶」段為 9X（90–99，第一碼 9、恰兩碼）→ 清除只刪這批。
export const MOCK_HU_RE = /-9\d$/
export const WIPE_SQL = `delete from public.household where 戶號 ~ '-9[0-9]$';`

const BUILDINGS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'S']
// 跨棟分配；戶段 9X（90+）標記測試、兩碼合法；S 恆 1F、A–H 散 1–5 樓。
function mockHid(i) {
  const b = BUILDINGS[i % BUILDINGS.length]
  const floor = b === 'S' ? 1 : 1 + (i % 5)
  const unit = 90 + Math.floor(i / BUILDINGS.length) // 90、91、92…（兩碼、第一碼 9）
  return `${b}${floor}-${unit}`
}

// 從可承租機車位取 id 供志願取樣，確保志願是「真的存在的車位編號」。
function seatIdPool() {
  return rentableMotorSeats().map((s) => String(s.id))
}

// 產生 20 戶 mock：含單/多車、一般/重機、身障、志願小位；志願分 少選/未填/多選/正常。
export function makeMockHouseholds({ count = 20 } = {}) {
  const pool = seatIdPool()
  const pick = (start, n) => {
    const out = new Set()
    for (let k = 0; out.size < n && k < n * 3; k++) out.add(pool[(start + k * 7) % pool.length])
    return [...out]
  }

  const list = []
  for (let i = 0; i < count; i++) {
    const hid = mockHid(i) // 跨棟 A–H/S，戶段 9xx
    const carCount = i % 7 === 6 ? 3 : i % 3 === 0 ? 2 : 1 // 多數 1 車、部分 2~3 車

    const vehicles = []
    for (let c = 0; c < carCount; c++) {
      vehicles.push({
        車號: normalizeTWPlate(`MOCK${String(i + 1).padStart(2, '0')}${c + 1}`),
        車種: c === 0 && i % 5 === 0 ? '重機' : '一般',
        身障: c === 0 && i % 8 === 0,
        志願小位: c === 0 && i % 4 === 3,
      })
    }

    const mode = i % 4
    const wishes =
      mode === 0 ? pick(i * 3, 2) // 少選
      : mode === 1 ? [] // 未填（測落選/no-wish 路徑）
      : mode === 2 ? pick(i * 5, 15) // 多選
      : pick(i * 7, 6) // 正常

    list.push({
      戶號: hid,
      電話: `0900${String(100000 + i).slice(-6)}`,
      認證車號: vehicles[0].車號, // saveWishes/編輯 的擁有權證明
      vehicles,
      車位志願: wishes,
      志願落選保底: i % 2 === 0,
    })
  }
  return list
}

// 攤平成 distribute() 用的 registration rows（每車一列、帶戶層級車位志願）。
export function toRows(households) {
  const rows = []
  for (const h of households) {
    h.vehicles.forEach((v, idx) => {
      rows.push({
        戶號: h.戶號,
        車號: v.車號,
        車種: v.車種,
        第幾輛: idx + 1,
        身障: v.身障,
        志願小位: v.志願小位,
        車位志願: h.車位志願,
      })
    })
  }
  return rows
}
