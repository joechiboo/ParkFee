<script setup>
// 🛠 工程師專區（dev-only）。路由只在 import.meta.env.DEV 註冊，正式 build 不會有這頁。
import { ref } from 'vue'
import { makeMockHouseholds, toRows, WIPE_SQL } from '../dev/mock.js'
import { register, saveWishes, publishResult, RegistrationError } from '../store/db.js'
import { adminAuth } from '../store/session.js'
import { distribute } from '../lottery/distribute.js'
import { resultRows } from '../export/result.js'
import { buildRoster } from '../data/registry.js'
import { parseCSVObjects } from '../data/csv.js'
import { setImportedRoster, clearImportedRoster } from '../store/roster.js'

// 正式部署也對「管理員」開放此頁（抽籤日免架本機）；純測試工具（灌 mock／清除測試／demo）只在開發模式顯示。
const isDev = import.meta.env.DEV

// ── 灌 mock 進 Supabase ───────────────────────────────────────
const seeding = ref(false)
const seedLog = ref([])
const seedDone = ref(false)

async function seed() {
  seeding.value = true
  seedDone.value = false
  seedLog.value = []
  for (const h of makeMockHouseholds({ count: 20 })) {
    try {
      await register({ 戶號: h.戶號, 電話: h.電話, vehicles: h.vehicles })
      await saveWishes({
        戶號: h.戶號,
        車位志願: h.車位志願,
        志願落選保底: h.志願落選保底,
        認證車號: h.認證車號,
      })
      seedLog.value.push({ id: h.戶號, ok: true, msg: `✓ ${h.vehicles.length} 車 · 志願 ${h.車位志願.length} · ${h.vehicles[0].車種}` })
    } catch (e) {
      const msg = e instanceof RegistrationError ? e.message : (e?.message ?? String(e))
      seedLog.value.push({ id: h.戶號, ok: false, msg })
    }
  }
  seeding.value = false
  seedDone.value = true
}

// ── 清除（RLS 禁 anon 刪 → 給 SQL，貼 Supabase SQL Editor 執行）──
const copied = ref(false)
async function copyWipe() {
  try {
    await navigator.clipboard.writeText(WIPE_SQL)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    /* clipboard 不可用時使用者可手動選取 */
  }
}

// ── 清除配位結果（保留住戶/車輛，只清 vehicle 的結果欄）───────────
// 走 publish-result（service_role + ADMIN_PASSWORD），送空 rows ＝整表清空結果欄。
const clearing = ref(false)
const clearMsg = ref('')
async function clearResult() {
  if (!window.confirm('清除所有住戶的配位結果（車位編號/類型/狀態/簽約期限）？住戶/車輛資料保留。')) return
  clearing.value = true
  clearMsg.value = ''
  try {
    await publishResult({ rows: [], ...adminAuth() })
    clearMsg.value = '✓ 已清除配位結果（vehicle 結果欄全部清空，住戶登入將看不到車位）'
  } catch (e) {
    clearMsg.value = e?.message || '清除失敗'
  } finally {
    clearing.value = false
  }
}

// ── 匯入真實名冊 CSV → 共用 store（供 /allocate 抽籤）─────────────
const importErr = ref('')
const importOk = ref('')
function onRosterFile(e) {
  const file = e.target.files?.[0]
  if (!file) return
  importErr.value = ''
  importOk.value = ''
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const { entries, invalid, conflicts } = buildRoster(parseCSVObjects(reader.result))
      if (!entries.length) {
        importErr.value = 'CSV 沒有有效登記列（檢查表頭欄位）'
        return
      }
      const hh = new Set(entries.map((r) => r.戶號)).size
      const maxCars = entries.reduce((m, r) => Math.max(m, Number(r.第幾輛) || 1), 0) // 一戶最多幾輛 → 抽幾輪
      const hasAccessible = entries.some((r) => r.身障 === 'Y' && Number(r.第幾輛) === 1) // 身障第1輛 → 另有無障礙輪
      const info = `${file.name} · ${hh} 戶 / ${entries.length} 輛 · 最多 ${maxCars} 輛/戶 → ${maxCars} 輪${hasAccessible ? '（另有無障礙輪）' : ''}`
      setImportedRoster(entries, info)
      const extra = invalid.length || conflicts.length ? `；無效 ${invalid.length}、衝突 ${conflicts.length}` : ''
      importOk.value = `✓ 已載入 ${info}${extra}`
    } catch (err) {
      importErr.value = '匯入失敗：' + (err?.message || 'CSV 格式錯誤')
    }
  }
  reader.readAsText(file)
}
function clearRoster() {
  clearImportedRoster()
  importOk.value = ''
  importErr.value = ''
}

