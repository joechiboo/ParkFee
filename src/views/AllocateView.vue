<script setup>
import { ref } from 'vue'
import { distribute } from '../lottery/distribute.js'
import { rentableMotorSeats } from '../map/seats.js'
import { buildRoster } from '../data/registry.js'
import { sampleRoster } from '../data/sample.js'

// ── 資料：示範用 20 戶樣本（正式版改接 Supabase 全名冊 → buildRoster → distribute）──
const seats = rentableMotorSeats()
const SAMPLE_N = 20
// 志願競爭池：限縮到一小區，讓 20 戶志願重疊 → 抽籤/重抽結果有差異、能看到落選。
const wishPool = seats
  .filter((s) => s.type === '大' || s.type === '小')
  .map((s) => String(s.id))
  .slice(0, 28)

function buildSampleRegs() {
  const { entries } = buildRoster(sampleRoster(SAMPLE_N))
  const byHouse = new Map()
  let k = 0
  for (const e of entries) {
    if (!byHouse.has(e.戶號)) {
      const w = []
      for (let j = 0; j < 6; j++) w.push(wishPool[(k * 7 + j * 11) % wishPool.length])
      byHouse.set(e.戶號, [...new Set(w)])
      k++
    }
  }
  return entries.map((e) => ({ ...e, 車位志願: byHouse.get(e.戶號) }))
}
const registrations = buildSampleRegs()
const houseCount = new Set(registrations.map((r) => r.戶號)).size

// ── 抽籤狀態 ──
const seed = ref('2026樂菲莊園機車車位抽籤')
const result = ref(null)
const history = ref([])

function run() {
  const r = distribute({
    registrations,
    seats,
    seed: seed.value || 'parkfee',
    runAt: new Date().toISOString(),
  })
  result.value = r
  history.value.unshift({
    seed: r.seed,
    seedHash: r.seedHash,
    runAt: r.runAt,
    assigned: r.summary.assigned,
    lost: r.summary.落選,
  })
}
function redraw() {
  // 重抽＝換新種子重跑（結果不同、仍可重現）。監察用：歷次種子/時間都留存於下方紀錄。
  seed.value = '重抽-' + new Date().toISOString().slice(0, 19).replace('T', ' ')
  run()
}

const fmtTime = (iso) => (iso ? iso.slice(0, 19).replace('T', ' ') : '')
</script>

