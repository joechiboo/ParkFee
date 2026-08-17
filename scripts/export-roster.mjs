// 匯出登記名冊 CSV（供抽籤）— 在「信任的本機」用 service_role 連 Supabase 撈全部登記。
//
// ⚠️ service_role = 上帝權限，繞過 RLS。只在本機跑、永不進前端/VITE_/git。
//
// 用法：
//   1) 在 .env（已 gitignored）加一行（值來自 Supabase Dashboard → Settings → API → service_role key）：
//        SUPABASE_SERVICE_ROLE_KEY=eyJ...
//      （URL 會沿用 .env 既有的 VITE_SUPABASE_URL；或另設 SUPABASE_URL）
//   2) node scripts/export-roster.mjs
//   3) 產出 private/roster-<時間>.csv（gitignored）→ 交物業 或 匯入 AllocateView 抽籤
//
// CSV schema 與 registry.js 一致：戶號,車號,車種,第幾輛,身障,志願小位,登記時間,聯絡電話,車位志願,志願落選保底,來源

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// ── 讀 env（process.env 優先，否則解析 .env）──
function loadEnv() {
  const env = { ...process.env }
  try {
    for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
      if (m && env[m[1]] == null) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* 無 .env 也行，靠 process.env */
  }
  return env
}

const env = loadEnv()
const URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('缺少設定：需要 SUPABASE_URL（或 VITE_SUPABASE_URL）與 SUPABASE_SERVICE_ROLE_KEY')
  console.error('請在 .env 加 SUPABASE_SERVICE_ROLE_KEY=...（Dashboard → Settings → API → service_role）')
  process.exit(1)
}

const yn = (b) => (b ? 'Y' : 'N')
const esc = (v) => {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
// 登記欄 + 指派欄（車位編號、已繳費）：物業抽籤前指派的小位/無障礙帶著車位 → 抽籤才能跳過、不重複分。
// 車位類型/配位狀態不帶（distribute 由車位編號反查主檔得知型別）；重機＝同車號掛兩個車位編號（頓號分隔）。
const COLUMNS = ['戶號', '車號', '車種', '第幾輛', '身障', '志願小位', '登記時間', '聯絡電話', '車位志願', '志願落選保底', '社宅', '來源', '車位編號', '已繳費']

const db = createClient(URL, KEY, { auth: { persistSession: false } })

const { data: households, error: he } = await db
  .from('household')
  .select('戶號, 電話, 車位志願, 志願落選保底, 社宅, created_at')
if (he) throw he
const { data: vehicles, error: ve } = await db
  .from('vehicle')
  .select('車號, 戶號, 車種, 第幾輛, 身障, 志願小位, 車位編號, 已繳費')
  .order('戶號')
  .order('第幾輛')
if (ve) throw ve

const hById = new Map(households.map((h) => [h.戶號, h]))
const rows = vehicles.map((v) => {
  const h = hById.get(v.戶號) || {}
  return {
    戶號: v.戶號,
    車號: v.車號,
    車種: v.車種,
    第幾輛: v.第幾輛,
    身障: yn(v.身障),
    志願小位: yn(v.志願小位),
    登記時間: h.created_at || '',
    聯絡電話: h.電話 || '',
    車位志願: Array.isArray(h.車位志願) ? h.車位志願.join('、') : '',
    志願落選保底: yn(h.志願落選保底),
    社宅: yn(h.社宅), // 社會住宅住戶（限公益位）
    來源: '線上',
    車位編號: v.車位編號 || '', // 物業抽籤前已指派（小位/無障礙/保留）；重機＝兩位頓號分隔
    已繳費: yn(v.已繳費),
  }
})

const csv = '﻿' + [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => esc(r[c])).join(','))].join('\r\n')

if (!existsSync('private')) mkdirSync('private')
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '').replace(/(\d{8})(\d{4})/, '$1-$2')
const out = `private/roster-${stamp}.csv`
writeFileSync(out, csv, 'utf8')

console.log(`✓ 匯出 ${rows.length} 筆車輛 / ${households.length} 戶 → ${out}`)
console.log('  下一步：把這份 CSV 匯入 AllocateView（/allocate）跑抽籤，或交給物業。')
