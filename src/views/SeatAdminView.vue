<script setup>
// 物業：車位指派／鎖定維護。抽籤前用來確定「保留．志願小位．無障礙」並登打繳費。
// 安全分流：車位 id → locked_seat（公開，選位/抽籤排除）；戶號/車號/繳費 → vehicle（RLS deny-all）。
// 點地圖車位 → 右側表單填車號/類型/繳費 → 指派（鎖定）；已鎖定者可解除。
import { ref, computed, onMounted } from 'vue'
import SeatMap from '../components/SeatMap.vue'
import { motorSeats } from '../map/seats.js'
import { lockedSeats, refreshLocked, listAssignments, assignSeat, unlockSeat, setLocked } from '../store/locked.js'
import { sessionHousehold } from '../store/session.js'
import { isAdmin } from '../store/roles.js'

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

// 佔用 = 物業鎖定(locked) ∪ 抽籤分配(!locked)。抽籤分配只顯示、不可解除（避免誤清中籤者結果）。
const lotteryCount = computed(() => assignments.value.filter((a) => !a.locked).length)
const selectedAssign = computed(() => (selected.value ? assignMap.value.get(String(selected.value.id)) : null))
const selectedIsLottery = computed(() => !!selectedAssign.value && !selectedAssign.value.locked)

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
    assignments.value = await listAssignments()
  } catch (e) {
    err.value = e?.message || '讀取指派失敗'
  }
}

// ── 批次鎖定／解除（動線/結構/整區）：支援範圍語法。純鎖定(只存 id)、可再批次解除。──
const seatIdSet = new Set(seats.map((s) => String(s.id)))
const batchInput = ref('')
const batchMsg = ref('')

// 解析輸入：範圍 423-438 / 423–438 / 423~438，加逗號/空白/換行分隔的單號，混用皆可。
function parseSeatInput(text) {
  const ids = new Set()
  const rest = String(text).replace(/(\d+)\s*[-–—~〜至到]\s*(\d+)/g, (_, a, b) => {
    let x = +a
    let y = +b
    if (x > y) [x, y] = [y, x]
    for (let i = x; i <= y; i++) ids.add(String(i))
    return ' '
  })
  for (const m of rest.match(/\d+/g) || []) ids.add(m)
  return [...ids]
}
const parsedValid = computed(() => parseSeatInput(batchInput.value).filter((id) => seatIdSet.has(id)))

// mode：'lock' 加入鎖定 ∪、'unlock' 從鎖定移除。setLocked 整批取代，故都以現有清單為基準運算。
async function runBatch(mode) {
  batchMsg.value = ''
  const parsed = parseSeatInput(batchInput.value)
  const valid = parsed.filter((id) => seatIdSet.has(id))
  const unknown = parsed.filter((id) => !seatIdSet.has(id))
  if (!valid.length) {
    batchMsg.value = '沒讀到有效車位編號'
    return
  }
  saving.value = true
  try {
    const cur = [...lockedSeats.value]
    const vset = new Set(valid)
    const next = mode === 'lock' ? [...cur, ...valid] : cur.filter((id) => !vset.has(id))
    await setLocked(next)
    await refreshLocked()
    await reloadAssignments()
    batchMsg.value =
      `${mode === 'lock' ? '已鎖定' : '已解除'} ${valid.length} 格` +
      (unknown.length ? `（略過 ${unknown.length} 個不存在：${unknown.slice(0, 8).join('、')}）` : '')
    batchInput.value = ''
  } catch (e) {
    batchMsg.value = e?.message || '操作失敗'
  } finally {
    saving.value = false
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
    await assignSeat({
      車位編號: String(selected.value.id),
      車位類型: selected.value.type,
      車號: form.value.車號.trim().toUpperCase(),
      配位狀態: form.value.配位狀態,
      已繳費: form.value.已繳費,
    })
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
    await unlockSeat(seatId, a?.車號 || '')
    await reloadAssignments()
    if (selected.value && String(selected.value.id) === String(seatId)) selected.value = null
  } catch (e) {
    err.value = e?.message || '解除失敗'
  } finally {
    saving.value = false
  }
}

