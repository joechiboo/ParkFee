<script setup>
// 即時車牌辨識（getUserMedia + onnxruntime-web，RoboEye 路線）。辨識-only：把框內裁切的車牌做 OCR。
// 連續讀到相同有效車牌兩次 → emit('recognized')；也可按「填入」採用目前候選。辨不到/錯 → 父層手動輸入。
// ⚠️ 相機需 https（GitHub Pages ✓；本機 localhost 也可）。
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { ensureOcr, ocrRecognize, ocrStage, ocrProgress } from '../lib/ocr.js'

const emit = defineEmits(['recognized', 'close'])
const props = defineProps({ feedback: { type: Object, default: null } }) // {tone,text} 父層結果浮層

const flash = ref(null)
watch(
  () => props.feedback,
  (f) => {
    if (!f) return
    flash.value = f
    if (f.tone === 'red' && navigator.vibrate) navigator.vibrate(200)
    setTimeout(() => {
      if (flash.value === f) flash.value = null
    }, 2800)
  },
)

const videoEl = ref(null)
const status = ref('啟動中…')
const camErr = ref('')
const candidate = ref('')
const raw = ref('') // 最近一次原始辨識（除錯/觀察準度用）

let stream = null
let ready = false
let running = false
let busy = false
let lastValid = ''
const workCanvas = document.createElement('canvas')

function validate(text) {
  const clean = (text || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return clean.length >= 6 && clean.length <= 7 ? clean : '' // 機車車牌約 6–7 碼
}

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    })
    videoEl.value.srcObject = stream
    await videoEl.value.play()
  } catch (e) {
    const insecure = location.protocol !== 'https:' && location.hostname !== 'localhost'
    camErr.value = insecure
      ? '相機需要 https（請用部署的網址，或本機 localhost）'
      : e?.name === 'NotAllowedError'
        ? '相機權限被拒，請允許後重新開啟'
        : '無法開啟相機：' + (e?.message || e?.name || '未知')
  }
}

// 裁切取景框（車牌形：寬扁）內的影像 → 回 canvas 給 OCR。
function captureBox() {
  const v = videoEl.value
  if (!v || !v.videoWidth) return null
  const vw = v.videoWidth
  const vh = v.videoHeight
  const bw = vw * 0.8
  const bh = vh * 0.26
  const bx = (vw - bw) / 2
  const by = (vh - bh) / 2
  const c = workCanvas
  c.width = Math.round(bw)
  c.height = Math.round(bh)
  c.getContext('2d').drawImage(v, bx, by, bw, bh, 0, 0, c.width, c.height)
  return c
}

async function scanOnce() {
  if (!running || busy || !ready) return
  const c = captureBox()
  if (!c) return
  busy = true
  try {
    const text = await ocrRecognize(c)
    raw.value = text
    const v = validate(text)
    if (v) {
      candidate.value = v
      if (v === lastValid) {
        emit('recognized', { type: 'plate', value: v })
        lastValid = ''
      } else {
        lastValid = v
      }
    }
  } catch {
    /* 單次失敗忽略 */
  } finally {
    busy = false
  }
}

async function loop() {
  while (running) {
    await scanOnce()
    await new Promise((r) => setTimeout(r, 400))
  }
}

function accept() {
  if (candidate.value) emit('recognized', { type: 'plate', value: candidate.value })
}

onMounted(async () => {
  await startCamera()
  if (camErr.value) return
  try {
    await ensureOcr()
    ready = true
    status.value = '把車牌放進框內，自動辨識中…'
  } catch (e) {
    camErr.value = '辨識引擎載入失敗：' + (e?.message || e?.name || '未知')
    return
  }
  running = true
  loop()
})
onBeforeUnmount(() => {
  running = false
  if (stream) stream.getTracks().forEach((t) => t.stop())
})
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col bg-black">
    <div class="relative flex-1 overflow-hidden">
      <video ref="videoEl" playsinline muted autoplay class="h-full w-full object-cover"></video>

      <!-- 車牌形取景框：把車牌放滿這個框 -->
      <div class="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style="width: 80%; height: 26%">
        <div class="h-full w-full rounded-lg border-2 border-emerald-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"></div>
      </div>

      <div v-if="camErr" class="absolute inset-x-4 top-4 rounded bg-rose-600/90 p-3 text-sm text-white">{{ camErr }}</div>

      <!-- 父層結果浮層 -->
      <div
        v-if="flash"
        class="absolute inset-x-3 top-3 rounded-lg border-2 p-3 text-center text-sm font-bold text-white"
        :class="flash.tone === 'red' ? 'border-rose-300 bg-rose-600/90' : 'border-blue-300 bg-blue-600/90'"
      >
        {{ flash.text }}
      </div>

      <!-- 載入 / 候選 -->
      <div v-else class="absolute inset-x-0 bottom-0 bg-black/60 p-3 text-center text-white">
        <template v-if="ocrStage">
          <div class="text-sm">辨識引擎準備中 · {{ ocrStage }}<span v-if="ocrStage === '下載模型'"> {{ ocrProgress }}%</span></div>
          <div v-if="ocrStage === '下載模型'" class="mx-auto mt-2 h-2 w-4/5 overflow-hidden rounded-full bg-slate-700">
            <div class="h-full rounded-full bg-emerald-400 transition-all" :style="{ width: ocrProgress + '%' }"></div>
          </div>
          <div class="mt-1 text-xs text-slate-400">首次約 9MB，下載後快取、下次免下載</div>
        </template>
        <template v-else>
          <div class="text-xs text-slate-300">{{ status }}</div>
          <div class="mt-1 font-mono text-2xl font-bold tracking-wider">{{ candidate || '—' }}</div>
          <div v-if="raw" class="text-xs text-slate-400">讀到：{{ raw }}</div>
        </template>
      </div>
    </div>

    <div class="flex items-center gap-2 bg-slate-900 p-3">
      <span class="text-sm text-slate-300">對準車牌</span>
      <button
        class="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        :disabled="!candidate"
        @click="accept"
      >填入</button>
      <button class="ml-auto rounded border border-slate-600 px-4 py-1.5 text-sm text-slate-200" @click="emit('close')">關閉</button>
    </div>
  </div>
</template>
