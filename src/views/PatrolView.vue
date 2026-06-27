<script setup>
// 巡邏稽核（物業）：掃／輸入「車牌」→ 顯示該車「應停哪個車位」+ 戶/繳費 → 巡邏員用眼睛核對車是否停對位。
// 不掃車位號（地面號碼肉眼讀即可）。查無車牌＝未登記/未配位 → 可能違停。
// 參考表（車號→車位）巡邏前載一次，之後純本地查、可離線。
import { ref, computed, onMounted } from 'vue'
import { sessionHousehold } from '../store/session.js'
import { isAdmin, ADMIN_PASSWORD } from '../store/roles.js'
import { listAssignments } from '../store/locked.js'
import { normalizeTWPlate } from '../data/plate.js'
import CamScanner from '../components/CamScanner.vue'

const admin = computed(() => isAdmin(sessionHousehold.value))
const scanning = ref(false)
function onRecognized({ value }) {
  plate.value = value
  lookup()
}

// ── 參考表（巡邏前載一次）：車號 → { 車位[], 戶號, 車種, 已繳費 } ──
const refLoaded = ref(false)
const loadingRef = ref(false)
const refErr = ref('')
const byPlate = ref(new Map())
const refCount = computed(() => byPlate.value.size)

async function loadRef() {
  loadingRef.value = true
  refErr.value = ''
  try {
    const list = await listAssignments(ADMIN_PASSWORD)
    const p = new Map()
    for (const a of list) {
      if (!a.車號) continue
      const k = normalizeTWPlate(a.車號) // 與 OCR/手動查詢同一正規化 → 對得上(含補連字號)
      if (!p.has(k)) p.set(k, { 車位: [], 戶號: a.戶號, 車種: a.車種, 已繳費: a.已繳費 })
      p.get(k).車位.push(String(a.車位編號))
    }
    byPlate.value = p
    refLoaded.value = true
  } catch (e) {
    refErr.value = e?.message || '載入參考資料失敗'
  } finally {
    loadingRef.value = false
  }
}
onMounted(() => {
  if (admin.value) loadRef()
})

// ── 查一台車 ──
const plate = ref('')
const result = ref(null)
const log = ref([])
const checked = computed(() => log.value.length)
const unknownCount = computed(() => log.value.filter((r) => r.tone === 'red').length)

function lookup() {
  const pl = normalizeTWPlate(plate.value)
  if (!pl) return
  const info = byPlate.value.get(pl)
  const time = new Date().toTimeString().slice(0, 8)
  let r
  if (info) {
    const paid = info.已繳費 ? '✓已繳' : '未繳'
    r = {
      tone: 'blue',
      plate: pl,
      seat: info.車位.join('、'),
      text: `🅿️ 應停 ${info.車位.join('、')}　戶 ${info.戶號}　${info.車種 || ''} ${paid} — 請確認車是否停此位`,
      time,
    }
  } else {
    r = { tone: 'red', plate: pl, seat: '', text: `查無車牌 ${pl}：未登記/未配位 → 可能違停`, time }
  }
  result.value = r
  log.value.unshift(r)
  plate.value = ''
}
function clearLog() {
  log.value = []
  result.value = null
}

const TONE = {
  blue: 'border-blue-300 bg-blue-50 text-blue-800',
  red: 'border-rose-300 bg-rose-50 text-rose-800',
}
</script>

<template>
  <section class="mx-auto max-w-xl">
    <div class="flex items-baseline justify-between">
      <h1 class="text-2xl font-bold">巡邏稽核</h1>
      <RouterLink to="/me" class="text-sm text-slate-500 hover:underline">← 回我的登記</RouterLink>
    </div>

    <!-- 非管理員 -->
    <div v-if="!admin" class="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
      需<b>管理員</b>權限。請以管理員帳號<RouterLink to="/me" class="underline">登入</RouterLink>。
    </div>

    <template v-else>
      <p class="mt-1 text-sm text-slate-500">
        掃（或輸入）<b>車牌</b> → 顯示該車<b>應停的車位</b> → 你<b>用眼睛核對</b>車是否真的停在那一格。
        車位號看地面即可、不必掃。
      </p>

      <!-- 參考表狀態 -->
      <div class="mt-3 flex items-center gap-2 text-xs text-slate-500">
        <span v-if="loadingRef">載入參考資料中…</span>
        <template v-else-if="refLoaded">
          ✓ 已載入 <b class="text-slate-700">{{ refCount }}</b> 台已配位車輛（可離線）
          <button class="text-slate-400 hover:underline" @click="loadRef">重新載入</button>
        </template>
        <span v-if="refErr" class="text-rose-600">{{ refErr }}</span>
      </div>

      <!-- 查詢輸入 -->
      <div class="mt-3 rounded-lg border border-slate-200 bg-white p-4">
        <label class="block text-xs font-medium text-slate-600">車牌（掃描或手動輸入）</label>
        <div class="mt-1 flex gap-2">
          <input
            v-model="plate"
            placeholder="例 ABC-1234"
            class="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 font-mono text-sm uppercase focus:border-slate-500 focus:outline-none"
            @keyup.enter="lookup"
          />
          <button
            class="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            :disabled="!plate || !refLoaded"
            @click="lookup"
          >
            查詢
          </button>
          <button
            class="rounded border border-emerald-500 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
            @click="scanning = true"
          >
            📷
          </button>
        </div>
      </div>

      <CamScanner v-if="scanning" :feedback="result" @recognized="onRecognized" @close="scanning = false" />

      <!-- 結果 -->
      <div v-if="result" class="mt-3 rounded-lg border-2 p-4" :class="TONE[result.tone]">
        <div class="text-xs opacity-70">車牌 {{ result.plate }}</div>
        <p class="mt-0.5 text-base font-bold">{{ result.text }}</p>
      </div>

      <!-- 本次巡查記錄 -->
      <div v-if="checked" class="mt-4">
        <div class="flex items-center justify-between">
          <div class="text-sm font-medium text-slate-700">
            本次查 {{ checked }} 台 · 查無/可能違停 <b class="text-rose-600">{{ unknownCount }}</b>
          </div>
          <button class="text-xs text-slate-500 hover:underline" @click="clearLog">清空記錄</button>
        </div>
        <ul class="mt-2 space-y-1">
          <li
            v-for="(r, i) in log"
            :key="i"
            class="flex items-start gap-2 rounded px-2 py-1 text-xs"
            :class="r.tone === 'red' ? 'bg-rose-50' : 'bg-slate-50'"
          >
            <span class="font-mono font-semibold">{{ r.plate }}</span>
            <span class="flex-1 text-slate-600">{{ r.seat ? '應停 ' + r.seat : '查無 / 未配位' }}</span>
            <span class="flex-none text-slate-400">{{ r.time }}</span>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>