// ── 分發 demo（純記憶體，不寫 DB）──────────────────────────────
const demoSummary = ref(null)
const demoRows = ref([])
function runDemo() {
  const rows = toRows(makeMockHouseholds({ count: 20 }))
  const r = distribute({ registrations: rows, seed: 'mock-demo' })
  demoSummary.value = r.summary
  demoRows.value = resultRows(r, { 公告日: '2026-12-01' })
}
</script>

<template>
  <section class="mx-auto max-w-3xl space-y-6">
    <div class="rounded-lg border-2 border-dashed border-amber-400 bg-amber-50 p-4">
      <h1 class="text-2xl font-bold text-amber-900">🛠 進階作業（管理員）</h1>
      <p class="mt-1 text-sm text-amber-800">
        限管理員。<b>抽籤日</b>用「④ 匯入真實名冊」→ 配位頁抽籤；「②½ 清除配位結果」可撤回發佈重做。
        <span v-if="isDev">灌 mock／清除測試／demo 僅開發模式顯示（mock 戶段一律 <b>9xx</b>，清除只刪 9xx）。</span>
      </p>
    </div>

    <!-- 1. 灌 mock（僅開發模式）-->
    <div v-if="isDev" class="rounded-lg border border-slate-200 bg-white p-4">
      <h2 class="font-semibold">① 灌 20 筆 mock 進 Supabase</h2>
      <p class="mt-1 text-sm text-slate-500">含單/多車、一般/重機、身障、志願小位；志願有少選/未填/多選。寫入 household+vehicle，並存車位志願。</p>
      <button
        class="mt-3 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        :disabled="seeding"
        @click="seed"
      >
        {{ seeding ? '灌入中…' : '灌入 20 筆 mock' }}
      </button>
      <div v-if="seedLog.length" class="mt-3 max-h-60 overflow-auto rounded border border-slate-100 text-xs">
        <div
          v-for="l in seedLog"
          :key="l.id"
          class="flex gap-2 border-b border-slate-50 px-2 py-1"
          :class="l.ok ? 'text-emerald-700' : 'text-rose-600'"
        >
          <span class="font-mono w-16 flex-none">{{ l.id }}</span><span>{{ l.msg }}</span>
        </div>
      </div>
      <p v-if="seedDone" class="mt-2 text-sm text-slate-600">
        完成：{{ seedLog.filter((l) => l.ok).length }} 成功 / {{ seedLog.filter((l) => !l.ok).length }} 失敗（已存在會失敗，正常）
      </p>
    </div>

    <!-- 2. 清除測試資料（僅開發模式）-->
    <div v-if="isDev" class="rounded-lg border border-slate-200 bg-white p-4">
      <h2 class="font-semibold">② 清除測試資料</h2>
      <p class="mt-1 text-sm text-slate-500">RLS 禁止前端刪除 → 複製下列 SQL，貼到 Supabase Dashboard → SQL Editor 執行（cascade 連車輛一起刪）。</p>
      <div class="mt-2 flex items-center gap-2">
        <code class="flex-1 rounded bg-slate-900 px-3 py-2 text-xs text-slate-100">{{ WIPE_SQL }}</code>
        <button class="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100" @click="copyWipe">
          {{ copied ? '✓ 已複製' : '複製' }}
        </button>
      </div>
    </div>

    <!-- 2.5 清除配位結果 -->
    <div class="rounded-lg border border-slate-200 bg-white p-4">
      <h2 class="font-semibold">②½ 清除配位結果（保留住戶資料）</h2>
      <p class="mt-1 text-sm text-slate-500">
        只清 <code>vehicle</code> 的車位編號／類型／配位狀態／簽約期限（＝撤回發佈）；住戶與車輛保留。
        走 <code>publish-result</code>（service_role），免貼 SQL。
      </p>
      <button
        class="mt-3 rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
        :disabled="clearing"
        @click="clearResult"
      >
        {{ clearing ? '清除中…' : '清除配位結果' }}
      </button>
      <p v-if="clearMsg" class="mt-2 text-sm" :class="clearMsg.startsWith('✓') ? 'text-emerald-600' : 'text-rose-600'">{{ clearMsg }}</p>
    </div>

    <!-- 4. 匯入真實名冊 → 配位抽籤 -->
    <div class="rounded-lg border-2 border-emerald-300 bg-white p-4">
      <h2 class="font-semibold text-emerald-900">④ 匯入真實名冊 CSV（抽籤日用）</h2>
      <p class="mt-1 text-sm text-slate-500">
        由 <code>scripts/export-roster.mjs</code> 從 Supabase 匯出的全戶名冊（個資）。匯入後到「配位」頁用大螢幕現場抽籤。
        <b>只存本機 session、不上傳、不外流。</b>
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        class="mt-2 block w-full text-sm text-slate-600 file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-emerald-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-emerald-700"
        @change="onRosterFile"
      />
      <p v-if="importOk" class="mt-2 rounded bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">{{ importOk }}</p>
      <p v-if="importErr" class="mt-1 text-sm text-rose-600">{{ importErr }}</p>
      <div v-if="importOk" class="mt-3 flex flex-wrap gap-2">
        <RouterLink to="/allocate" class="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">→ 去配位抽籤</RouterLink>
        <button class="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100" @click="clearRoster">清除匯入（回範例）</button>
      </div>
    </div>

    <!-- 3. 分發 demo（僅開發模式）-->
    <div v-if="isDev" class="rounded-lg border border-slate-200 bg-white p-4">
      <h2 class="font-semibold">③ 跑分發 demo（記憶體、不寫 DB）</h2>
      <p class="mt-1 text-sm text-slate-500">把 mock 餵真 <code>distribute()</code> 引擎，看配位結果（含應繳/狀態/簽約期限）。</p>
      <button class="mt-3 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700" @click="runDemo">
        跑分發 demo
      </button>

      <div v-if="demoSummary" class="mt-3 text-sm">
        <div class="text-slate-600">
          登記 {{ demoSummary.registrations }} · 分配 <b class="text-emerald-700">{{ demoSummary.assigned }}</b> · 落選 <b class="text-rose-600">{{ demoSummary.落選 }}</b> · 剩餘車位 {{ demoSummary.remaining }}
        </div>
        <div class="mt-2 overflow-hidden rounded-lg border border-slate-200">
          <table class="w-full text-xs">
            <thead class="bg-slate-50 text-slate-500">
              <tr>
                <th class="px-2 py-1.5 text-left">戶號</th>
                <th class="px-2 py-1.5 text-left">車號</th>
                <th class="px-2 py-1.5 text-left">車位</th>
                <th class="px-2 py-1.5 text-left">類型</th>
                <th class="px-2 py-1.5 text-left">應繳</th>
                <th class="px-2 py-1.5 text-left">狀態</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in demoRows" :key="i" class="border-t border-slate-100">
                <td class="px-2 py-1 font-mono">{{ r.戶號 }}</td>
                <td class="px-2 py-1 font-mono">{{ r.車號 }}</td>
                <td class="px-2 py-1">{{ r.車位編號 || '—' }}</td>
                <td class="px-2 py-1">{{ r.車位類型 || '—' }}</td>
                <td class="px-2 py-1">{{ r.應繳金額 || '—' }}</td>
                <td class="px-2 py-1" :class="r.狀態 === '分配' ? 'text-emerald-700' : 'text-rose-600'">{{ r.狀態 }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </section>
</template>
