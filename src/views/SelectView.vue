<script setup>
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { motorSeats, DISP_W, DISP_H } from '../map/seats.js'
import { sessionHousehold } from '../store/session.js'
import { loadWishes, saveWishes } from '../store/wishes.js'
import { loadOccupied } from '../store/occupied.js'

// 全機車位（含 public 旗標）：大/小可選、無障礙與公益僅顯示不可選。
const seats = motorSeats()
const householdId = computed(() => sessionHousehold.value?.戶號 || '')

// 志願序：有序的車位 id 陣列；點選順序即志願序。
const wishes = ref(loadWishes(householdId.value))
const orderMap = computed(() => {
  const m = new Map()
  wishes.value.forEach((id, i) => m.set(String(id), i + 1))
  return m
})
const isSel = (id) => orderMap.value.has(String(id))
const orderOf = (id) => orderMap.value.get(String(id))

// 已被選定/已繳費的車位：不可選。
const occupied = new Set(loadOccupied())
const isOccupied = (id) => occupied.has(String(id))
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
function submit() {
  saveWishes(householdId.value, wishes.value)
  saved.value = true
  setTimeout(() => (saved.value = false), 2500)
}

// 自動存到本機（選了就存，不靠按鈕）。
watch(wishes, (list) => saveWishes(householdId.value, list), { deep: true })
// 登入後若該戶尚無存檔，把目前（匿名）選擇接管過去；有存檔則載入該戶的。
watch(householdId, (id) => {
  const savedList = loadWishes(id)
  if (savedList.length) wishes.value = savedList
  else if (wishes.value.length) saveWishes(id, wishes.value)
})

// 顏色：選中=紅、公益=金、大=琥珀、小=紫、無障礙=灰。
function fill(s) {
  if (isSel(s.id)) return '#ef4444'
  if (isOccupied(s.id)) return '#475569' // 已售：深灰實心
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
const radius = (s) => (s.type === '小' ? 6 : 7)

// ── 縮放／平移 ───────────────────────────────────────────────
const BASE_W = 1400 // 底圖基準寬（px），縮放以此為基數
const zoom = ref(1)
const wrapW = computed(() => Math.round(BASE_W * zoom.value))
const stage = ref(null)
const clampZoom = (z) => Math.min(8, Math.max(0.5, +z.toFixed(2)))
function zoomBy(d) {
  zoom.value = clampZoom(zoom.value + d)
}
function onWheel(e) {
  if (!e.ctrlKey) return // 桌機：Ctrl+滾輪縮放，避免擋住頁面捲動
  e.preventDefault()
  zoomBy(e.deltaY < 0 ? 0.25 : -0.25)
}

// 觸控/滑鼠手勢：單指(或滑鼠)拖曳平移、雙指 pinch 縮放。
// stage 設 touch-action:none，由我們接管手勢，避免和原生捲動打架。
const pointers = new Map()
let moved = false
let panStart = null
let pinchStart = null
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

function onDown(e) {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  moved = false
  if (pointers.size === 1) {
    panStart = { x: e.clientX, y: e.clientY, sl: stage.value.scrollLeft, st: stage.value.scrollTop }
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    pinchStart = { d: dist(a, b), zoom: zoom.value }
    panStart = null
  }
}
function onMove(e) {
  if (!pointers.has(e.pointerId)) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pinchStart && pointers.size >= 2) {
    const [a, b] = [...pointers.values()]
    const d = dist(a, b)
    if (d > 0) {
      zoom.value = clampZoom(pinchStart.zoom * (d / pinchStart.d))
      moved = true
    }
    return
  }
  if (panStart) {
    const dx = e.clientX - panStart.x
    const dy = e.clientY - panStart.y
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true
    stage.value.scrollLeft = panStart.sl - dx
    stage.value.scrollTop = panStart.st - dy
  }
}
function onUp(e) {
  pointers.delete(e.pointerId)
  if (pointers.size < 2) pinchStart = null
  if (pointers.size === 0) panStart = null
}
function onSeatClick(s) {
  if (moved) return // 剛剛在拖曳/縮放，不當作選位
  toggle(s)
}

const mapSrc = import.meta.env.BASE_URL + 'demo/b1.png'

