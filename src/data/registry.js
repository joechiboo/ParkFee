// 登記名冊：正規化、驗證、去重（每戶限登記一次）、雙管道（線上＋紙本）合併。
// schema（HANDOFF §8 / docs 04）：
//   戶號, 車號, 車種(一般|重機), 第幾輛, 身障(Y|N), 志願小位(Y|N), 登記時間, 聯絡電話,
//   車位志願(戶層級，分隔的車位編號), 志願落選保底(Y|N), 來源(線上|紙本)
// 車位志願／志願落選保底為「戶層級」：CSV 可只填在第 1 輛列，buildRoster 會傳播到全戶各列。
//
// 設計重點：
//   - 一戶可有多列（第 1、2、3 輛），所以「去重」不是依戶號砍列，
//     而是偵測「同戶的多次送出」（線上 + 紙本各填一次、或重複送）→ 保留最新、列衝突供人工裁決。
//   - 偵測法（穩健、不依賴時間格式）：依檔案順序處理；同戶若再次出現「已看過的第幾輛」
//     即視為新的一次送出 → 旗標衝突，並以較新（檔案後面）那次取代。

import { normalizeTWPlate } from './plate.js'
import { normalizeHousehold, isValidHousehold } from './household.js'

export const REGISTRATION_COLUMNS = [
  '戶號',
  '車號',
  '車種',
  '第幾輛',
  '身障',
  '志願小位',
  '登記時間',
  '聯絡電話',
  '車位志願',
  '志願落選保底',
  '來源',
]

export const SOURCE = { ONLINE: '線上', PAPER: '紙本' }

// 戶號正規化/驗證的**單一事實來源**＝ household.js（與註冊 Edge Function normalize.ts 對齊）。
// 此處不再自訂規則，避免「註冊放行、匯入卻擋掉」的不一致（曾因此把 3 碼戶誤判無效）。

// 是/否/Y/N/true/1/勾 → 'Y' or 'N'
export function toYN(v) {
  if (v === true) return 'Y'
  const s = String(v ?? '').trim()
  return /^(y|yes|是|v|✓|true|1|有|需要)$/i.test(s) ? 'Y' : 'N'
}

// 車種文字 → 一般 | 重機
export function normalizeVehicleType(v) {
  // 注意：一般選項文字也含「250CC」，故不可用 250 判別；以「重 / ↑ / 紅 / 黃」為重機標記。
  return /重|↑|紅|黃/.test(String(v ?? '')) ? '重機' : '一般'
}

// 車位志願：陣列或分隔字串（、，,；; 或空白）→ 去空白、去重、保序的車位編號陣列。
export function parseWishes(v) {
  const list = Array.isArray(v) ? v : String(v ?? '').split(/[、,，;；\s]+/)
  const seen = new Set()
  const out = []
  for (const x of list) {
    const id = String(x).trim()
    if (id && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

// 正規化單列原始登記資料 → 標準 entry。
export function normalizeRow(raw, fallbackSource = SOURCE.ONLINE) {
  const 第幾輛 = Number(raw.第幾輛) || 1
  return {
    戶號: normalizeHousehold(raw.戶號),
    車號: normalizeTWPlate(raw.車號),
    車種: normalizeVehicleType(raw.車種),
    第幾輛,
    // 無障礙以「人」為單位，僅第 1 輛具該屬性
    身障: 第幾輛 === 1 ? toYN(raw.身障) : 'N',
    志願小位: toYN(raw.志願小位),
    登記時間: String(raw.登記時間 ?? '').trim(),
    聯絡電話: String(raw.聯絡電話 ?? '').trim(),
    車位志願: parseWishes(raw.車位志願), // 戶層級；buildRoster 會傳播到全戶
    志願落選保底: toYN(raw.志願落選保底),
    來源: raw.來源 || fallbackSource,
  }
}

// 驗證單列，回傳 { errors:[], warnings:[] }。
export function validateRow(e) {
  const errors = []
  const warnings = []
  if (!isValidHousehold(e.戶號)) errors.push(`戶號格式錯誤：「${e.戶號}」（應如 H3-6、S1-2）`)
  if (!e.車號) errors.push('車號為空')
  if (!['一般', '重機'].includes(e.車種)) errors.push(`車種非法：「${e.車種}」`)
  if (!Number.isInteger(e.第幾輛) || e.第幾輛 < 1) errors.push(`第幾輛非法：「${e.第幾輛}」`)
  if (e.車種 === '重機' && e.志願小位 === 'Y')
    warnings.push(`${e.戶號} 重機勾選志願小位：重機佔雙大位、不適用志願小位，請受理人員確認`)
  if (e.車種 === '重機' && e.身障 === 'Y')
    warnings.push(`${e.戶號} 重機勾選無障礙：請確認是否應改一般車種`)
  return { errors, warnings }
}

// 由「已正規化的長表列」建立名冊。
// 回傳 { entries, conflicts, invalid, warnings }。
export function buildRoster(rows) {
  // normalizeRow 為冪等，重複正規化安全；統一在此正規化以簡化呼叫端。
  const normalized = rows.map((r) => normalizeRow(r, r.來源 || SOURCE.ONLINE))

  const invalid = []
  const warnings = []
  const valid = []
  for (const e of normalized) {
    const { errors, warnings: w } = validateRow(e)
    warnings.push(...w)
    if (errors.length) invalid.push({ entry: e, errors })
    else valid.push(e)
  }

  // 依檔案順序去重：同戶再次出現「已看過的第幾輛」→ 視為新一次送出，取代舊的、列衝突。
  const groups = new Map() // 戶號 -> { rows:[], seen:Set }
  const conflicts = []
  for (const e of valid) {
    let g = groups.get(e.戶號)
    if (!g) {
      g = { rows: [], seen: new Set() }
      groups.set(e.戶號, g)
    }
    if (g.seen.has(e.第幾輛)) {
      // 新一次送出 → 記錄衝突，並以新送出取代舊的
      conflicts.push({ 戶號: e.戶號, 說明: '同戶多次登記（線上/紙本重複或重送），已採用最新一次' })
      g.rows = []
      g.seen = new Set()
    }
    g.rows.push(e)
    g.seen.add(e.第幾輛)
  }

  // 車位志願／志願落選保底為戶層級：CSV 可能只填在第 1 輛列 → 傳播到全戶各列，
  // 引擎才吃得到（同戶多車各自帶同一份志願，依順序號跨輪共用）。
  const entries = []
  for (const g of groups.values()) {
    const wishes = g.rows.find((r) => r.車位志願.length)?.車位志願 ?? []
    const fallback = g.rows.some((r) => r.志願落選保底 === 'Y') ? 'Y' : 'N'
    for (const r of g.rows) {
      r.車位志願 = wishes
      r.志願落選保底 = fallback
    }
    entries.push(...g.rows)
  }
  return { entries, conflicts, invalid, warnings }
}

// 合併線上＋紙本兩來源（各自為已 parse 的原始列陣列），標註來源後交給 buildRoster。
export function mergeChannels(onlineRows = [], paperRows = []) {
  const tagged = [
    ...onlineRows.map((r) => normalizeRow(r, SOURCE.ONLINE)),
    ...paperRows.map((r) => normalizeRow(r, SOURCE.PAPER)),
  ]
  return buildRoster(tagged)
}
