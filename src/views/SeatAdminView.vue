<script setup>
// 物業：車位指派／鎖定維護。抽籤前用來確定「保留．志願小位．無障礙」並登打繳費。
// 安全分流：車位 id → locked_seat（公開，選位/抽籤排除）；戶號/車號/繳費 → vehicle（RLS deny-all）。
// 點地圖車位 → 右側表單填車號/類型/繳費 → 指派（鎖定）；已鎖定者可解除。
import { ref, computed, onMounted } from 'vue'
import SeatMap from '../components/SeatMap.vue'
import { motorSeats } from '../map/seats.js'
import { lockedSeats, refreshLocked, listAssignments, assignSeat, unlockSeat } from '../store/locked.js'
import { sessionHousehold } from '../store/session.js'
import { isAdmin, ADMIN_PASSWORD } from '../store/roles.js'

const admin = computed(() => isAdmin(sessionHousehold.value))
const seats = motorSeats()

const lockedIds = computed(() => [...lockedSeats.value])
const isLocked = (id) => lockedSeats.value.has(String(id))
const saving = ref(false)
const err = ref('')

const assignments = ref([]) // 管理員專屬：[{車位編號,戶號,車號,車種,配位狀態,已繳費}]
const assignMap = computed(() => {
  const m = new Map()
  for (const a of assignments.value) m.set(String(a.車位編號), a)
  return m
})

const selected = ref(null) // 目前點選的車位物件
const form = ref({ 車號: '', 車種: '一般', 配位狀態: '', 已繳費: false })

const STATUS_OPTIONS = ['志願小位', '無障礙', '保留', '維修', '分配']
function defaultStatus(s) {
  if (s.type === '無障礙') return '無障礙'
  if (s.type === '小') return '志願小位'
  return '保留'
}

onMounted(async () => {
  await refreshLocked()
  await reloadAssignments()
})

async function reloadAssignments() {
  try {
    assignments.value = await listAssignments(ADMIN_PASSWORD)
  } catch (e) {
    err.value = e?.message || '讀取指派失敗'
  }
}

function selectSeat(s) {
  err.value = ''
  selected.value = s
  const a = assignMap.value.get(String(s.id))
  form.value = {
    車號: a?.車號 || '',
    車種: a?.車種 || '一般',
    配位狀態: a?.配位狀態 || defaultStatus(s),
    已繳費: !!a?.已繳費,
  }
}

async function doAssign() {
  if (!selected.value) return
  err.value = ''
  saving.value = true
  try {
    await assignSeat(
      {
        車位編號: String(selected.value.id),
        車位類型: selected.value.type,
        車號: form.value.車號.trim().toUpperCase(),
        配位狀態: form.value.配位狀態,
        已繳費: form.value.已繳費,
      },
      ADMIN_PASSWORD,
    )
    await reloadAssignments()
    selected.value = null
  } catch (e) {
    err.value = e?.message || '指派失敗'
  } finally {
    saving.value = false
  }
}

async function doUnlock(seatId) {
  err.value = ''
  saving.value = true
  try {
    const a = assignMap.value.get(String(seatId))
    await unlockSeat(seatId, a?.車號 || '', ADMIN_PASSWORD)
    await reloadAssignments()
    if (selected.value && String(selected.value.id) === String(seatId)) selected.value = null
  } catch (e) {
    err.value = e?.message || '解除失敗'
  } finally {
    saving.value = false
  }
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
  const sel = selected.value && String(selected.value.id) === String(s.id)
  return {
    fill: lk ? '#ef4444' : typeFill(s),
    stroke: sel ? '#2563eb' : lk ? '#b91c1c' : typeStroke(s),
    strokeWidth: sel ? 2.6 : s.public ? 2.4 : 0.8,
    r: s.type === '小' ? 6 : 7,
    fontSize: s.type === '小' ? 5 : 5.5,
    text: s.id,
    textFill: lk ? '#fff' : '#0f172a',
    clickable: true, // 物業可點任何格
  }
}
</script>