// 實際座位區範圍（viewBox 座標）——進場聚焦於此，避免停在標題欄/空白、座位又糊成一團。
const bbox = (() => {
  const xs = seats.map((s) => s.x)
  const ys = seats.map((s) => s.y)
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
})()

async function focusSeats() {
  const el = stage.value
  if (!el) return
  const bw = Math.max(1, bbox.maxX - bbox.minX)
  const bh = Math.max(1, bbox.maxY - bbox.minY)
  const pad = 1.2
  // 讓座位區的寬與高都塞進視窗，取較保守（小）的縮放。
  const W = Math.min(
    (el.clientWidth / pad) * (DISP_W / bw),
    (el.clientHeight / pad) * (DISP_W / bh),
  )
  zoom.value = clampZoom(W / BASE_W)
  await nextTick()
  const w = wrapW.value
  const h = (w * DISP_H) / DISP_W
  el.scrollLeft = ((bbox.minX + bbox.maxX) / 2 / DISP_W) * w - el.clientWidth / 2
  el.scrollTop = ((bbox.minY + bbox.maxY) / 2 / DISP_H) * h - el.clientHeight / 2
}
onMounted(focusSeats)
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
      <span v-else class="text-amber-700">未登入：志願暫存於本機，<RouterLink to="/me" class="underline">登入</RouterLink>後綁定戶號。</span>
    </p>

    <div class="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <!-- 地圖 -->
      <div class="rounded-lg border border-slate-200 bg-slate-900">
        <div class="flex items-center gap-2 border-b border-slate-700 px-3 py-2 text-xs text-slate-300">
          <button class="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600" @click="zoomBy(0.3)">＋</button>
          <button class="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600" @click="zoomBy(-0.3)">－</button>
          <span>{{ Math.round(zoom * 100) }}%</span>
          <button class="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600" @click="focusSeats">⊙ 定位座位區</button>
          <span class="ml-auto hidden sm:inline">拖曳平移 · 雙指 / Ctrl+滾輪 縮放</span>
        </div>
        <div
          ref="stage"
          class="relative h-[70vh] cursor-grab touch-none overflow-auto"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointerleave="onUp"
          @pointercancel="onUp"
          @wheel="onWheel"
        >
          <div class="relative select-none" :style="{ width: wrapW + 'px' }">
            <img :src="mapSrc" alt="B1 平面圖" class="block w-full" draggable="false" />
            <svg
              class="absolute inset-0 h-full w-full"
              :viewBox="`0 0 ${DISP_W} ${DISP_H}`"
              preserveAspectRatio="none"
            >
              <g
                v-for="s in seats"
                :key="s.id + '-' + s.x + '-' + s.y"
                :style="{ cursor: selectable(s) ? 'pointer' : isOccupied(s.id) ? 'not-allowed' : 'default' }"
                @click="onSeatClick(s)"
              >
                <!-- 透明大點擊區：手機上座位小、放大可點範圍 -->
                <circle v-if="selectable(s)" :cx="s.x" :cy="s.y" r="12" fill="transparent" />
                <circle
                  :cx="s.x"
                  :cy="s.y"
                  :r="radius(s)"
                  :fill="fill(s)"
                  :stroke="stroke(s)"
                  :stroke-width="s.public ? 2.4 : 0.8"
                />
                <!-- 未選顯示車位編號；選中顯示志願序號 -->
                <text
                  :x="s.x"
                  :y="s.y + 2.3"
                  text-anchor="middle"
                  :font-size="s.type === '小' ? 5 : 5.5"
                  :font-weight="isSel(s.id) ? 700 : 400"
                  :fill="isSel(s.id) || isOccupied(s.id) ? '#e2e8f0' : '#0f172a'"
                  style="pointer-events: none; user-select: none"
                >{{ isSel(s.id) ? orderOf(s.id) : s.id }}</text>
              </g>
            </svg>
          </div>
        </div>
      </div>

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

        <button
          class="mt-4 w-full rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          :disabled="!wishes.length"
          @click="submit"
        >
          儲存志願序
        </button>
        <p v-if="saved" class="mt-2 text-center text-sm text-emerald-600">✓ 已儲存{{ householdId ? `（戶號 ${householdId}）` : '於本機' }}</p>

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
      原型：志願暫存於本機（依戶號），尚未送出後端。志願不限數量、多填越不易落空；志願小位／無障礙位免在此排。
    </p>
  </section>
</template>
