<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import SeatMap from '../components/SeatMap.vue'
import { motorSeats } from '../map/seats.js'
import { sessionHousehold, sessionPlate } from '../store/session.js'
import { saveWishes as saveWishesRemote } from '../store/db.js'
import { lockedSeats, refreshLocked } from '../store/locked.js'

// 全機車位（含 public 旗標）：大/小可選、無障礙與公益僅顯示不可選。
const seats = motorSeats()
const householdId = computed(() => sessionHousehold.value?.戶號 || '')

// 志願序＝純綁登入住戶：來源為登入時後端帶回的 車位志願（sessionHousehold）；未登入時為記憶體試排。
// 不寫任何裝置儲存 → 同台電腦換住戶/登出即歸零，不會看到上一位的志願。點選順序即志願序。
const wishes = ref(sessionHousehold.value?.車位志願?.map(String) || [])
const fallback = ref(!!sessionHousehold.value?.志願落選保底)
const orderMap = computed(() => {
  const m = new Map()
  wishes.value.forEach((id, i) => m.set(String(id), i + 1))
  return m
})
const isSel = (id) => orderMap.value.has(String(id))
const orderOf = (id) => orderMap.value.get(String(id))

// 已鎖定/已承租的車位（物業維護、雲端讀）：不可選。
onMounted(refreshLocked)
const isOccupied = (id) => lockedSeats.value.has(String(id))
const selectable = (s) => !s.public && !isOccupied(s.id) && (s.type === '大' || s.type === '小')

const TYPE_LABEL = { 大: '大位', 小: '小位', 無障礙: '無障礙' }
function seatLabel(id) {
  const s = seats.find((x) => String(x.id) === String(id))
  return s ? `${TYPE_LABEL[s.type] || ''} ${id}` : id
}

function toggle(s) {
  if (!selectable(s)) return
  const id = String(s.id)
  const i = wishes.value.indexOf(id)
  if (i >= 0) wishes.value.splice(i, 1)
  else wishes.value.push(id)
}
function removeAt(i) {
  wishes.value.splice(i, 1)
}
function clearAll() {
  wishes.value = []
}

const saved = ref(false)
const saving = ref(false)
const saveErr = ref('')
async function submit() {
  saveErr.value = ''
  if (!householdId.value) {
    saveErr.value = '請先登入再儲存志願'
    return
  }
  saving.value = true
  try {
    const h = await saveWishesRemote({
      戶號: householdId.value,
      車位志願: wishes.value,
      志願落選保底: fallback.value,
      認證車號: sessionPlate.value,
    })
    if (h) sessionHousehold.value = h
    saved.value = true
    setTimeout(() => (saved.value = false), 2500)
  } catch (e) {
    saveErr.value = e?.message || '儲存失敗，請稍後再試'
  } finally {
    saving.value = false
  }
}

// 換登入身分時重置志願：登出→清空；換戶→載入該戶後端志願或重來；匿名試排→登入(且該戶無存檔)後接管。
watch(householdId, (newId, oldId) => {
  if (!newId) {
    wishes.value = [] // 登出 → 清空
    return
  }
  const saved = sessionHousehold.value?.車位志願?.map(String) || []
  if (saved.length) wishes.value = saved // 該戶後端已存 → 載入
  else if (oldId) wishes.value = [] // 由別戶切換來、且無存檔 → 重來
  // 匿名(oldId='')→登入且無存檔：保留目前試排
})

// 座位外觀：選中=紅、已售=深灰、公益=金、大=琥珀、小=紫、無障礙=灰。
function fill(s) {
  if (isSel(s.id)) return '#ef4444'
  if (isOccupied(s.id)) return '#475569'
  if (s.public) return 'rgba(234,179,8,.55)'
  if (s.type === '大') return 'rgba(245,158,11,.45)'
  if (s.type === '小') return 'rgba(139,92,246,.6)'
  return 'rgba(148,163,184,.4)'
}
function stroke(s) {
  if (isSel(s.id)) return '#b91c1c'
  if (isOccupied(s.id)) return '#1e293b'
  if (s.public) return '#a16207'
  if (s.type === '大') return '#d97706'
  if (s.type === '小') return '#6d28d9'
  return '#64748b'
}
// 餵給 <SeatMap> 的每格外觀：未選顯示車位編號、選中顯示志願序號。
function decorate(s) {
  const sel = isSel(s.id)
  return {
    fill: fill(s),
    stroke: stroke(s),
    strokeWidth: s.public ? 2.4 : 0.8,
    r: s.type === '小' ? 6 : 7,
    fontSize: s.type === '小' ? 5 : 5.5,
    fontWeight: sel ? 700 : 400,
    text: sel ? orderOf(s.id) : s.id,
    textFill: sel || isOccupied(s.id) ? '#e2e8f0' : '#0f172a',
    clickable: selectable(s),
  }
}
</script>