function typeFill(s) {
  if (s.public) return 'rgba(234,179,8,.55)' // 公益位（社宅戶專用）
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
  const a = assignMap.value.get(String(s.id))
  const isLk = a?.locked // 物業鎖定（紅，可解除）
  const isLot = a && !a.locked // 抽籤分配（琥珀，僅顯示）
  const sel = selected.value && String(selected.value.id) === String(s.id)
  return {
    fill: isLk ? '#ef4444' : isLot ? '#f59e0b' : typeFill(s),
    stroke: sel ? '#2563eb' : isLk ? '#b91c1c' : isLot ? '#b45309' : typeStroke(s),
    strokeWidth: sel ? 2.6 : s.public ? 2.4 : 0.8,
    r: s.type === '小' ? 6 : 7,
    fontSize: s.type === '小' ? 5 : 5.5,
    text: s.id,
    textFill: a ? '#fff' : '#0f172a',
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
        目前鎖定 <b class="text-rose-600">{{ lockedIds.length }}</b> 格<span v-if="lotteryCount"> · 抽籤已分 <b class="text-amber-600">{{ lotteryCount }}</b> 格（琥珀，不可解除）</span>。
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
                <span
                  v-else-if="selectedIsLottery"
                  class="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700"
                >抽籤已分</span>
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

              <p v-if="selectedIsLottery" class="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">
                此位為<b>抽籤分配</b>給 {{ selectedAssign.戶號 }}。可勾繳費後「指派並鎖定」標記已繳；不提供解除以免清掉中籤結果。
              </p>

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

          <!-- 批次鎖定／解除：動線/結構/整區保留 -->
          <div class="rounded-lg border border-rose-200 bg-rose-50/40 p-4">
            <div class="font-semibold text-rose-800">批次鎖定／解除（動線／結構／整區）</div>
            <p class="mt-1 text-xs text-slate-500">
              支援<b>範圍</b>：<code class="rounded bg-white px-1">423-438</code>；單號 <code class="rounded bg-white px-1">300 302</code>；混用皆可（逗號/空白/換行/、）。鎖定＝不給選；解除＝放回可選。
            </p>
            <textarea
              v-model="batchInput"
              rows="2"
              placeholder="例 423-438, 300 302, 477–488"
              class="mt-2 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-sm"
            ></textarea>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <button
                class="rounded bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                :disabled="saving || !parsedValid.length"
                @click="runBatch('lock')"
              >批次鎖定</button>
              <button
                class="rounded border border-rose-400 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                :disabled="saving || !parsedValid.length"
                @click="runBatch('unlock')"
              >批次解除</button>
              <span v-if="parsedValid.length" class="text-xs text-slate-500">解析到 {{ parsedValid.length }} 格</span>
              <span v-if="batchMsg" class="text-xs text-slate-700">{{ batchMsg }}</span>
            </div>
          </div>

          <!-- 已指派清單 -->
          <div class="rounded-lg border border-slate-200 bg-white p-4">
            <div class="font-semibold">已佔用 <span class="text-slate-400">(鎖定 {{ lockedIds.length }} · 抽籤 {{ lotteryCount }})</span></div>
            <div v-if="assignments.length" class="mt-3 space-y-1.5">
              <div
                v-for="a in [...assignments].sort((x, y) => +x.車位編號 - +y.車位編號)"
                :key="a.車位編號"
                class="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-xs"
              >
                <button class="text-left hover:underline" @click="selectSeat(seats.find((s) => String(s.id) === String(a.車位編號)) || { id: a.車位編號 })">
                  <span class="font-mono font-semibold" :class="a.locked ? 'text-rose-700' : 'text-amber-600'">{{ a.車位編號 }}</span>
                  <span v-if="!a.locked" class="ml-1 text-amber-600">抽</span>
                  <span v-if="a.戶號" class="ml-1 text-slate-600">{{ a.戶號 }}</span>
                  <span v-if="a.車號" class="ml-1 font-mono text-slate-400">{{ a.車號 }}</span>
                  <span v-if="a.配位狀態" class="ml-1 text-slate-400">·{{ a.配位狀態 }}</span>
                  <span v-if="a.已繳費" class="ml-1 text-emerald-600">✓繳</span>
                  <span v-else-if="a.車號" class="ml-1 text-amber-500">未繳</span>
                </button>
                <button v-if="a.locked" class="text-slate-400 hover:text-rose-600" @click="doUnlock(a.車位編號)">✕</button>
              </div>
            </div>
            <p v-else class="mt-3 text-sm text-slate-400">尚無鎖定。</p>
          </div>
        </aside>
      </div>
    </template>
  </section>
</template>
