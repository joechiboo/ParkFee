<script setup>
// 物業：車位鎖定維護。點地圖上的車位 → 鎖定/解鎖（鎖定者不進抽籤、選位頁不可選）。
// v1：鎖定清單存本機 localStorage（occupied）。Supabase 化＋後端 admin 驗證為下一步。
import { ref, computed, onMounted } from 'vue'
import SeatMap from '../components/SeatMap.vue'
import { motorSeats } from '../map/seats.js'
import { lockedSeats, refreshLocked, setLocked } from '../store/locked.js'
import { sessionHousehold } from '../store/session.js'
import { isAdmin, ADMIN_PASSWORD } from '../store/roles.js'

const admin = computed(() => isAdmin(sessionHousehold.value))
const seats = motorSeats()

const lockedIds = computed(() => [...lockedSeats.value])
const isLocked = (id) => lockedSeats.value.has(String(id))
const saving = ref(false)
const err = ref('')

onMounted(refreshLocked) // 載入雲端最新鎖定

async function commit(ids) {
  err.value = ''
  saving.value = true
  try {
    await setLocked(ids, ADMIN_PASSWORD) // 後端驗 ADMIN_PASSWORD secret
  } catch (e) {
    err.value = e?.message || '儲存失敗'
  } finally {
    saving.value = false
  }
}
function toggle(s) {
  const id = String(s.id)
  const set = new Set(lockedSeats.value)
  set.has(id) ? set.delete(id) : set.add(id)
  commit([...set])
}
function clearAll() {
  commit([])
}

function typeFill(s) {
  if (s.public) return 'rgba(234,179,8,.55)'
  if (s.type === '大') return 'rgba(245,158,11,.45)'
  if (s.type === '小') return 'rgba(139,92,246,.6)'
  return 'rgba(148,163,184,.4)'
}
function typeStroke(s) {
  if (s.public) return '#a16207'
  if (s.type === '大') return '#d97706'
  if (s.type === '小') return '#6d28d9'
  return '#64748b'
}
function decorate(s) {
  const lk = isLocked(s.id)
  return {
    fill: lk ? '#ef4444' : typeFill(s),
    stroke: lk ? '#b91c1c' : typeStroke(s),
    strokeWidth: s.public ? 2.4 : 0.8,
    r: s.type === '小' ? 6 : 7,
    fontSize: s.type === '小' ? 5 : 5.5,
    text: s.id,
    textFill: lk ? '#fff' : '#0f172a',
    clickable: true, // 物業可鎖任何格
  }
}
</script>

<template>
  <section class="mx-auto">
    <div class="flex items-baseline justify-between">
      <h1 class="text-2xl font-bold">車位鎖定維護</h1>
      <RouterLink to="/me" class="text-sm text-slate-500 hover:underline">← 回我的登記</RouterLink>
    </div>

    <!-- 非管理員 -->
    <div v-if="!admin" class="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
      需<b>管理員</b>權限。請以管理員帳號<RouterLink to="/me" class="underline">登入</RouterLink>（戶號 admin）。
    </div>

    <template v-else>
      <p class="mt-1 text-sm text-slate-500">
        點車位 = <b>鎖定／解鎖</b>。鎖定者（保留位、已私下承租、維修…）<b>不進抽籤、選位頁不可選</b>。
        目前鎖定 <b class="text-rose-600">{{ lockedIds.length }}</b> 格。
        <span v-if="saving" class="text-slate-400">· 儲存中…</span>
        <span v-if="err" class="text-rose-600">· {{ err }}</span>
      </p>

      <div class="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <SeatMap :seats="seats" :decorate="decorate" @seat-click="toggle" />

        <aside class="rounded-lg border border-slate-200 bg-white p-4">
          <div class="flex items-center justify-between">
            <div class="font-semibold">鎖定清單 <span class="text-slate-400">({{ lockedIds.length }})</span></div>
            <button v-if="lockedIds.length" class="text-xs text-slate-500 hover:underline" @click="clearAll">全部解鎖</button>
          </div>
          <div v-if="lockedIds.length" class="mt-3 flex flex-wrap gap-1.5">
            <button
              v-for="id in [...lockedIds].sort((a, b) => +a - +b)"
              :key="id"
              class="rounded bg-rose-100 px-2 py-0.5 font-mono text-xs text-rose-700 hover:bg-rose-200"
              @click="toggle({ id })"
            >{{ id }} ✕</button>
          </div>
          <p v-else class="mt-3 text-sm text-slate-400">尚無鎖定。點地圖車位即可鎖定。</p>

          <p class="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
            v1 存本機（此瀏覽器）；抽籤頁與選位頁讀同一份。Supabase 化後跨裝置共用、並加後端管理員驗證。
          </p>
        </aside>
      </div>
    </template>
  </section>
</template>