<template>
  <section class="mx-auto">
    <div class="flex items-baseline justify-between">
      <h1 class="text-2xl font-bold">選車位志願序</h1>
      <RouterLink to="/me" class="text-sm text-slate-500 hover:underline">← 回我的登記</RouterLink>
    </div>

    <p class="mt-1 text-sm text-slate-500">
      在地圖上<b>依想要的順序</b>點選車位（點選順序＝志願 1、2、3…）；抽出順序號後，系統依序分發你「志願中仍剩的最高志願」。
      <span v-if="householdId">目前戶號 <b>{{ householdId }}</b>。</span>
      <span v-else class="text-amber-700">未登入：可先試排，<RouterLink to="/me" class="underline">登入</RouterLink>後才能儲存（志願需綁戶號才能進配位）。</span>
    </p>

    <div class="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <SeatMap :seats="seats" :decorate="decorate" @seat-click="toggle" />

      <!-- 志願清單 -->
      <aside class="rounded-lg border border-slate-200 bg-white p-4">
        <div class="flex items-center justify-between">
          <div class="font-semibold">車位志願序 <span class="text-slate-400">({{ wishes.length }})</span></div>
          <button v-if="wishes.length" class="text-xs text-slate-500 hover:underline" @click="clearAll">清除全部</button>
        </div>

        <ol v-if="wishes.length" class="mt-3 space-y-1.5">
          <li v-for="(id, i) in wishes" :key="id" class="flex items-center gap-2 text-sm">
            <span class="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-rose-500 text-xs font-bold text-white">{{ i + 1 }}</span>
            <span class="font-mono">{{ seatLabel(id) }}</span>
            <button class="ml-auto text-slate-400 hover:text-rose-600" @click="removeAt(i)">✕</button>
          </li>
        </ol>
        <p v-else class="mt-3 text-sm text-slate-400">尚未選擇。點地圖上的車位開始排志願。</p>

        <label class="mt-4 flex items-start gap-2 text-xs text-slate-600">
          <input v-model="fallback" type="checkbox" class="mt-0.5 h-4 w-4" />
          <span>志願全落選時，同意由管理中心就近補位（可能為小位）；不勾＝進候補等下一輪。</span>
        </label>

        <button
          v-if="householdId"
          class="mt-3 w-full rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          :disabled="!wishes.length || saving"
          @click="submit"
        >
          {{ saving ? '儲存中…' : '儲存志願序' }}
        </button>
        <RouterLink
          v-else
          to="/me"
          class="mt-3 block w-full rounded bg-slate-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-slate-700"
        >
          登入後儲存
        </RouterLink>
        <p v-if="saved" class="mt-2 text-center text-sm text-emerald-600">✓ 已儲存到後端（戶號 {{ householdId }}）</p>
        <p v-if="saveErr" class="mt-2 text-center text-sm text-rose-600">{{ saveErr }}</p>

        <div class="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
          <div class="mb-1 font-medium text-slate-600">可選</div>
          <div class="flex flex-wrap gap-x-3 gap-y-1">
            <span><span class="inline-block h-2.5 w-2.5 rounded-full" style="background:rgba(245,158,11,.6)"></span> 大位</span>
            <span><span class="inline-block h-2.5 w-2.5 rounded-full" style="background:rgba(139,92,246,.7)"></span> 小位</span>
            <span><span class="inline-block h-2.5 w-2.5 rounded-full bg-rose-500"></span> 已選</span>
          </div>
          <div class="mb-1 mt-2 font-medium text-slate-600">不可選</div>
          <div class="flex flex-wrap gap-x-3 gap-y-1">
            <span><span class="inline-block h-2.5 w-2.5 rounded-full" style="background:rgba(234,179,8,.6);outline:1.5px solid #a16207"></span> 公益</span>
            <span><span class="inline-block h-2.5 w-2.5 rounded-full" style="background:rgba(148,163,184,.45)"></span> 無障礙</span>
            <span><span class="inline-block h-2.5 w-2.5 rounded-full" style="background:#475569"></span> 已承租</span>
          </div>
        </div>
      </aside>
    </div>

    <p class="mt-3 text-xs text-slate-400">
      登入後「儲存志願序」會寫入後端（Supabase）；未登入僅本機試排。志願不限數量、多填越不易落空；志願小位／無障礙位免在此排。
    </p>
  </section>
</template>
