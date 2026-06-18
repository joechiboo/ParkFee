<script setup>
// 🛠 工程師專區（dev-only）。路由只在 import.meta.env.DEV 註冊，正式 build 不會有這頁。
import { ref } from 'vue'
import { makeMockHouseholds, toRows, WIPE_SQL } from '../dev/mock.js'
import { register, saveWishes, RegistrationError } from '../store/db.js'
import { distribute } from '../lottery/distribute.js'
import { resultRows } from '../export/result.js'

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
      <h1 class="text-2xl font-bold text-amber-900">🛠 工程師專區</h1>
      <p class="mt-1 text-sm text-amber-800">
        僅開發模式可見（<code>import.meta.env.DEV</code>），正式部署不含此頁。
        mock 戶號**跨棟 A–H/S**、戶段一律 <b>9xx</b>（901+），清除只刪「戶段 9xx」這批。
      </p>
    </div>

    <!-- 1. 灌 mock -->
    <div class="rounded-lg border border-slate-200 bg-white p-4">
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

    <!-- 2. 清除 -->
    <div class="rounded-lg border border-slate-200 bg-white p-4">
      <h2 class="font-semibold">② 清除測試資料</h2>
      <p class="mt-1 text-sm text-slate-500">RLS 禁止前端刪除 → 複製下列 SQL，貼到 Supabase Dashboard → SQL Editor 執行（cascade 連車輛一起刪）。</p>
      <div class="mt-2 flex items-center gap-2">
        <code class="flex-1 rounded bg-slate-900 px-3 py-2 text-xs text-slate-100">{{ WIPE_SQL }}</code>
        <button class="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100" @click="copyWipe">
          {{ copied ? '✓ 已複製' : '複製' }}
        </button>
      </div>
    </div>

    <!-- 3. 分發 demo -->
    <div class="rounded-lg border border-slate-200 bg-white p-4">
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