<template>
  <section class="mx-auto max-w-5xl">
    <h1 class="text-2xl font-bold">抽籤配位</h1>
    <p class="mt-1 text-sm text-slate-500">
      電腦以固定種子抽「順序號」→ 依各戶車位志願序統一分發（同種子可重現、供監察）。
      <span class="text-amber-700">示範資料：{{ houseCount }} 戶樣本（正式版接 Supabase 全名冊）。</span>
    </p>

    <!-- 控制列 -->
    <div class="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <label class="block grow">
        <span class="text-sm font-medium text-slate-700">亂數種子（公開、可重現）</span>
        <input
          v-model="seed"
          type="text"
          class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
      </label>
      <button class="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700" @click="run">
        執行抽籤
      </button>
      <button
        class="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        :disabled="!result"
        @click="redraw"
      >
        🎲 重抽（新種子）
      </button>
    </div>

    <div v-if="result" class="mt-5 space-y-5">
      <!-- 摘要 -->
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="rounded-lg border border-slate-200 bg-white p-3">
          <div class="text-xs text-slate-500">登記</div>
          <div class="text-xl font-semibold">{{ result.summary.registrations }}</div>
        </div>
        <div class="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <div class="text-xs text-emerald-700">已配位</div>
          <div class="text-xl font-semibold text-emerald-800">{{ result.summary.assigned }}</div>
        </div>
        <div class="rounded-lg border border-rose-200 bg-rose-50 p-3">
          <div class="text-xs text-rose-700">落選（待物業補位/候補）</div>
          <div class="text-xl font-semibold text-rose-800">{{ result.summary.落選 }}</div>
        </div>
        <div class="rounded-lg border border-slate-200 bg-white p-3">
          <div class="text-xs text-slate-500">剩餘車位</div>
          <div class="text-xl font-semibold">{{ result.summary.remaining }}</div>
        </div>
      </div>

      <!-- 稽核資訊 -->
      <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        種子 <b class="font-mono">{{ result.seed }}</b> · hash <span class="font-mono">{{ result.seedHash }}</span>
        · 執行時間 {{ fmtTime(result.runAt) }} · 同種子重跑結果一致（可驗算）
      </div>

      <!-- 配位結果 -->
      <div>
        <div class="mb-2 text-sm font-medium text-slate-700">配位結果（{{ result.assigned.length }}）</div>
        <div class="overflow-x-auto rounded-lg border border-slate-200">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-slate-500">
              <tr>
                <th class="px-3 py-2 text-left font-medium">戶號</th>
                <th class="px-3 py-2 text-left font-medium">車號</th>
                <th class="px-3 py-2 text-left font-medium">車種</th>
                <th class="px-3 py-2 text-left font-medium">第幾輛</th>
                <th class="px-3 py-2 text-left font-medium">車位</th>
                <th class="px-3 py-2 text-left font-medium">類型</th>
                <th class="px-3 py-2 text-left font-medium">方式</th>
                <th class="px-3 py-2 text-left font-medium">順序號</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(a, i) in result.assigned" :key="i" class="border-t border-slate-100">
                <td class="px-3 py-1.5">{{ a.戶號 }}</td>
                <td class="px-3 py-1.5 font-mono text-xs">{{ a.車號 }}</td>
                <td class="px-3 py-1.5">{{ a.車種 }}</td>
                <td class="px-3 py-1.5">{{ a.第幾輛 }}</td>
                <td class="px-3 py-1.5 font-mono">{{ a.車位編號 }}</td>
                <td class="px-3 py-1.5">{{ a.車位類型 }}</td>
                <td class="px-3 py-1.5">{{ a.配位方式 }}</td>
                <td class="px-3 py-1.5">{{ a.順序號 ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 落選名單 -->
      <div v-if="result.落選.length">
        <div class="mb-2 text-sm font-medium text-rose-700">落選名單（{{ result.落選.length }}）— 交物業第二階段（保底/候補）</div>
        <div class="overflow-x-auto rounded-lg border border-rose-200">
          <table class="w-full text-sm">
            <thead class="bg-rose-50 text-rose-700">
              <tr>
                <th class="px-3 py-2 text-left font-medium">戶號</th>
                <th class="px-3 py-2 text-left font-medium">車號</th>
                <th class="px-3 py-2 text-left font-medium">第幾輛</th>
                <th class="px-3 py-2 text-left font-medium">輪次</th>
                <th class="px-3 py-2 text-left font-medium">原因</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(l, i) in result.落選" :key="i" class="border-t border-rose-100">
                <td class="px-3 py-1.5">{{ l.戶號 }}</td>
                <td class="px-3 py-1.5 font-mono text-xs">{{ l.車號 }}</td>
                <td class="px-3 py-1.5">{{ l.第幾輛 }}</td>
                <td class="px-3 py-1.5">{{ l.輪次 }}</td>
                <td class="px-3 py-1.5">{{ l.原因 }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 各輪抽出序（監察可展開） -->
      <details class="rounded-lg border border-slate-200 bg-white p-3">
        <summary class="cursor-pointer text-sm font-medium text-slate-700">各輪抽出序與過程 log（監察）</summary>
        <div class="mt-3 space-y-3">
          <div v-for="r in result.rounds" :key="r.round">
            <div class="text-sm font-semibold text-slate-700">Round {{ r.round }} · {{ r.name }}</div>
            <div v-if="r.draws.length" class="mt-1 flex flex-wrap gap-1.5">
              <span
                v-for="(d, i) in r.draws"
                :key="i"
                class="rounded px-2 py-0.5 text-xs"
                :class="d.中籤 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'"
              >#{{ d.順序號 }} {{ d.戶號 }}{{ d.中籤 ? '✓' : '✗' }}</span>
            </div>
            <div v-else class="mt-1 text-xs text-slate-400">（此輪免抽 / 無抽籤）</div>
          </div>
          <pre class="mt-2 whitespace-pre-wrap rounded bg-slate-900 p-3 text-xs text-slate-200">{{ result.log.join('\n') }}</pre>
        </div>
      </details>

      <!-- 抽籤紀錄（含重抽歷程） -->
      <details v-if="history.length > 1" class="rounded-lg border border-slate-200 bg-white p-3">
        <summary class="cursor-pointer text-sm font-medium text-slate-700">抽籤紀錄（{{ history.length }} 次，含重抽）</summary>
        <ul class="mt-2 space-y-1 text-xs text-slate-600">
          <li v-for="(h, i) in history" :key="i" class="font-mono">
            {{ fmtTime(h.runAt) }} · 種子「{{ h.seed }}」· 配 {{ h.assigned }} / 落選 {{ h.lost }}
            <span v-if="i === 0" class="text-emerald-600">← 目前</span>
          </li>
        </ul>
      </details>
    </div>

    <p v-else class="mt-6 text-sm text-slate-400">設定種子後按「執行抽籤」。重抽會換新種子重跑，歷次種子與時間都會記錄供監察。</p>
  </section>
</template>
