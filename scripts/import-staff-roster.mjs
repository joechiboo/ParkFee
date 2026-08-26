// 匯入社區工作人員名單 → Supabase public.staff_roster（供 check-roster.mjs 比對）。
//
// ⚠️ 需 service_role（繞過 RLS，只在信任的本機跑；永不進前端／VITE_／git）。
//    .env 加：SUPABASE_SERVICE_ROLE_KEY=eyJ...（Dashboard → Settings → API → service_role）
//
// 用法：
//   node scripts/import-staff-roster.mjs                       # 讀 private/staff-roster.txt
//   node scripts/import-staff-roster.mjs <名單檔>              # 指定檔案
//   node scripts/import-staff-roster.mjs --list                # 只列出目前 DB 內容
//
// 名單檔格式：一行一位，可寫「崗位-姓名」或只寫姓名；# 開頭為註解。
//   例：經理-陳進茂 ／ 日班AB-濮宗佑 ／ 陳大明
//
// 離職者：請直接改 DB 的「在職」欄為 false（勿刪，辦法要求離職前讓出車位，需留紀錄）。
// 本腳本為 upsert：檔案內的人一律設為在職，不在檔案內的既有紀錄**不動**。
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function loadEnv() {
  const env = { ...process.env }
  try {
    for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
      if (m && env[m[1]] == null) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* 無 .env 也行 */
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
const db = createClient(URL, KEY, { auth: { persistSession: false } })

if (process.argv.includes('--list')) {
  const { data, error } = await db.from('staff_roster').select('*').order('姓名')
  if (error) throw error
  console.log(`目前名單 ${data.length} 位：`)
  for (const r of data) console.log(`  ${r.在職 ? '　' : '（離職）'}${r.姓名}${r.崗位 ? `　${r.崗位}` : ''}`)
  process.exit(0)
}

const path = process.argv[2] || 'private/staff-roster.txt'
const rows = readFileSync(path, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const i = l.lastIndexOf('-')
    return i > 0
      ? { 姓名: l.slice(i + 1).trim(), 崗位: l.slice(0, i).trim() }
      : { 姓名: l, 崗位: null }
  })
  .filter((r) => r.姓名)

if (!rows.length) {
  console.error(`${path} 沒有讀到任何名字`)
  process.exit(1)
}

const { error } = await db
  .from('staff_roster')
  .upsert(rows.map((r) => ({ ...r, 在職: true, updated_at: new Date().toISOString() })), { onConflict: '姓名' })
if (error) throw error

console.log(`✓ 已匯入 ${rows.length} 位 → staff_roster（${path}）`)
for (const r of rows) console.log(`  ${r.姓名}${r.崗位 ? `　${r.崗位}` : ''}`)
console.log('\n※ 離職者請於 DB 將「在職」改為 false（勿刪，需保留紀錄）。')
