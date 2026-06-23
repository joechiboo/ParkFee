<script setup>
import { ref, computed, onMounted } from 'vue'
import { distribute, VIA } from '../lottery/distribute.js'
import { rentableMotorSeats } from '../map/seats.js'
import { buildRoster } from '../data/registry.js'
import { parseCSVObjects } from '../data/csv.js'
import { resultCSV } from '../export/result.js'
import { sampleRoster } from '../data/sample.js'
import { lockedSeats, refreshLocked } from '../store/locked.js'

// ── 資料：示範用 20 戶樣本（正式版改接 Supabase 全名冊 → buildRoster → distribute）──
const seats = rentableMotorSeats() // 全可承租；抽籤時再扣掉鎖定（lockedSeats，物業維護頁設定）
onMounted(refreshLocked) // 載入雲端最新鎖定
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
const registrations = ref(buildSampleRegs())
const source = ref(`${SAMPLE_N} 戶樣本`)
const houseCount = computed(() => new Set(registrations.value.map((r) => r.戶號)).size)
const importErr = ref('')
const importOk = ref('')

// 匯入名冊 CSV（由 scripts/export-roster.mjs 從 Supabase 匯出）→ buildRoster → 取代樣本。
function onFile(e) {
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
      registrations.value = entries
      const hh = new Set(entries.map((r) => r.戶號)).size
      source.value = `匯入 ${file.name}`
      const extra = invalid.length || conflicts.length ? `（無效 ${invalid.length}、衝突 ${conflicts.length} 已處理）` : ''
      importOk.value = `✓ 已匯入 ${hh} 戶 / ${entries.length} 筆車輛${extra}，可按下方「執行抽籤」`
      result.value = null
      history.value = []
    } catch (err) {
      importErr.value = '匯入失敗：' + (err?.message || 'CSV 格式錯誤')
    }
  }
  reader.readAsText(file)
}

// ── 抽籤狀態 ──
const seed = ref('2027樂菲莊園機車車位抽籤')
const result = ref(null)
const history = ref([])

