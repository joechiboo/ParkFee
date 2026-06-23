<script setup>
// 共用 B1 座位地圖：底圖 + SVG 座位 + 拖曳/雙指/Ctrl滾輪縮放 + 進場聚焦座位區。
// 外觀與互動由父層決定：
//   props.decorate(seat) → { fill, stroke, strokeWidth, r, fontSize, fontWeight, text, textFill, clickable }
//   @seat-click(seat)    → 父層處理點擊（拖曳中不觸發）。
// 選位頁(排志願)、維護頁(鎖定車位)…共用此元件，只換 decorate / 點擊語意。
import { ref, computed, onMounted, nextTick } from 'vue'
import { DISP_W, DISP_H } from '../map/seats.js'

const props = defineProps({
  seats: { type: Array, required: true },
  decorate: { type: Function, required: true },
})
const emit = defineEmits(['seat-click'])

const decorated = computed(() => props.seats.map((s) => ({ seat: s, d: props.decorate(s) })))

const mapSrc = import.meta.env.BASE_URL + 'demo/b1.png'
const BASE_W = 1400
const zoom = ref(1)
const wrapW = computed(() => Math.round(BASE_W * zoom.value))
const stage = ref(null)
const clampZoom = (z) => Math.min(8, Math.max(0.5, +z.toFixed(2)))
function zoomBy(d) {
  zoom.value = clampZoom(zoom.value + d)
}
function onWheel(e) {
  if (!e.ctrlKey) return // 桌機：Ctrl+滾輪縮放
  e.preventDefault()
  zoomBy(e.deltaY < 0 ? 0.25 : -0.25)
}

// 手勢：單指拖曳平移、雙指 pinch 縮放（stage touch-action:none，自行接管）。
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
function onSeatClick(seat) {
  if (moved) return // 剛剛在拖曳/縮放，不當作點選
  emit('seat-click', seat)
}

// 進場聚焦座位區（避免停在標題欄/空白、座位糊成一團）。
const bbox = computed(() => {
  const xs = props.seats.map((s) => s.x)
  const ys = props.seats.map((s) => s.y)
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
})
async function focusSeats() {
  const el = stage.value
  if (!el) return
  const b = bbox.value
  const bw = Math.max(1, b.maxX - b.minX)
  const bh = Math.max(1, b.maxY - b.minY)
  const pad = 1.2
  const W = Math.min((el.clientWidth / pad) * (DISP_W / bw), (el.clientHeight / pad) * (DISP_W / bh))
  zoom.value = clampZoom(W / BASE_W)
  await nextTick()
  const w = wrapW.value
  const h = (w * DISP_H) / DISP_W
  el.scrollLeft = ((b.minX + b.maxX) / 2 / DISP_W) * w - el.clientWidth / 2
  el.scrollTop = ((b.minY + b.maxY) / 2 / DISP_H) * h - el.clientHeight / 2
}
onMounted(focusSeats)
defineExpose({ focusSeats })
</script>

<template>
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
        <svg class="absolute inset-0 h-full w-full" :viewBox="`0 0 ${DISP_W} ${DISP_H}`" preserveAspectRatio="none">
          <g
            v-for="{ seat, d } in decorated"
            :key="seat.id + '-' + seat.x + '-' + seat.y"
            :style="{ cursor: d.clickable ? 'pointer' : 'default' }"
            @click="onSeatClick(seat)"
          >
            <circle v-if="d.clickable" :cx="seat.x" :cy="seat.y" r="12" fill="transparent" />
            <circle
              :cx="seat.x"
              :cy="seat.y"
              :r="d.r ?? 7"
              :fill="d.fill"
              :stroke="d.stroke"
              :stroke-width="d.strokeWidth ?? 0.8"
            />
            <text
              v-if="d.text != null && d.text !== ''"
              :x="seat.x"
              :y="seat.y + 2.3"
              text-anchor="middle"
              :font-size="d.fontSize ?? 5.5"
              :font-weight="d.fontWeight ?? 400"
              :fill="d.textFill ?? '#0f172a'"
              style="pointer-events: none; user-select: none"
            >{{ d.text }}</text>
          </g>
        </svg>
      </div>
    </div>
  </div>
</template>
