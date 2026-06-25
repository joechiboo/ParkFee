<script setup>
// 巡邏稽核（物業）：核對「車位 ↔ 實際停放車號」是否相符 → 抓佔位/停錯/未登記車。
// v1：手動輸入車位＋車號（即時 OCR 之後疊上、填同一組欄位）。比對用現成指派資料（assign-seat op:list）。
// 巡邏前載入一次參考表 → 之後純本地比對（地下室可離線）。
import { ref, computed, onMounted } from 'vue'
import { sessionHousehold } from '../store/session.js'
import { isAdmin, ADMIN_PASSWORD } from '../store/roles.js'
import { listAssignments } from '../store/locked.js'
import { normalizeTWPlate } from '../data/plate.js'
import CamScanner from '../components/CamScanner.vue'

const admin = computed(() => isAdmin(sessionHousehold.value))

// 即時相機辨識：辨到的值自動填入對應欄位（車位號/車牌）。
const scanning = ref(false)
function onRecognized({ type, value }) {
  if (type === 'seat') seat.value = value
  else plate.value = value
  if (seat.value && plate.value) check() // 兩格都有 → 自動檢查（結果由 CamScanner 浮層顯示）
}

// ── 參考表（巡邏前載入一次，之後純本地比對）─────────────────────
const refLoaded = ref(false)
const loadingRef = ref(false)
const refErr = ref('')
const bySeat = ref(new Map()) // 車位編號 → { 戶號, 車號 }
const byPlate = ref(new Map()) // 車號 → [車位…]（重機佔兩位）
const refCount = computed(() => bySeat.value.size)