function run() {
  const r = distribute({
    registrations: registrations.value,
    seats: seats.filter((s) => !lockedSeats.value.has(String(s.id))), // 扣掉鎖定車位
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

// 配位結果分兩組：
//   抽籤分發＝真的抽順序號的（一般/重機），依輪次→順序號排序 = 主結果。
//   免抽已定＝志願小位 / 無障礙（登記時已選位繳費、抽籤前確定），另列、不混入。
const lotteryRows = computed(() =>
  (result.value?.assigned ?? [])
    .filter((a) => a.配位方式 === VIA.WISH)
    .sort((x, y) => x.輪次 - y.輪次 || (x.順序號 ?? 0) - (y.順序號 ?? 0)),
)
const presetRows = computed(() =>
  (result.value?.assigned ?? []).filter(
    (a) => a.配位方式 === VIA.VOLUNTEER_SMALL || a.配位方式 === VIA.ACCESSIBLE,
  ),
)

// 下載配位結果 CSV（公告日 → 簽約期限=公告+5；加 BOM 供 Excel 中文正確）。
const announceDate = ref('')
function downloadResultCSV() {
  if (!result.value) return
  const csv = '﻿' + resultCSV(result.value, { 公告日: announceDate.value })
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `配位結果-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <section class="mx-auto max-w-5xl">
    <h1 class="text-2xl font-bold">抽籤配位</h1>
    <p class="mt-1 text-sm text-slate-500">
      電腦以固定種子抽「順序號」→ 依各戶車位志願序統一分發（同種子可重現、供監察）。
      名冊來源：<b>{{ source }}</b>（{{ houseCount }} 戶）。
    </p>

    <!-- 配位規則說明（可摺疊） -->
    <details open class="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <summary class="cursor-pointer font-medium text-slate-700">配位規則說明（填志願 + 統一分發）· 點箭頭收合</summary>
      <div class="mt-2 space-y-1.5 text-slate-600">
        <p>採「<b>填志願 + 統一分發</b>」（非隨機抽號碼）：電腦以固定種子抽<b>順序號</b>，依序號由小到大逐戶，分到「該戶志願中、目前仍剩的<b>最高志願</b>」。</p>
        <ul class="ml-4 list-disc space-y-1">
          <li><b>Round 0 無障礙</b>：身障第 1 輛優先；登記 &gt; 名額則抽，未中併入下一輪。</li>
          <li><b>Round 1 一戶一位</b>：志願小位者免抽、依登記序選小位；其餘第 1 輛抽順序號、依志願分發 → <b>保障每戶第 1 輛一位</b>。</li>
          <li><b>Round 2＋ 第二輛起</b>：用前輪剩餘車位依序取志願；耗盡則落選。</li>
        </ul>
        <p><b>重機</b>佔雙大位（機車位足額才配）。<b>志願全落空者</b>列「落選名單」→ 交物業第二階段（勾保底→就近補、未勾→候補），不在引擎內。</p>
        <p class="text-slate-500">固定種子 → 結果可重現；種子／時間／各輪過程全留存供監察。重抽＝換新種子重跑，歷次紀錄保留。</p>
      </div>
    </details>

    <!-- 匯入名冊 -->
    <div class="mt-4 rounded-lg border border-slate-200 bg-white p-4">
      <label class="text-sm font-medium text-slate-700">匯入名冊 CSV</label>
      <input
        type="file"
        accept=".csv,text/csv"
        class="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700"
        @change="onFile"
      />
      <p class="mt-1 text-xs text-slate-500">
        由 <code>scripts/export-roster.mjs</code> 從 Supabase 匯出；未匯入則用樣本示範。
      </p>
      <p v-if="importOk" class="mt-2 rounded bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">{{ importOk }}</p>
      <p v-if="importErr" class="mt-1 text-sm text-rose-600">{{ importErr }}</p>
    </div>

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

      <!-- 下載結果 CSV（含應繳/狀態/簽約期限） -->
      <div class="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <label class="block">
          <span class="text-sm font-medium text-slate-700">公告日（→ 簽約期限＝公告+5）</span>
          <input
            v-model="announceDate"
            type="date"
            class="mt-1 rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </label>
        <button
          class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          @click="downloadResultCSV"
        >
          ⬇ 下載配位結果 CSV
        </button>
        <span class="text-xs text-slate-500">含分配＋未中、應繳金額、狀態、簽約期限；交住戶/存檔/公告用。</span>
      </div>

      <!-- 配位結果（抽籤分發，依順序號排序） -->
      <div>
        <div class="mb-2 text-sm font-medium text-slate-700">配位結果 · 抽籤分發（{{ lotteryRows.length }}）— 依輪次／順序號</div>
        <div class="overflow-x-auto rounded-lg border border-slate-200">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-slate-500">
              <tr>
                <th class="px-3 py-2 text-left font-medium">順序號</th>
                <th class="px-3 py-2 text-left font-medium">輪次</th>
                <th class="px-3 py-2 text-left font-medium">戶號</th>
                <th class="px-3 py-2 text-left font-medium">車號</th>
                <th class="px-3 py-2 text-left font-medium">車種</th>
                <th class="px-3 py-2 text-left font-medium">第幾輛</th>
                <th class="px-3 py-2 text-left font-medium">車位</th>
                <th class="px-3 py-2 text-left font-medium">類型</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(a, i) in lotteryRows" :key="i" class="border-t border-slate-100">
                <td class="px-3 py-1.5 font-semibold">{{ a.順序號 ?? '—' }}</td>
                <td class="px-3 py-1.5">{{ a.輪次 }}</td>
                <td class="px-3 py-1.5">{{ a.戶號 }}</td>
                <td class="px-3 py-1.5 font-mono text-xs">{{ a.車號 }}</td>
                <td class="px-3 py-1.5">{{ a.車種 }}</td>
                <td class="px-3 py-1.5">{{ a.第幾輛 }}</td>
                <td class="px-3 py-1.5 font-mono">{{ a.車位編號 }}</td>
                <td class="px-3 py-1.5">{{ a.車位類型 }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 免抽已定：志願小位 / 無障礙（抽籤前確定、不參與抽籤） -->
      <details v-if="presetRows.length" class="rounded-lg border border-slate-200 bg-white p-3">
        <summary class="cursor-pointer text-sm font-medium text-slate-700">
          免抽已定（{{ presetRows.length }}）— 志願小位／無障礙，登記時已選位繳費、不參與抽籤
        </summary>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-slate-500">
              <tr>
                <th class="px-3 py-2 text-left font-medium">戶號</th>
                <th class="px-3 py-2 text-left font-medium">車號</th>
                <th class="px-3 py-2 text-left font-medium">車位</th>
                <th class="px-3 py-2 text-left font-medium">類型</th>
                <th class="px-3 py-2 text-left font-medium">方式</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(a, i) in presetRows" :key="i" class="border-t border-slate-100">
                <td class="px-3 py-1.5">{{ a.戶號 }}</td>
                <td class="px-3 py-1.5 font-mono text-xs">{{ a.車號 }}</td>
                <td class="px-3 py-1.5 font-mono">{{ a.車位編號 }}</td>
                <td class="px-3 py-1.5">{{ a.車位類型 }}</td>
                <td class="px-3 py-1.5">{{ a.配位方式 }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      <!-- 落選名單 -->
      <div v-if="result.落選.length">
        <div class="mb-2 text-sm font-medium text-rose-700">落選名單（{{ result.落選.length }}）— 交物業第二階段（保底/候補）</div>
        <div class="overflow-x-auto rounded-lg border border-rose-200">
          <table class="w-full text-sm">
            <thead class="bg-rose-50 text-rose-700">
              <tr>
                <th class="px-3 py-2 text-left font-medium">順序號</th>
                <th class="px-3 py-2 text-left font-medium">輪次</th>
                <th class="px-3 py-2 text-left font-medium">戶號</th>
                <th class="px-3 py-2 text-left font-medium">車號</th>
                <th class="px-3 py-2 text-left font-medium">第幾輛</th>
                <th class="px-3 py-2 text-left font-medium">原因</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(l, i) in result.落選" :key="i" class="border-t border-rose-100">
                <td class="px-3 py-1.5 font-semibold">{{ l.順序號 ?? '免抽' }}</td>
                <td class="px-3 py-1.5">{{ l.輪次 }}</td>
                <td class="px-3 py-1.5">{{ l.戶號 }}</td>
                <td class="px-3 py-1.5 font-mono text-xs">{{ l.車號 }}</td>
                <td class="px-3 py-1.5">{{ l.第幾輛 }}</td>
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