<template>
  <section class="mx-auto">
    <div class="flex items-baseline justify-between">
      <h1 class="text-2xl font-bold">車位指派維護</h1>
      <RouterLink to="/me" class="text-sm text-slate-500 hover:underline">← 回我的登記</RouterLink>
    </div>

    <!-- 非管理員 -->
    <div v-if="!admin" class="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
      需<b>管理員</b>權限。請以管理員帳號<RouterLink to="/me" class="underline">登入</RouterLink>（戶號 admin）。
    </div>

    <template v-else>
      <p class="mt-1 text-sm text-slate-500">
        點車位 → 右側填<b>車號/類型/繳費</b> → <b>指派（鎖定）</b>。指派者<b>不進抽籤、選位頁不可選</b>。
        抽籤前用來確定<b>志願小位／無障礙</b>（先繳費）與<b>保留位</b>。
        目前鎖定 <b class="text-rose-600">{{ lockedIds.length }}</b> 格。
        <span v-if="saving" class="text-slate-400">· 處理中…</span>
        <span v-if="err" class="text-rose-600">· {{ err }}</span>
      </p>
      <p class="mt-1 text-xs text-slate-400">
        🔒 車號/繳費只寫進受保護的 vehicle（其他住戶查不到）；公開表只存「哪些位被鎖」的編號。
      </p>

      <div class="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <SeatMap :seats="seats" :decorate="decorate" @seat-click="selectSeat" />

        <aside class="space-y-4">
          <!-- 指派表單 -->
          <div class="rounded-lg border border-slate-200 bg-white p-4">
            <div v-if="!selected" class="text-sm text-slate-400">點地圖上的車位開始指派。</div>
            <template v-else>
              <div class="flex items-center justify-between">
                <div class="font-semibold">
                  車位 <span class="font-mono text-blue-600">{{ selected.id }}</span>
                  <span class="ml-1 text-xs text-slate-400">{{ selected.type }}{{ selected.public ? '·公益' : '' }}</span>
                </div>
                <span
                  v-if="isLocked(selected.id)"
                  class="rounded bg-rose-100 px-2 py-0.5 text-xs text-rose-700"
                >已鎖定</span>
              </div>

              <label class="mt-3 block text-xs font-medium text-slate-600">車號（選填，留空＝純保留位）</label>
              <input
                v-model="form.車號"
                placeholder="例 ABC-1234"
                class="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-sm uppercase"
              />

              <div class="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <label class="block text-xs font-medium text-slate-600">車種</label>
                  <select v-model="form.車種" class="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
                    <option>一般</option>
                    <option>重機</option>
                  </select>
                </div>
                <div>
                  <label class="block text-xs font-medium text-slate-600">類型/狀態</label>
                  <select v-model="form.配位狀態" class="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
                    <option v-for="s in STATUS_OPTIONS" :key="s">{{ s }}</option>
                  </select>
                </div>
              </div>

              <label class="mt-3 flex items-center gap-2 text-sm text-slate-700">
                <input v-model="form.已繳費" type="checkbox" class="size-4" />
                已繳費
              </label>

              <div class="mt-4 flex gap-2">
                <button
                  class="flex-1 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  :disabled="saving"
                  @click="doAssign"
                >{{ isLocked(selected.id) ? '更新指派' : '指派並鎖定' }}</button>
                <button
                  v-if="isLocked(selected.id)"
                  class="rounded border border-rose-300 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                  :disabled="saving"
                  @click="doUnlock(selected.id)"
                >解除</button>
              </div>
            </template>
          </div>

          <!-- 已指派清單 -->
          <div class="rounded-lg border border-slate-200 bg-white p-4">
            <div class="font-semibold">已鎖定 <span class="text-slate-400">({{ lockedIds.length }})</span></div>
            <div v-if="assignments.length" class="mt-3 space-y-1.5">
              <div
                v-for="a in [...assignments].sort((x, y) => +x.車位編號 - +y.車位編號)"
                :key="a.車位編號"
                class="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-xs"
              >
                <button class="text-left hover:underline" @click="selectSeat(seats.find((s) => String(s.id) === String(a.車位編號)) || { id: a.車位編號 })">
                  <span class="font-mono font-semibold text-rose-700">{{ a.車位編號 }}</span>
                  <span v-if="a.戶號" class="ml-1 text-slate-600">{{ a.戶號 }}</span>
                  <span v-if="a.車號" class="ml-1 font-mono text-slate-400">{{ a.車號 }}</span>
                  <span v-if="a.配位狀態" class="ml-1 text-slate-400">·{{ a.配位狀態 }}</span>
                  <span v-if="a.已繳費" class="ml-1 text-emerald-600">✓繳</span>
                  <span v-else-if="a.車號" class="ml-1 text-amber-500">未繳</span>
                </button>
                <button class="text-slate-400 hover:text-rose-600" @click="doUnlock(a.車位編號)">✕</button>
              </div>
            </div>
            <p v-else class="mt-3 text-sm text-slate-400">尚無鎖定。</p>
          </div>
        </aside>
      </div>
    </template>
  </section>
</template>