async function loadRef() {
  loadingRef.value = true
  refErr.value = ''
  try {
    const list = await listAssignments(ADMIN_PASSWORD)
    const s = new Map()
    const p = new Map()
    for (const a of list) {
      s.set(String(a.車位編號), a)
      const pl = a.車號 ? String(a.車號).toUpperCase() : ''
      if (pl) {
        if (!p.has(pl)) p.set(pl, [])
        p.get(pl).push(String(a.車位編號))
      }
    }
    bySeat.value = s
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

// ── 巡查一格 ───────────────────────────────────────────────
const seat = ref('') // 車位編號
const plate = ref('') // 實際看到的車號（留空＝回報此格為空）
const result = ref(null)
const log = ref([]) // 本次巡查記錄（最新在上）
const checked = computed(() => log.value.length)
const violations = computed(() => log.value.filter((r) => r.status === 'error').length)

function check() {
  const seatId = String(seat.value).trim()
  if (!seatId) return
  const pl = normalizeTWPlate(plate.value)
  const expected = bySeat.value.get(seatId)
  const expectedPlate = expected?.車號 || ''
  const carSeats = pl ? byPlate.value.get(pl) || [] : []
  const registered = pl ? byPlate.value.has(pl) : false

  let status, message
  if (!pl) {
    if (expectedPlate) {
      status = 'warn'
      message = `此格應停 ${expectedPlate}（${expected.戶號}），回報為空 — 請確認車是否未停`
    } else {
      status = 'ok'
      message = '空位，正常（此格無人承租）'
    }
  } else if (carSeats.includes(seatId)) {
    status = 'ok'
    message = `正確 — ${pl} 停在自己的車位${expected?.戶號 ? `（${expected.戶號}）` : ''}`
  } else if (!registered) {
    status = 'error'
    message = `未登記車 ${pl}${expectedPlate ? `，此格應停 ${expectedPlate}` : '，且此格無人承租'} → 違停`
  } else {
    status = 'error'
    message = `停錯位 — ${pl} 應停 ${carSeats.join('、')}，卻停在 ${seatId}${expectedPlate ? `（此格屬 ${expectedPlate}）` : '（此格應為空位）'}`
  }

  result.value = { seatId, plate: pl, status, message, time: new Date().toTimeString().slice(0, 8) }
  log.value.unshift(result.value)
  plate.value = ''
  seat.value = ''
}
function clearLog() {
  log.value = []
  result.value = null
}

const BANNER = {
  ok: { box: 'border-emerald-300 bg-emerald-50 text-emerald-800', icon: '🟢', label: '正確' },
  error: { box: 'border-rose-300 bg-rose-50 text-rose-800', icon: '🔴', label: '違規' },
  warn: { box: 'border-amber-300 bg-amber-50 text-amber-800', icon: '⚠️', label: '注意' },
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
        輸入<b>車位編號</b>＋現場<b>車號</b> → 核對是否停對位。
        <span class="text-slate-400">（即時 OCR 之後疊上，辨不到/辨錯可手動輸入）</span>
      </p>

      <!-- 參考表狀態 -->
      <div class="mt-3 flex items-center gap-2 text-xs text-slate-500">
        <span v-if="loadingRef">載入參考資料中…</span>
        <template v-else-if="refLoaded">
          ✓ 已載入 <b class="text-slate-700">{{ refCount }}</b> 個已配位車位（巡查可離線）
          <button class="text-slate-400 hover:underline" @click="loadRef">重新載入</button>
        </template>
        <span v-if="refErr" class="text-rose-600">{{ refErr }}</span>
      </div>

      <!-- 巡查輸入 -->
      <div class="mt-3 rounded-lg border border-slate-200 bg-white p-4">
        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-xs font-medium text-slate-600">車位編號</span>
            <input
              v-model="seat"
              inputmode="numeric"
              placeholder="例 150"
              class="mt-1 w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm focus:border-slate-500 focus:outline-none"
              @keyup.enter="check"
            />
          </label>
          <label class="block">
            <span class="text-xs font-medium text-slate-600">現場車號（空＝此格無車）</span>
            <input
              v-model="plate"
              placeholder="例 ABC-1234"
              class="mt-1 w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm uppercase focus:border-slate-500 focus:outline-none"
              @keyup.enter="check"
            />
          </label>
        </div>
        <div class="mt-3 flex gap-2">
          <button
            class="flex-1 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            :disabled="!seat || !refLoaded"
            @click="check"
          >
            檢查
          </button>
          <button
            class="rounded border border-emerald-500 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
            @click="scanning = true"
          >
            📷 即時辨識
          </button>
        </div>
      </div>

      <CamScanner v-if="scanning" :feedback="result" @recognized="onRecognized" @close="scanning = false" />

      <!-- 結果紅綠燈 -->
      <div v-if="result" class="mt-3 rounded-lg border-2 p-4" :class="BANNER[result.status].box">
        <div class="flex items-center gap-2 text-lg font-bold">
          <span class="text-2xl">{{ BANNER[result.status].icon }}</span>
          車位 {{ result.seatId }} · {{ BANNER[result.status].label }}
        </div>
        <p class="mt-1 text-sm">{{ result.message }}</p>
      </div>

      <!-- 本次巡查記錄 -->
      <div v-if="checked" class="mt-4">
        <div class="flex items-center justify-between">
          <div class="text-sm font-medium text-slate-700">
            本次巡查 {{ checked }} 格 · 違規 <b class="text-rose-600">{{ violations }}</b>
          </div>
          <button class="text-xs text-slate-500 hover:underline" @click="clearLog">清空記錄</button>
        </div>
        <ul class="mt-2 space-y-1">
          <li
            v-for="(r, i) in log"
            :key="i"
            class="flex items-start gap-2 rounded px-2 py-1 text-xs"
            :class="r.status === 'error' ? 'bg-rose-50' : r.status === 'warn' ? 'bg-amber-50' : 'bg-slate-50'"
          >
            <span>{{ BANNER[r.status].icon }}</span>
            <span class="font-mono font-semibold">{{ r.seatId }}</span>
            <span class="flex-1 text-slate-600">{{ r.message }}</span>
            <span class="flex-none text-slate-400">{{ r.time }}</span>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>
